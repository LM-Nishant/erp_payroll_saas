import { createHmac, randomBytes } from 'node:crypto';
import type {
  CreateWebhookInput,
  ListWebhookDeliveriesQuery,
  PaginationQuery,
  UpdateWebhookInput,
  WebhookCreatedDto,
  WebhookDeliveryDto,
  WebhookDto,
} from '@erp/shared';
import type { Prisma, Webhook, WebhookEvent } from '@prisma/client';
import { audit } from '../audit';
import { authorize, currentPrincipal } from '../authz';
import { getEventType, matchesEventPattern, onEvent, type DomainEvent } from '../events';
import { AppError, NotFoundError, ValidationError } from '../http/errors';
import { assertSafeOutboundUrl, outboundRequest } from '../http/outbound';
import { toListResponse, toPageWindow } from '../http/pagination';
import { logger } from '../logger';
import { defineJob, enqueue } from '../queue';
import { deleteSecretInternal, getSecretById, putSecret } from '../secrets';
import { resolveSettingTarget } from '../settings/target';
import { currentOrganizationId } from '../tenancy/context';
import { tenantDb, withTenant } from '../tenancy/tenant-db';

/*
 * Outbound webhooks. Every domain event whose type is webhook-deliverable fans out to the
 * tenant's active subscriptions whose `events` patterns match (`*`, exact, `prefix.*`).
 * Each delivery is a webhook_events row retried with exponential backoff, then FAILED.
 *
 * Request: POST <url>, JSON body `{ id, event, occurredAt, organizationId, data }`, headers
 *   X-Erp-Event, X-Erp-Delivery (delivery id), X-Erp-Timestamp (unix seconds),
 *   X-Erp-Signature: `t=<timestamp>,v1=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>`.
 */

export const WEBHOOK_MAX_ATTEMPTS = 6;
/** Backoff before attempt n+1 (ms): 30s, 2m, 10m, 1h, 6h. */
export const WEBHOOK_BACKOFF_MS = [30_000, 120_000, 600_000, 3_600_000, 21_600_000];

export function signWebhookPayload(secret: string, timestamp: number, body: string): string {
  const hex = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${hex}`;
}

function dto(row: Webhook): WebhookDto {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    events: (row.events as string[]) ?? [],
    description: row.description,
    isActive: row.isActive,
    consecutiveFailures: row.consecutiveFailures,
    lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
    lastFailureAt: row.lastFailureAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function deliveryDto(row: WebhookEvent): WebhookDeliveryDto {
  return {
    id: row.id,
    eventId: row.eventId,
    eventKey: row.eventKey,
    status: row.status as WebhookDeliveryDto['status'],
    attempts: row.attempts,
    lastStatusCode: row.lastStatusCode,
    lastError: row.lastError,
    nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    replayOfId: row.replayOfId,
    createdAt: row.createdAt.toISOString(),
  };
}

function validateEvents(events: string[]): string[] {
  const unique = [...new Set(events)];
  for (const pattern of unique) {
    if (pattern === '*' || pattern.endsWith('.*')) continue;
    const type = getEventType(pattern);
    if (!type) throw new ValidationError(`Unknown event type ${pattern}`, { field: 'events' });
    if (type.webhook === false) {
      throw new ValidationError(`Event ${pattern} is not deliverable to webhooks`, {
        field: 'events',
      });
    }
  }
  return unique;
}

async function storeSigningSecret(webhookId: string) {
  const value = `whsec_${randomBytes(24).toString('base64url')}`;
  const stored = await putSecret({
    target: await resolveSettingTarget('ORGANIZATION'),
    kind: 'webhook.signing',
    name: `webhook-${webhookId}`,
    value,
    description: 'Outbound webhook signing secret',
  });
  return { id: stored.id, value };
}

/** Webhooks are organization-level: they receive every institution's events. */
async function requireOrg(permission: 'integration.view' | 'integration.manage') {
  await authorize(currentPrincipal(), permission, {});
}

async function findWebhook(id: string) {
  const row = await tenantDb().webhook.findFirst({ where: { id } });
  if (!row) throw new NotFoundError('Webhook');
  return row;
}

export const webhooksService = {
  async list(query: PaginationQuery) {
    await requireOrg('integration.view');
    const where: Prisma.WebhookWhereInput = query.search
      ? { name: { contains: query.search } }
      : {};
    const db = tenantDb();
    const [rows, total] = await Promise.all([
      db.webhook.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...toPageWindow(query),
      }),
      db.webhook.count({ where }),
    ]);
    return toListResponse(rows.map(dto), total, query);
  },

  async get(id: string) {
    await requireOrg('integration.view');
    return dto(await findWebhook(id));
  },

  async create(input: CreateWebhookInput): Promise<WebhookCreatedDto> {
    await requireOrg('integration.manage');
    assertSafeOutboundUrl(input.url, 'url');
    const events = validateEvents(input.events);
    const db = tenantDb();
    const id = crypto.randomUUID();
    const secret = await storeSigningSecret(id);
    const row = await db.webhook.create({
      data: withTenant({
        id,
        name: input.name,
        url: input.url,
        events,
        description: input.description ?? null,
        isActive: input.isActive,
        secretId: secret.id,
        createdById: currentPrincipal().userId,
      }),
    });
    await audit.record({
      action: 'webhook.create',
      entityType: 'webhook',
      entityId: id,
      after: { ...dto(row) },
    });
    return { ...dto(row), signingSecret: secret.value };
  },

  async update(id: string, input: UpdateWebhookInput) {
    await requireOrg('integration.manage');
    const before = await findWebhook(id);
    if (input.url) assertSafeOutboundUrl(input.url, 'url');
    const row = await tenantDb().webhook.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.url !== undefined ? { url: input.url } : {}),
        ...(input.events !== undefined ? { events: validateEvents(input.events) } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.isActive !== undefined
          ? { isActive: input.isActive, ...(input.isActive ? { consecutiveFailures: 0 } : {}) }
          : {}),
      },
    });
    await audit.record({
      action: 'webhook.update',
      entityType: 'webhook',
      entityId: id,
      before: { ...dto(before) },
      after: { ...dto(row) },
    });
    return dto(row);
  },

  async rotateSecret(id: string): Promise<WebhookCreatedDto> {
    await requireOrg('integration.manage');
    const before = await findWebhook(id);
    const secret = await storeSigningSecret(id);
    const row = await tenantDb().webhook.update({ where: { id }, data: { secretId: secret.id } });
    if (before.secretId !== secret.id) await deleteSecretInternal(before.secretId);
    await audit.record({ action: 'webhook.rotate_secret', entityType: 'webhook', entityId: id });
    return { ...dto(row), signingSecret: secret.value };
  },

  async remove(id: string) {
    await requireOrg('integration.manage');
    const before = await findWebhook(id);
    await tenantDb().webhook.delete({ where: { id } });
    await deleteSecretInternal(before.secretId);
    await audit.record({
      action: 'webhook.delete',
      entityType: 'webhook',
      entityId: id,
      before: { ...dto(before) },
    });
  },

  async deliveries(id: string, query: ListWebhookDeliveriesQuery) {
    await requireOrg('integration.view');
    await findWebhook(id);
    const where: Prisma.WebhookEventWhereInput = {
      webhookId: id,
      ...(query.status ? { status: query.status } : {}),
    };
    const db = tenantDb();
    const [rows, total] = await Promise.all([
      db.webhookEvent.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...toPageWindow(query),
      }),
      db.webhookEvent.count({ where }),
    ]);
    return toListResponse(rows.map(deliveryDto), total, query);
  },

  /** Re-send a past delivery as a NEW delivery row (same event id, `replayOfId` set). */
  async replay(id: string, deliveryId: string) {
    await requireOrg('integration.manage');
    const hook = await findWebhook(id);
    const original = await tenantDb().webhookEvent.findFirst({
      where: { id: deliveryId, webhookId: id },
    });
    if (!original) throw new NotFoundError('Webhook delivery');
    if (!hook.isActive) throw new AppError(409, 'WEBHOOK_INACTIVE', 'Activate the webhook first');
    const row = await createDelivery(hook.id, {
      eventId: original.eventId,
      eventKey: original.eventKey,
      payload: original.payload as Prisma.InputJsonValue,
      replayOfId: original.id,
    });
    await audit.record({
      action: 'webhook.replay',
      entityType: 'webhook',
      entityId: id,
      metadata: { deliveryId: original.id, newDeliveryId: row.id },
    });
    return deliveryDto(row);
  },
};

async function createDelivery(
  webhookId: string,
  input: { eventId: string; eventKey: string; payload: Prisma.InputJsonValue; replayOfId?: string },
) {
  const row = await tenantDb().webhookEvent.create({
    data: withTenant({ webhookId, ...input, status: 'PENDING' }),
  });
  await enqueue(
    'webhooks.deliver',
    { organizationId: currentOrganizationId(), deliveryId: row.id },
    { jobId: `webhook-delivery:${row.id}:0` },
  );
  return row;
}

/** Fan-out subscriber: idempotent per (webhook, event). */
async function fanOut(event: DomainEvent) {
  const type = getEventType(event.eventKey);
  if (!type || type.webhook === false) return;
  const db = tenantDb();
  const hooks = await db.webhook.findMany({ where: { isActive: true } });
  for (const hook of hooks) {
    const patterns = (hook.events as string[]) ?? [];
    if (!patterns.some((p) => matchesEventPattern(p, event.eventKey))) continue;
    const exists = await db.webhookEvent.findFirst({
      where: { webhookId: hook.id, eventId: event.id, replayOfId: null },
      select: { id: true },
    });
    if (exists) continue;
    await createDelivery(hook.id, {
      eventId: event.id,
      eventKey: event.eventKey,
      payload: {
        id: event.id,
        event: event.eventKey,
        occurredAt: event.occurredAt.toISOString(),
        organizationId: event.organizationId,
        institutionId: event.institutionId,
        data: event.payload,
      } as Prisma.InputJsonValue,
    });
  }
}

onEvent('*', 'webhooks.fanout', fanOut);

/**
 * One delivery attempt. Retries are scheduled explicitly (row status RETRYING + delayed job)
 * rather than by queue retries, so the backoff schedule and history live in the database.
 */
export async function deliverWebhook(deliveryId: string): Promise<void> {
  const db = tenantDb();
  const delivery = await db.webhookEvent.findFirst({ where: { id: deliveryId } });
  if (!delivery || delivery.status === 'DELIVERED' || delivery.status === 'FAILED') return;
  const hook = await db.webhook.findFirst({ where: { id: delivery.webhookId } });
  if (!hook || !hook.isActive) {
    await db.webhookEvent.update({
      where: { id: deliveryId },
      data: { status: 'FAILED', lastError: 'Webhook inactive or deleted', nextAttemptAt: null },
    });
    return;
  }
  const attempt = delivery.attempts + 1;
  const body = JSON.stringify(delivery.payload);
  const timestamp = Math.floor(Date.now() / 1000);
  let statusCode: number | null = null;
  let error: string | null = null;
  try {
    assertSafeOutboundUrl(hook.url, 'url');
    const secret = await getSecretById({ id: hook.secretId, purpose: 'webhook.sign' });
    if (!secret) throw new Error('Signing secret missing');
    const res = await outboundRequest({
      method: 'POST',
      url: hook.url,
      headers: {
        'content-type': 'application/json',
        'user-agent': 'ERP-Webhooks/1.0',
        'x-erp-event': delivery.eventKey,
        'x-erp-delivery': delivery.id,
        'x-erp-timestamp': String(timestamp),
        'x-erp-signature': signWebhookPayload(secret.reveal(), timestamp, body),
      },
      body,
    });
    statusCode = res.status;
    if (res.status < 200 || res.status >= 300) error = `HTTP ${res.status}`;
  } catch (err) {
    error = (err as Error).message.slice(0, 1000);
  }
  const now = new Date();
  if (!error) {
    await db.webhookEvent.update({
      where: { id: deliveryId },
      data: {
        status: 'DELIVERED',
        attempts: attempt,
        lastStatusCode: statusCode,
        lastError: null,
        deliveredAt: now,
        nextAttemptAt: null,
      },
    });
    await db.webhook.update({
      where: { id: hook.id },
      data: { consecutiveFailures: 0, lastSuccessAt: now },
    });
    return;
  }
  const exhausted = attempt >= WEBHOOK_MAX_ATTEMPTS;
  const delay = WEBHOOK_BACKOFF_MS[Math.min(attempt - 1, WEBHOOK_BACKOFF_MS.length - 1)] ?? 0;
  await db.webhookEvent.update({
    where: { id: deliveryId },
    data: {
      status: exhausted ? 'FAILED' : 'RETRYING',
      attempts: attempt,
      lastStatusCode: statusCode,
      lastError: error,
      nextAttemptAt: exhausted ? null : new Date(now.getTime() + delay),
    },
  });
  await db.webhook.update({
    where: { id: hook.id },
    data: { consecutiveFailures: { increment: 1 }, lastFailureAt: now },
  });
  if (!exhausted) {
    await enqueue(
      'webhooks.deliver',
      { organizationId: currentOrganizationId(), deliveryId },
      { delayMs: delay, jobId: `webhook-delivery:${deliveryId}:${attempt}` },
    );
  } else {
    logger.warn({ webhookId: hook.id, deliveryId }, 'Webhook delivery failed permanently');
  }
}

defineJob<{ organizationId: string; deliveryId: string }>({
  name: 'webhooks.deliver',
  attempts: 1,
  handler: async ({ deliveryId }) => deliverWebhook(deliveryId),
});

import { Prisma, type CommunicationProvider, type MessageLog } from '@prisma/client';
import type { MessageChannel, MessageStatus } from '@erp/shared';
import { env } from '../config/env';
import { tryGetPrincipal } from '../authz/principal';
import { assertFeatureEnabled } from '../features/features';
import { consumeLimit } from '../features/limits';
import { ValidationError } from '../http/errors';
import { defaultRateLimitStore } from '../http/rate-limit';
import { logger } from '../logger';
import { defineJob, enqueue, type JobRunInfo } from '../queue';
import { getSecretById } from '../secrets';
import type { SettingTarget } from '../settings/target';
import { currentOrganizationId } from '../tenancy/context';
import { tenantDb, withTenant } from '../tenancy/tenant-db';
import { resolveContacts } from './contacts';
import {
  platformSmtpProvider,
  providerAdapter,
  ProviderError,
  type OutboundMessage,
  type ProviderAdapter,
  type ProviderContext,
  type SendResult,
} from './providers';
import { TemplateSyntaxError } from './renderer';
import { renderMessage, resolveTemplate, targetFor, type ResolvedTemplate } from './templates';

export interface MessageRecipient {
  userId?: string | null;
  address?: string | null;
  name?: string | null;
  variables?: Record<string, unknown>;
}

export interface SendMessagesInput {
  channel: MessageChannel;
  recipients: MessageRecipient[];
  /** Template key (tenant template or registered default) — or inline subject/body. */
  templateKey?: string | null;
  subject?: string | null;
  body?: string | null;
  htmlBody?: string | null;
  variables?: Record<string, unknown>;
  institutionId?: string | null;
  eventKey?: string | null;
  campaignId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface SentMessageRef {
  id: string;
  status: MessageStatus;
  recipientAddress: string;
  recipientUserId: string | null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[1-9]\d{6,14}$/;

function normalizeAddress(channel: MessageChannel, raw: string): string | null {
  const v = raw.trim();
  if (channel === 'email') return EMAIL.test(v) && v.length <= 254 ? v.toLowerCase() : null;
  const phone = v.replace(/[\s()-]/g, '');
  return PHONE.test(phone) ? (phone.startsWith('+') ? phone : `+${phone}`) : null;
}

async function loadTemplate(
  input: Pick<SendMessagesInput, 'templateKey' | 'subject' | 'body' | 'htmlBody' | 'channel'>,
  target: SettingTarget,
): Promise<ResolvedTemplate> {
  if (input.templateKey) {
    const t = await resolveTemplate(input.templateKey, input.channel, target);
    if (!t) {
      throw new ValidationError(`No ${input.channel} template "${input.templateKey}"`, {
        field: 'templateKey',
      });
    }
    return t;
  }
  if (!input.body) throw new ValidationError('Give either templateKey or body', { field: 'body' });
  return {
    source: 'default',
    templateId: null,
    key: '',
    channel: input.channel,
    version: null,
    subject: input.subject ?? null,
    body: input.body,
    htmlBody: input.htmlBody ?? null,
    useBrandedLayout: true,
  };
}

/** Assert the communication module + channel feature are enabled for the target. */
export async function assertChannelEnabled(channel: MessageChannel, institutionId?: string | null) {
  await assertFeatureEnabled('communication', { institutionId });
  await assertFeatureEnabled(channel, { institutionId });
}

/**
 * Queue messages to recipients (users or raw addresses) on one channel of the CURRENT tenant.
 * Enforces the channel feature flags and the `communication_messages` plan limit (one unit per
 * addressable recipient), renders each message (template + branding), writes message_logs
 * (QUEUED) and enqueues delivery. Recipients without an address are logged as SKIPPED.
 */
export async function sendMessages(input: SendMessagesInput): Promise<SentMessageRef[]> {
  await assertChannelEnabled(input.channel, input.institutionId);
  const target = await targetFor(input.institutionId);
  const template = await loadTemplate(input, target);

  const contacts = await resolveContacts(
    input.channel,
    input.recipients.map((r) => r.userId).filter((v): v is string => !!v),
  );
  const prepared = input.recipients.map((r) => {
    const contact = r.userId ? contacts.get(r.userId) : null;
    const raw = r.address ?? contact?.address ?? null;
    return {
      recipient: r,
      name: r.name ?? contact?.name ?? null,
      address: raw ? normalizeAddress(input.channel, raw) : null,
      raw,
    };
  });
  const deliverable = prepared.filter((p) => p.address);
  if (deliverable.length > 0) await consumeLimit('communication_messages', deliverable.length);

  const db = tenantDb();
  const createdById = tryGetPrincipal()?.userId ?? null;
  const refs: SentMessageRef[] = [];
  for (const p of prepared) {
    const variables = {
      ...input.variables,
      ...p.recipient.variables,
      recipient: { name: p.name, address: p.address, userId: p.recipient.userId ?? null },
    };
    let rendered;
    try {
      rendered = await renderMessage({
        channel: input.channel,
        subject: template.subject,
        body: template.body,
        htmlBody: template.htmlBody,
        useBrandedLayout: template.useBrandedLayout,
        variables,
        target,
      });
    } catch (err) {
      if (err instanceof TemplateSyntaxError) {
        throw new ValidationError(`Template error: ${err.message}`, { field: 'body' });
      }
      throw err;
    }
    const log = await db.messageLog.create({
      data: withTenant({
        institutionId: input.institutionId ?? null,
        channel: input.channel,
        status: p.address ? 'QUEUED' : 'SKIPPED',
        recipientAddress: (p.address ?? p.raw ?? '(none)').slice(0, 254),
        recipientUserId: p.recipient.userId ?? null,
        subject: rendered.subject?.slice(0, 500) ?? null,
        body: rendered.text,
        htmlBody: rendered.html,
        templateKey: template.key || null,
        templateVersion: template.version,
        eventKey: input.eventKey ?? null,
        campaignId: input.campaignId ?? null,
        lastError: p.address ? null : 'NO_ADDRESS',
        metadata: input.metadata ? (input.metadata as Prisma.InputJsonValue) : Prisma.DbNull,
        createdById,
      }),
    });
    if (p.address) {
      await enqueue('communication.deliver', {
        organizationId: currentOrganizationId(),
        logId: log.id,
      });
    }
    refs.push({
      id: log.id,
      status: log.status,
      recipientAddress: log.recipientAddress,
      recipientUserId: log.recipientUserId,
    });
  }
  return refs;
}

/**
 * Send a SENSITIVE transactional email (invite / password reset links) synchronously. The
 * rendered body is NOT stored in message_logs (only the subject); no feature / plan-limit gates
 * (account access must keep working). Returns the log status; never throws on delivery failure.
 */
export async function sendSystemEmail(input: {
  to: string;
  toName?: string | null;
  userId?: string | null;
  templateKey: string;
  variables: Record<string, unknown>;
  institutionId?: string | null;
}): Promise<{ id: string; status: MessageStatus }> {
  const target = await targetFor(input.institutionId);
  const template = await loadTemplate({ channel: 'email', templateKey: input.templateKey }, target);
  const rendered = await renderMessage({
    channel: 'email',
    subject: template.subject,
    body: template.body,
    htmlBody: template.htmlBody,
    useBrandedLayout: template.useBrandedLayout,
    variables: {
      ...input.variables,
      recipient: { name: input.toName ?? null, address: input.to, userId: input.userId ?? null },
    },
    target,
  });
  const log = await tenantDb().messageLog.create({
    data: withTenant({
      institutionId: input.institutionId ?? null,
      channel: 'email',
      status: 'QUEUED',
      recipientAddress: input.to.slice(0, 254),
      recipientUserId: input.userId ?? null,
      subject: rendered.subject?.slice(0, 500) ?? null,
      body: null,
      htmlBody: null,
      sensitive: true,
      templateKey: template.key,
      templateVersion: template.version,
      createdById: tryGetPrincipal()?.userId ?? null,
    }),
  });
  try {
    await deliver(
      log,
      { subject: rendered.subject, text: rendered.text, html: rendered.html },
      {
        attempt: 1,
        maxAttempts: 1,
        jobId: 'sync',
      },
    );
  } catch (err) {
    logger.error({ logId: log.id, err: (err as Error).message }, 'System email failed');
  }
  const after = await tenantDb().messageLog.findFirst({
    where: { id: log.id },
    select: { status: true },
  });
  return { id: log.id, status: after?.status ?? 'FAILED' };
}

/* ---------------------------------------------------------------- delivery ---- */

interface Candidate {
  provider: CommunicationProvider | null;
  adapter: ProviderAdapter;
}

const SPECIFICITY = { INSTITUTION: 0, GROUP: 1, ORGANIZATION: 2 } as const;

/**
 * Active providers for a channel, most specific level first (institution → group →
 * organization), then by priority. Without any configured provider: e-mail falls back to the
 * platform mailer (MAIL_DRIVER); outside production every channel falls back to the log outbox.
 */
export async function selectProviders(
  channel: MessageChannel,
  institutionId: string | null,
): Promise<Candidate[]> {
  const target = await targetFor(institutionId);
  const rows = await tenantDb().communicationProvider.findMany({
    where: {
      channel,
      isActive: true,
      OR: [
        { scopeType: 'ORGANIZATION' },
        ...(target.groupId ? [{ scopeType: 'GROUP' as const, targetId: target.groupId }] : []),
        ...(target.institutionId
          ? [{ scopeType: 'INSTITUTION' as const, targetId: target.institutionId }]
          : []),
      ],
    },
  });
  rows.sort(
    (a, b) =>
      SPECIFICITY[a.scopeType] - SPECIFICITY[b.scopeType] ||
      a.priority - b.priority ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const candidates = rows
    .map((provider) => ({ provider, adapter: providerAdapter(provider.providerType) }))
    .filter((c): c is { provider: (typeof rows)[number]; adapter: ProviderAdapter } => !!c.adapter);
  if (candidates.length > 0) return candidates;
  if (channel === 'email' && env.MAIL_DRIVER === 'smtp' && env.SMTP_URL) {
    return [{ provider: null, adapter: platformSmtpProvider(env.SMTP_URL, env.MAIL_FROM) }];
  }
  if (env.NODE_ENV !== 'production' || channel === 'email') {
    return [{ provider: null, adapter: providerAdapter('log')! }];
  }
  return [];
}

async function providerContext(provider: CommunicationProvider | null): Promise<ProviderContext> {
  if (!provider) return { providerId: null, config: { from: env.MAIL_FROM }, credentials: null };
  const secret = provider.credentialSecretId
    ? await getSecretById({ id: provider.credentialSecretId, purpose: 'communication.send' })
    : null;
  return {
    providerId: provider.id,
    config: (provider.config as ProviderContext['config']) ?? {},
    credentials: secret?.reveal() ?? null,
  };
}

const truncate = (s: string, n = 1000) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

async function recordEvent(
  logId: string,
  status: string,
  rawStatus: string | null,
  payload?: unknown,
) {
  await tenantDb().deliveryEvent.create({
    data: withTenant({
      messageLogId: logId,
      status,
      rawStatus,
      payload: payload === undefined ? Prisma.DbNull : (payload as Prisma.InputJsonValue),
      occurredAt: new Date(),
    }),
  });
}

/**
 * Try each candidate provider in order (fallback). Success → SENT (or DELIVERED). Throws a
 * retryable error to the queue while attempts remain; permanently FAILED otherwise.
 */
async function deliver(
  log: MessageLog,
  content: { subject: string | null; text: string; html: string | null },
  info: JobRunInfo,
): Promise<void> {
  const db = tenantDb();
  const candidates = await selectProviders(log.channel as MessageChannel, log.institutionId);
  const errors: string[] = [];
  let retryable = false;
  if (candidates.length === 0) errors.push('NO_PROVIDER: no active provider for the channel');
  for (const { provider, adapter } of candidates) {
    const label = provider ? `${provider.name} (${provider.providerType})` : adapter.type;
    if (provider?.rateLimitPerMinute) {
      const { count } = await defaultRateLimitStore().hit(`comm:${provider.id}`, 60_000);
      if (count > provider.rateLimitPerMinute) {
        errors.push(`${label}: RATE_LIMITED`);
        retryable = true;
        continue;
      }
    }
    const message: OutboundMessage = {
      logId: log.id,
      organizationId: log.organizationId,
      channel: log.channel as MessageChannel,
      to: log.recipientAddress,
      subject: content.subject,
      text: content.text,
      html: content.html,
    };
    let result: SendResult;
    try {
      result = await adapter.send(message, await providerContext(provider));
    } catch (err) {
      const msg = (err as Error).message;
      errors.push(`${label}: ${msg}`);
      if (!(err instanceof ProviderError) || err.retryable) retryable = true;
      continue;
    }
    const now = new Date();
    const cost =
      result.cost ?? (provider?.costPerMessage != null ? Number(provider.costPerMessage) : null);
    const status = result.status ?? 'SENT';
    await db.messageLog.update({
      where: { id: log.id },
      data: {
        status,
        providerId: provider?.id ?? null,
        providerType: provider?.providerType ?? adapter.type,
        providerMessageId: result.providerMessageId,
        cost,
        attempts: { increment: 1 },
        lastError: errors.length > 0 ? truncate(errors.join('; ')) : null,
        sentAt: now,
        ...(status === 'DELIVERED' ? { deliveredAt: now } : {}),
      },
    });
    await recordEvent(log.id, status, null, { provider: label, attempt: info.attempt });
    return;
  }
  // All candidates failed.
  const final = !retryable || info.attempt >= info.maxAttempts;
  await db.messageLog.update({
    where: { id: log.id },
    data: {
      attempts: { increment: 1 },
      lastError: truncate(errors.join('; ')),
      ...(final ? { status: 'FAILED', failedAt: new Date() } : {}),
    },
  });
  if (final) {
    await recordEvent(log.id, 'FAILED', null, { errors: errors.slice(0, 5) });
    return;
  }
  throw new Error(`Delivery failed (attempt ${info.attempt}): ${errors.join('; ')}`);
}

defineJob<{ organizationId: string; logId: string }>({
  name: 'communication.deliver',
  attempts: 5,
  backoffMs: 10_000,
  handler: async ({ logId }, info) => {
    const log = await tenantDb().messageLog.findFirst({ where: { id: logId } });
    if (!log || log.status !== 'QUEUED' || log.sensitive || log.body === null) return;
    await deliver(log, { subject: log.subject, text: log.body, html: log.htmlBody }, info);
  },
});

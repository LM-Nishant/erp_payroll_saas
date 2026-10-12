import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  deliveryCallbackSchema,
  type CampaignDto,
  type CommunicationProviderCreatedDto,
  type CommunicationProviderDto,
  type AudiencePreviewDto,
  type CampaignAudienceDto,
  type CreateBroadcastInput,
  type CreateCampaignInput,
  type CreateCommunicationProviderInput,
  type CreateMessageTemplateInput,
  type ListMessageLogsQuery,
  type ListProvidersQuery,
  type ListTemplatesQuery,
  type MessageChannel,
  type MessageLogDto,
  type MessageTemplateDto,
  type MessageTemplateVersionDto,
  type RenderedMessageDto,
  type ReviseMessageTemplateInput,
  type SendMessageInput,
  type UpdateCommunicationProviderInput,
  type PaginationQuery,
  type PreviewAudienceInput,
  type ProviderTestResultDto,
} from '@erp/shared';
import {
  Prisma,
  type Campaign,
  type CommunicationProvider,
  type MessageLog,
  type MessageTemplate,
  type MessageTemplateVersion,
} from '@prisma/client';
import { audit } from '../audit';
import { accessFor, authorize, currentPrincipal } from '../authz';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { assertWithinLimit } from '../features/limits';
import {
  AppError,
  ConflictError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from '../http/errors';
import { assertSafeOutboundUrl } from '../http/outbound';
import { toListResponse, toPageWindow } from '../http/pagination';
import { logger } from '../logger';
import { defineJob, enqueue, runAsSystem } from '../queue';
import { deleteSecretInternal, getSecretById, putSecret } from '../secrets';
import {
  resolveSettingTarget,
  targetResource,
  whereForInstitutionAccess,
  whereForTargetAccess,
  type SettingTarget,
} from '../settings/target';
import { tenantDb, withTenant } from '../tenancy/tenant-db';
import { resolveAudience } from './audience';
import {
  assertChannelEnabled,
  sendMessages,
  sendProviderTest,
  type MessageRecipient,
  type SentMessageRef,
} from './messaging';
import { providerAdapter, type CallbackRequest, type DeliveryUpdate } from './providers';
import { extractVariables, TemplateSyntaxError, validateTemplate } from './renderer';
import { listDefaultTemplates, renderMessage, resolveTemplate, targetFor } from './templates';

/* ---------------------------------------------------------------- helpers ---- */

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
const num = (d: Prisma.Decimal | null | undefined) => (d == null ? null : Number(d));

const rowTarget = (row: {
  scopeType: SettingTarget['scopeType'];
  targetId: string;
  groupId: string | null;
  institutionId: string | null;
}): SettingTarget => ({
  scopeType: row.scopeType,
  targetId: row.targetId,
  groupId: row.groupId,
  institutionId: row.institutionId,
});

async function authorizeTarget(permission: string, target: SettingTarget) {
  await authorize(currentPrincipal(), permission, targetResource(target));
}

/** 404 (not 403) for rows outside the caller's view scope. */
async function authorizeRow(
  permission: string,
  target: SettingTarget,
  resource: string,
  viewPermission = 'communication.view',
) {
  try {
    await authorizeTarget(permission, target);
  } catch (err) {
    if (permission === viewPermission) throw new NotFoundError(resource);
    throw err;
  }
}

function assertTemplateSyntax(...sources: Array<string | null | undefined>) {
  try {
    for (const s of sources) if (s) validateTemplate(s);
  } catch (err) {
    if (err instanceof TemplateSyntaxError) {
      throw new ValidationError(`Template error: ${err.message}`, { field: 'body' });
    }
    throw err;
  }
}

const credentialKind = (p: { channel: string; providerType: string }) =>
  p.providerType === 'smtp' || p.providerType === 'ses' ? 'smtp' : p.channel;

const webhookUrl = (id: string) => `${env.API_PUBLIC_URL}/api/v1/communication/webhooks/${id}`;

/* -------------------------------------------------------------- providers ---- */

function providerDto(row: CommunicationProvider): CommunicationProviderDto {
  return {
    id: row.id,
    scopeType: row.scopeType,
    targetId: row.targetId,
    channel: row.channel as MessageChannel,
    providerType: row.providerType as CommunicationProviderDto['providerType'],
    name: row.name,
    priority: row.priority,
    config: (row.config as CommunicationProviderDto['config']) ?? {},
    hasCredentials: !!row.credentialSecretId,
    rateLimitPerMinute: row.rateLimitPerMinute,
    costPerMessage: num(row.costPerMessage),
    isActive: row.isActive,
    webhookUrl: webhookUrl(row.id),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const providerAudit = (row: CommunicationProvider) => ({
  channel: row.channel,
  providerType: row.providerType,
  name: row.name,
  priority: row.priority,
  config: row.config,
  scopeType: row.scopeType,
  targetId: row.targetId,
  isActive: row.isActive,
  rateLimitPerMinute: row.rateLimitPerMinute,
  hasCredentials: !!row.credentialSecretId,
});

function validateProviderConfig(providerType: string, config: Record<string, unknown>) {
  if (providerType === 'http' && typeof config.url === 'string') {
    assertSafeOutboundUrl(config.url, 'config.url');
  }
  if (providerType === 'http' && typeof config.url !== 'string') {
    throw new ValidationError('config.url is required for the http provider', {
      field: 'config.url',
    });
  }
}

async function findProvider(id: string, permission: string) {
  const row = await tenantDb().communicationProvider.findFirst({ where: { id } });
  if (!row) throw new NotFoundError('Communication provider');
  await authorizeRow(permission, rowTarget(row), 'Communication provider');
  return row;
}

async function storeWebhookSecret(
  target: SettingTarget,
  providerId: string,
): Promise<{ id: string; value: string }> {
  const value = `whsec_${randomBytes(24).toString('base64url')}`;
  const stored = await putSecret({
    target,
    kind: 'communication.webhook',
    name: `provider-${providerId}`,
    value,
    description: 'Delivery-callback signing secret',
  });
  return { id: stored.id, value };
}

export const providersService = {
  async list(query: ListProvidersQuery) {
    const access = await accessFor(currentPrincipal(), 'communication.view');
    const scope = whereForTargetAccess(access);
    const where: Prisma.CommunicationProviderWhereInput = {
      ...(query.channel ? { channel: query.channel } : {}),
      ...(scope ? { AND: [scope] } : {}),
    };
    const db = tenantDb();
    const [rows, total] = await Promise.all([
      db.communicationProvider.findMany({
        where,
        orderBy: [{ channel: 'asc' }, { priority: 'asc' }, { createdAt: 'asc' }],
        ...toPageWindow(query),
      }),
      db.communicationProvider.count({ where }),
    ]);
    return toListResponse(rows.map(providerDto), total, query);
  },

  async get(id: string) {
    return providerDto(await findProvider(id, 'communication.view'));
  },

  async create(input: CreateCommunicationProviderInput): Promise<CommunicationProviderCreatedDto> {
    const target = await resolveSettingTarget(input.scopeType, input.targetId);
    await authorizeTarget('communication.manage', target);
    validateProviderConfig(input.providerType, input.config);
    const db = tenantDb();
    const principal = currentPrincipal();
    let row = await db.communicationProvider.create({
      data: withTenant({
        scopeType: target.scopeType,
        targetId: target.targetId,
        groupId: target.groupId,
        institutionId: target.institutionId,
        channel: input.channel,
        providerType: input.providerType,
        name: input.name,
        priority: input.priority,
        config: input.config as Prisma.InputJsonValue,
        rateLimitPerMinute: input.rateLimitPerMinute ?? null,
        costPerMessage: input.costPerMessage ?? null,
        isActive: input.isActive,
        createdById: principal.userId,
      }),
    });
    const webhook = await storeWebhookSecret(target, row.id);
    const credential = input.credentials
      ? await putSecret({
          target,
          kind: credentialKind(row),
          name: `provider-${row.id}`,
          value: input.credentials,
          description: `Credentials of communication provider "${row.name}"`,
        })
      : null;
    row = await db.communicationProvider.update({
      where: { id: row.id },
      data: { webhookSecretId: webhook.id, credentialSecretId: credential?.id ?? null },
    });
    await audit.record({
      action: 'communication_provider.create',
      entityType: 'communication_provider',
      entityId: row.id,
      after: providerAudit(row),
    });
    return { ...providerDto(row), webhookSigningSecret: webhook.value };
  },

  async update(id: string, input: UpdateCommunicationProviderInput) {
    const before = await findProvider(id, 'communication.manage');
    const target = rowTarget(before);
    if (input.config) validateProviderConfig(before.providerType, input.config);
    const credential = input.credentials
      ? await putSecret({
          target,
          kind: credentialKind(before),
          name: `provider-${before.id}`,
          value: input.credentials,
          description: `Credentials of communication provider "${input.name ?? before.name}"`,
        })
      : null;
    const row = await tenantDb().communicationProvider.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.config !== undefined ? { config: input.config as Prisma.InputJsonValue } : {}),
        ...(input.rateLimitPerMinute !== undefined
          ? { rateLimitPerMinute: input.rateLimitPerMinute }
          : {}),
        ...(input.costPerMessage !== undefined ? { costPerMessage: input.costPerMessage } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(credential ? { credentialSecretId: credential.id } : {}),
      },
    });
    await audit.record({
      action: 'communication_provider.update',
      entityType: 'communication_provider',
      entityId: id,
      before: providerAudit(before),
      after: providerAudit(row),
      metadata: credential ? { credentialsRotated: true } : undefined,
    });
    return providerDto(row);
  },

  /** Send one test message through exactly this provider (no fallback) and report the result. */
  async test(id: string, to: string): Promise<ProviderTestResultDto> {
    const row = await findProvider(id, 'communication.manage');
    const result = await sendProviderTest(row, to);
    await audit.record({
      action: 'communication_provider.test',
      entityType: 'communication_provider',
      entityId: id,
      metadata: { to: result.to, status: result.status, messageId: result.id },
    });
    return { messageId: result.id, status: result.status, to: result.to, error: result.error };
  },

  /** Issue a new delivery-callback signing secret (returned once). */
  async rotateWebhookSecret(id: string) {
    const row = await findProvider(id, 'communication.manage');
    const webhook = await storeWebhookSecret(rowTarget(row), row.id);
    const updated = await tenantDb().communicationProvider.update({
      where: { id },
      data: { webhookSecretId: webhook.id },
    });
    await audit.record({
      action: 'communication_provider.rotate_webhook_secret',
      entityType: 'communication_provider',
      entityId: id,
    });
    return { ...providerDto(updated), webhookSigningSecret: webhook.value };
  },

  async remove(id: string) {
    const row = await findProvider(id, 'communication.manage');
    await tenantDb().communicationProvider.delete({ where: { id } });
    for (const secretId of [row.credentialSecretId, row.webhookSecretId]) {
      if (secretId) await deleteSecretInternal(secretId);
    }
    await audit.record({
      action: 'communication_provider.delete',
      entityType: 'communication_provider',
      entityId: id,
      before: providerAudit(row),
    });
  },
};

/* -------------------------------------------------------------- templates ---- */

function versionDto(v: MessageTemplateVersion): MessageTemplateVersionDto {
  return {
    id: v.id,
    version: v.version,
    subject: v.subject,
    body: v.body,
    htmlBody: v.htmlBody,
    variables: (v.variables as string[] | null) ?? [],
    createdAt: v.createdAt.toISOString(),
  };
}

function templateDto(
  row: MessageTemplate,
  current: MessageTemplateVersion | null,
): MessageTemplateDto {
  return {
    id: row.id,
    scopeType: row.scopeType,
    targetId: row.targetId,
    key: row.key,
    channel: row.channel as MessageChannel,
    name: row.name,
    description: row.description,
    useBrandedLayout: row.useBrandedLayout,
    isActive: row.isActive,
    currentVersion: current ? versionDto(current) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function findTemplate(id: string, permission: string) {
  const row = await tenantDb().messageTemplate.findFirst({ where: { id } });
  if (!row) throw new NotFoundError('Message template');
  await authorizeRow(permission, rowTarget(row), 'Message template');
  return row;
}

async function currentVersionOf(row: MessageTemplate) {
  return tenantDb().messageTemplateVersion.findFirst({
    where: { templateId: row.id, version: row.currentVersion },
  });
}

export const templatesService = {
  async list(query: ListTemplatesQuery) {
    const access = await accessFor(currentPrincipal(), 'communication.view');
    const scope = whereForTargetAccess(access);
    const where: Prisma.MessageTemplateWhereInput = {
      ...(query.channel ? { channel: query.channel } : {}),
      ...(query.search
        ? { OR: [{ key: { contains: query.search } }, { name: { contains: query.search } }] }
        : {}),
      ...(scope ? { AND: [scope] } : {}),
    };
    const db = tenantDb();
    const [rows, total] = await Promise.all([
      db.messageTemplate.findMany({
        where,
        orderBy: [{ key: 'asc' }, { channel: 'asc' }],
        ...toPageWindow(query),
      }),
      db.messageTemplate.count({ where }),
    ]);
    const versions = rows.length
      ? await db.messageTemplateVersion.findMany({
          where: { OR: rows.map((r) => ({ templateId: r.id, version: r.currentVersion })) },
        })
      : [];
    return toListResponse(
      rows.map((r) => templateDto(r, versions.find((v) => v.templateId === r.id) ?? null)),
      total,
      query,
    );
  },

  /** Built-in templates (overridable by creating a tenant template with the same key). */
  defaults() {
    return listDefaultTemplates().map((t) => ({
      key: t.key,
      channel: t.channel,
      name: t.name,
      subject: t.subject ?? null,
      body: t.body,
      htmlBody: t.htmlBody ?? null,
      variables: extractVariables(t.subject, t.body, t.htmlBody),
    }));
  },

  async get(id: string) {
    const row = await findTemplate(id, 'communication.view');
    return templateDto(row, await currentVersionOf(row));
  },

  async versions(id: string) {
    const row = await findTemplate(id, 'communication.view');
    const rows = await tenantDb().messageTemplateVersion.findMany({
      where: { templateId: row.id },
      orderBy: { version: 'desc' },
    });
    return rows.map(versionDto);
  },

  async create(input: CreateMessageTemplateInput) {
    const target = await resolveSettingTarget(input.scopeType, input.targetId);
    await authorizeTarget('communication.manage', target);
    assertTemplateSyntax(input.subject, input.body, input.htmlBody);
    const db = tenantDb();
    const exists = await db.messageTemplate.findFirst({
      where: {
        scopeType: target.scopeType,
        targetId: target.targetId,
        key: input.key,
        channel: input.channel,
      },
      select: { id: true },
    });
    if (exists) throw new ConflictError('A template with this key already exists for the channel');
    const userId = currentPrincipal().userId;
    const row = await db.messageTemplate.create({
      data: withTenant({
        scopeType: target.scopeType,
        targetId: target.targetId,
        groupId: target.groupId,
        institutionId: target.institutionId,
        key: input.key,
        channel: input.channel,
        name: input.name,
        description: input.description ?? null,
        useBrandedLayout: input.useBrandedLayout,
        currentVersion: 1,
      }),
    });
    const version = await db.messageTemplateVersion.create({
      data: withTenant({
        templateId: row.id,
        version: 1,
        subject: input.subject ?? null,
        body: input.body,
        htmlBody: input.htmlBody ?? null,
        variables: extractVariables(input.subject, input.body, input.htmlBody),
        createdById: userId,
      }),
    });
    await audit.record({
      action: 'message_template.create',
      entityType: 'message_template',
      entityId: row.id,
      after: { key: row.key, channel: row.channel, name: row.name, version: 1 },
    });
    return templateDto(row, version);
  },

  async revise(id: string, input: ReviseMessageTemplateInput) {
    const before = await findTemplate(id, 'communication.manage');
    assertTemplateSyntax(input.subject, input.body, input.htmlBody);
    const db = tenantDb();
    const next = before.currentVersion + 1;
    const version = await db.messageTemplateVersion.create({
      data: withTenant({
        templateId: before.id,
        version: next,
        subject: input.subject ?? null,
        body: input.body,
        htmlBody: input.htmlBody ?? null,
        variables: extractVariables(input.subject, input.body, input.htmlBody),
        createdById: currentPrincipal().userId,
      }),
    });
    const row = await db.messageTemplate.update({
      where: { id },
      data: {
        currentVersion: next,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.useBrandedLayout !== undefined
          ? { useBrandedLayout: input.useBrandedLayout }
          : {}),
      },
    });
    await audit.record({
      action: 'message_template.revise',
      entityType: 'message_template',
      entityId: id,
      before: { version: before.currentVersion, name: before.name },
      after: { version: next, name: row.name },
    });
    return templateDto(row, version);
  },

  async setActive(id: string, isActive: boolean) {
    const before = await findTemplate(id, 'communication.manage');
    const row = await tenantDb().messageTemplate.update({ where: { id }, data: { isActive } });
    await audit.record({
      action: isActive ? 'message_template.activate' : 'message_template.deactivate',
      entityType: 'message_template',
      entityId: id,
      before: { isActive: before.isActive },
      after: { isActive },
    });
    return templateDto(row, await currentVersionOf(row));
  },

  async remove(id: string) {
    const row = await findTemplate(id, 'communication.manage');
    await tenantDb().messageTemplate.delete({ where: { id } });
    await audit.record({
      action: 'message_template.delete',
      entityType: 'message_template',
      entityId: id,
      before: { key: row.key, channel: row.channel, name: row.name },
    });
  },

  /** Render the current version with sample variables (and the target's branding). */
  async preview(id: string, variables: Record<string, unknown>): Promise<RenderedMessageDto> {
    const row = await findTemplate(id, 'communication.view');
    const version = await currentVersionOf(row);
    if (!version) throw new NotFoundError('Template version');
    return renderMessage({
      channel: row.channel as MessageChannel,
      subject: version.subject,
      body: version.body,
      htmlBody: version.htmlBody,
      useBrandedLayout: row.useBrandedLayout,
      variables,
      target: rowTarget(row),
    });
  },

  /** Render a template by key the way a send would resolve it (institution → org → default). */
  async previewByKey(
    key: string,
    channel: MessageChannel,
    variables: Record<string, unknown>,
    institutionId?: string | null,
  ) {
    const target = await targetFor(institutionId);
    await authorizeTarget('communication.view', target);
    const t = await resolveTemplate(key, channel, target);
    if (!t) throw new NotFoundError('Message template');
    return renderMessage({ ...t, variables, target });
  },
};

/* --------------------------------------------------------------- messages ---- */

type ProviderInfo = Pick<CommunicationProvider, 'id' | 'name' | 'scopeType'>;

/** Name + level of the providers that delivered these logs (institution / group / org). */
async function providersOf(rows: MessageLog[]): Promise<Map<string, ProviderInfo>> {
  const ids = [...new Set(rows.map((r) => r.providerId).filter((v): v is string => !!v))];
  if (ids.length === 0) return new Map();
  const providers = await tenantDb().communicationProvider.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, scopeType: true },
  });
  return new Map(providers.map((p) => [p.id, p]));
}

function logDto(
  row: MessageLog & {
    events?: Array<{ status: string; rawStatus: string | null; occurredAt: Date }>;
  },
  providers: Map<string, ProviderInfo> = new Map(),
): MessageLogDto {
  const provider = row.providerId ? providers.get(row.providerId) : undefined;
  return {
    id: row.id,
    channel: row.channel as MessageChannel,
    status: row.status,
    recipientAddress: row.recipientAddress,
    recipientUserId: row.recipientUserId,
    subject: row.subject,
    bodyPreview: row.sensitive || !row.body ? null : row.body.slice(0, 500),
    templateKey: row.templateKey,
    templateVersion: row.templateVersion,
    eventKey: row.eventKey,
    campaignId: row.campaignId,
    providerType: row.providerType,
    providerId: row.providerId,
    providerName: provider?.name ?? null,
    providerScope: provider?.scopeType ?? null,
    providerMessageId: row.providerMessageId,
    cost: num(row.cost),
    attempts: row.attempts,
    lastError: row.lastError,
    institutionId: row.institutionId,
    createdAt: row.createdAt.toISOString(),
    sentAt: iso(row.sentAt),
    deliveredAt: iso(row.deliveredAt),
    failedAt: iso(row.failedAt),
    ...(row.events
      ? {
          events: row.events.map((e) => ({
            status: e.status,
            rawStatus: e.rawStatus,
            occurredAt: e.occurredAt.toISOString(),
          })),
        }
      : {}),
  };
}

async function institutionResource(institutionId?: string | null) {
  if (!institutionId) return {};
  const target = await resolveSettingTarget('INSTITUTION', institutionId);
  return targetResource(target);
}

export const messagesService = {
  /** Send to up to 100 recipients now (`message.send` in the institution / organization). */
  async send(input: SendMessageInput): Promise<SentMessageRef[]> {
    await authorize(
      currentPrincipal(),
      'message.send',
      await institutionResource(input.institutionId),
    );
    const refs = await sendMessages({
      channel: input.channel,
      recipients: input.recipients,
      templateKey: input.templateKey ?? null,
      subject: input.subject ?? null,
      body: input.body ?? null,
      variables: input.variables,
      institutionId: input.institutionId ?? null,
    });
    await audit.record({
      action: 'message.send',
      entityType: 'message',
      metadata: {
        channel: input.channel,
        templateKey: input.templateKey ?? null,
        recipients: refs.length,
        queued: refs.filter((r) => r.status === 'QUEUED').length,
        institutionId: input.institutionId ?? null,
      },
    });
    return refs;
  },

  async list(query: ListMessageLogsQuery) {
    const access = await accessFor(currentPrincipal(), 'communication.view');
    if (!access.all && query.institutionId && !access.institutionIds.has(query.institutionId)) {
      return toListResponse([], 0, query);
    }
    const scope = whereForInstitutionAccess(access);
    const where: Prisma.MessageLogWhereInput = {
      ...(query.channel ? { channel: query.channel } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.campaignId ? { campaignId: query.campaignId } : {}),
      ...(query.institutionId ? { institutionId: query.institutionId } : {}),
      ...(query.search
        ? {
            OR: [
              { recipientAddress: { contains: query.search } },
              { subject: { contains: query.search } },
            ],
          }
        : {}),
      ...(scope ? { AND: [scope] } : {}),
    };
    const db = tenantDb();
    const [rows, total] = await Promise.all([
      db.messageLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...toPageWindow(query) }),
      db.messageLog.count({ where }),
    ]);
    const providers = await providersOf(rows);
    return toListResponse(
      rows.map((r) => logDto(r, providers)),
      total,
      query,
    );
  },

  async get(id: string) {
    const row = await tenantDb().messageLog.findFirst({
      where: { id },
      include: { events: { orderBy: { occurredAt: 'asc' } } },
    });
    if (!row) throw new NotFoundError('Message');
    const access = await accessFor(currentPrincipal(), 'communication.view');
    if (!access.all && !(row.institutionId && access.institutionIds.has(row.institutionId))) {
      throw new NotFoundError('Message');
    }
    return logDto(row, await providersOf([row]));
  },
};

/* -------------------------------------------------------------- campaigns ---- */

function campaignDto(row: Campaign): CampaignDto {
  return {
    id: row.id,
    name: row.name,
    channel: row.channel as MessageChannel,
    status: row.status as CampaignDto['status'],
    institutionId: row.institutionId,
    templateKey: row.templateKey,
    totalRecipients: row.totalRecipients,
    sentCount: row.sentCount,
    failedCount: row.failedCount,
    skippedCount: row.skippedCount,
    audience: (row.audience as CampaignAudienceDto | null) ?? null,
    subject: row.subject,
    createdById: row.createdById,
    scheduledAt: iso(row.scheduledAt),
    startedAt: iso(row.startedAt),
    completedAt: iso(row.completedAt),
    createdAt: row.createdAt.toISOString(),
  };
}

/** Visible: campaigns of institutions where the caller may send, plus the caller's own. */
async function findCampaign(id: string) {
  const row = await tenantDb().campaign.findFirst({ where: { id } });
  if (!row) throw new NotFoundError('Campaign');
  const principal = currentPrincipal();
  if (row.createdById && row.createdById === principal.userId) return row;
  const access = await accessFor(principal, 'message.send');
  if (!access.all && !(row.institutionId && access.institutionIds.has(row.institutionId))) {
    throw new NotFoundError('Campaign');
  }
  return row;
}

const CAMPAIGN_BATCH = 100;
const MAX_CAMPAIGN_RECIPIENTS = 5000;

interface CampaignDraft {
  institutionId: string | null;
  name: string;
  channel: MessageChannel;
  templateKey: string | null;
  subject: string | null;
  body: string | null;
  variables: Record<string, unknown>;
  recipients: MessageRecipient[];
  scheduledAt: Date | null;
  audience?: CampaignAudienceDto;
  skippedCount?: number;
}

/** Validate content, store the campaign + recipients and queue (or schedule) the sending job. */
async function insertCampaign(draft: CampaignDraft): Promise<Campaign> {
  await assertChannelEnabled(draft.channel, draft.institutionId);
  await assertWithinLimit('communication_messages', draft.recipients.length);
  if (draft.templateKey) {
    const t = await resolveTemplate(
      draft.templateKey,
      draft.channel,
      await targetFor(draft.institutionId),
    );
    if (!t)
      throw new ValidationError(`No ${draft.channel} template "${draft.templateKey}"`, {
        field: 'templateKey',
      });
  } else {
    assertTemplateSyntax(draft.subject, draft.body);
  }
  const db = tenantDb();
  const scheduled = !!draft.scheduledAt && draft.scheduledAt.getTime() > Date.now();
  const row = await db.campaign.create({
    data: withTenant({
      institutionId: draft.institutionId,
      name: draft.name,
      channel: draft.channel,
      status: scheduled ? 'SCHEDULED' : 'QUEUED',
      templateKey: draft.templateKey,
      subject: draft.subject,
      body: draft.body,
      variables: draft.variables as Prisma.InputJsonValue,
      totalRecipients: draft.recipients.length,
      skippedCount: draft.skippedCount ?? 0,
      audience: draft.audience
        ? (draft.audience as unknown as Prisma.InputJsonValue)
        : Prisma.DbNull,
      scheduledAt: draft.scheduledAt,
      createdById: currentPrincipal().userId,
    }),
  });
  await db.campaignRecipient.createMany({
    data: draft.recipients.map((r) =>
      withTenant({
        campaignId: row.id,
        userId: r.userId ?? null,
        address: r.address ?? null,
        name: r.name ?? null,
        variables: r.variables ? (r.variables as Prisma.InputJsonValue) : Prisma.DbNull,
      }),
    ),
  });
  await enqueue(
    'communication.campaign',
    { organizationId: row.organizationId, campaignId: row.id },
    { delayMs: scheduled ? draft.scheduledAt!.getTime() - Date.now() : 0 },
  );
  return row;
}

/** Render the first recipient's message (template or inline content) for a preview. */
async function renderFirst(
  input: PreviewAudienceInput,
  variables: Record<string, unknown>,
): Promise<AudiencePreviewDto['rendered']> {
  if (!input.templateKey && !input.body) return null;
  const target = await targetFor(input.audience.institutionId);
  const t = input.templateKey
    ? await resolveTemplate(input.templateKey, input.channel, target)
    : null;
  if (input.templateKey && !t) {
    throw new ValidationError(`No ${input.channel} template "${input.templateKey}"`, {
      field: 'templateKey',
    });
  }
  try {
    return await renderMessage({
      channel: input.channel,
      subject: t ? t.subject : (input.subject ?? null),
      body: t ? t.body : input.body!,
      htmlBody: t ? t.htmlBody : null,
      useBrandedLayout: t ? t.useBrandedLayout : true,
      variables,
      target,
    });
  } catch (err) {
    if (err instanceof TemplateSyntaxError) {
      throw new ValidationError(`Template error: ${err.message}`, { field: 'body' });
    }
    throw err;
  }
}

/**
 * Announcements: an audience (institution / department / program / class section / students /
 * staff) is resolved server-side inside the caller's scope and sent as a campaign of the
 * audience's institution — so its own email / SMS / WhatsApp provider is used.
 */
export const broadcastsService = {
  async preview(input: PreviewAudienceInput): Promise<AudiencePreviewDto> {
    const resolved = await resolveAudience(input.audience, input.channel);
    await assertChannelEnabled(input.channel, input.audience.institutionId);
    const first = resolved.members[0];
    const rendered = await renderFirst(input, {
      ...input.variables,
      ...(first?.variables ?? {}),
      recipient: first
        ? { name: first.name, address: first.address, userId: first.userId }
        : { name: 'Recipient', address: null, userId: null },
    });
    return {
      channel: input.channel,
      label: resolved.audience.label,
      total: resolved.members.length,
      byKind: resolved.byKind,
      sample: resolved.members.slice(0, 50).map(({ variables: _v, ...m }) => m),
      skipped: resolved.skipped.slice(0, 200),
      skippedCount: resolved.skipped.length,
      rendered,
    };
  },

  async create(input: CreateBroadcastInput) {
    const resolved = await resolveAudience(input.audience, input.channel, {
      schedule: !!input.scheduledAt,
    });
    if (resolved.members.length === 0) {
      throw new ValidationError(
        `Nobody in "${resolved.audience.label}" has ${input.channel === 'email' ? 'an e-mail address' : 'a phone number'}`,
        { field: 'audience' },
      );
    }
    if (resolved.members.length > MAX_CAMPAIGN_RECIPIENTS) {
      throw new ValidationError(
        `The audience has ${resolved.members.length} recipients; at most ${MAX_CAMPAIGN_RECIPIENTS} per announcement — narrow it down`,
        { field: 'audience' },
      );
    }
    const row = await insertCampaign({
      institutionId: input.audience.institutionId,
      name: input.name,
      channel: input.channel,
      templateKey: input.templateKey ?? null,
      subject: input.subject ?? null,
      body: input.body ?? null,
      variables: input.variables,
      recipients: resolved.members.map((m) => ({
        userId: m.userId,
        address: m.address,
        name: m.name,
        variables: m.variables,
      })),
      scheduledAt: input.scheduledAt ?? null,
      audience: resolved.audience,
      skippedCount: resolved.skipped.length,
    });
    await audit.record({
      action: 'campaign.broadcast',
      entityType: 'campaign',
      entityId: row.id,
      after: {
        name: row.name,
        channel: row.channel,
        audience: resolved.audience,
        recipients: row.totalRecipients,
        skipped: row.skippedCount,
        byKind: resolved.byKind,
        scheduledAt: iso(row.scheduledAt),
      },
    });
    return campaignDto(row);
  },
};

export const campaignsService = {
  async create(input: CreateCampaignInput) {
    const resource = await institutionResource(input.institutionId);
    const principal = currentPrincipal();
    await authorize(principal, 'message.send', resource);
    if (input.scheduledAt) await authorize(principal, 'message.schedule', resource);
    const row = await insertCampaign({
      institutionId: input.institutionId ?? null,
      name: input.name,
      channel: input.channel,
      templateKey: input.templateKey ?? null,
      subject: input.subject ?? null,
      body: input.body ?? null,
      variables: input.variables,
      recipients: input.recipients,
      scheduledAt: input.scheduledAt ?? null,
    });
    await audit.record({
      action: 'campaign.create',
      entityType: 'campaign',
      entityId: row.id,
      after: {
        name: row.name,
        channel: row.channel,
        recipients: row.totalRecipients,
        scheduledAt: iso(row.scheduledAt),
      },
    });
    return campaignDto(row);
  },

  async list(query: PaginationQuery) {
    const principal = currentPrincipal();
    const access = await accessFor(principal, 'message.send');
    const scope = whereForInstitutionAccess(access);
    const where: Prisma.CampaignWhereInput = scope
      ? { OR: [scope, { createdById: principal.userId }] }
      : {};
    const db = tenantDb();
    const [rows, total] = await Promise.all([
      db.campaign.findMany({ where, orderBy: { createdAt: 'desc' }, ...toPageWindow(query) }),
      db.campaign.count({ where }),
    ]);
    return toListResponse(rows.map(campaignDto), total, query);
  },

  async get(id: string) {
    return campaignDto(await findCampaign(id));
  },

  async cancel(id: string) {
    const row = await findCampaign(id);
    if (row.status !== 'SCHEDULED' && row.status !== 'QUEUED' && row.status !== 'SENDING') {
      throw new AppError(409, 'INVALID_STATE', `Campaign is ${row.status}`);
    }
    const updated = await tenantDb().campaign.update({
      where: { id },
      data: { status: 'CANCELLED', completedAt: new Date() },
    });
    await audit.record({
      action: 'campaign.cancel',
      entityType: 'campaign',
      entityId: id,
      before: { status: row.status },
      after: { status: 'CANCELLED' },
    });
    return campaignDto(updated);
  },
};

defineJob<{ organizationId: string; campaignId: string }>({
  name: 'communication.campaign',
  attempts: 3,
  handler: async ({ organizationId, campaignId }) => {
    const db = tenantDb();
    const campaign = await db.campaign.findFirst({ where: { id: campaignId } });
    if (!campaign || !['SCHEDULED', 'QUEUED', 'SENDING'].includes(campaign.status)) return;
    if (campaign.status !== 'SENDING') {
      await db.campaign.update({
        where: { id: campaignId },
        data: { status: 'SENDING', startedAt: campaign.startedAt ?? new Date() },
      });
    }
    const batch = await db.campaignRecipient.findMany({
      where: { campaignId, status: 'PENDING' },
      orderBy: { id: 'asc' },
      take: CAMPAIGN_BATCH,
    });
    if (batch.length === 0) {
      await db.campaign.update({
        where: { id: campaignId },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      return;
    }
    let refs: SentMessageRef[];
    try {
      refs = await sendMessages({
        channel: campaign.channel as MessageChannel,
        recipients: batch.map((r) => ({
          userId: r.userId,
          address: r.address,
          name: r.name,
          variables: (r.variables as Record<string, unknown> | null) ?? undefined,
        })),
        templateKey: campaign.templateKey,
        subject: campaign.subject,
        body: campaign.body,
        variables: (campaign.variables as Record<string, unknown> | null) ?? {},
        institutionId: campaign.institutionId,
        campaignId,
      });
    } catch (err) {
      // Feature disabled / limit reached / template error: stop the campaign.
      const message = (err as Error).message.slice(0, 1000);
      logger.warn({ campaignId, err: message }, 'Campaign stopped');
      await db.campaignRecipient.updateMany({
        where: { campaignId, status: 'PENDING' },
        data: { status: 'FAILED', error: message },
      });
      const failed = await db.campaignRecipient.count({ where: { campaignId, status: 'FAILED' } });
      await db.campaign.update({
        where: { id: campaignId },
        data: { status: 'FAILED', failedCount: failed, completedAt: new Date() },
      });
      return;
    }
    let sent = 0;
    let failed = 0;
    for (const [i, r] of batch.entries()) {
      const ref = refs[i]!;
      const ok = ref.status === 'QUEUED';
      if (ok) sent++;
      else failed++;
      await db.campaignRecipient.update({
        where: { id: r.id },
        data: {
          status: ok ? 'QUEUED' : 'SKIPPED',
          messageLogId: ref.id,
          error: ok ? null : 'NO_ADDRESS',
        },
      });
    }
    await db.campaign.update({
      where: { id: campaignId },
      data: { sentCount: { increment: sent }, failedCount: { increment: failed } },
    });
    await enqueue('communication.campaign', { organizationId, campaignId });
  },
});

/* ------------------------------------------------------- delivery callbacks ---- */

const STATUS_RANK: Record<string, number> = {
  SKIPPED: 0,
  QUEUED: 0,
  SENT: 1,
  DELIVERED: 2,
  FAILED: 3,
  BOUNCED: 3,
};

/** Generic ERP callback signature: `X-Erp-Signature: sha256=<hex HMAC-SHA256(raw body)>`. */
export function signDeliveryCallback(secret: string, rawBody: string | Buffer): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

function verifyGeneric(secret: string, req: CallbackRequest): boolean {
  const header = req.headers['x-erp-signature'];
  if (typeof header !== 'string') return false;
  const expected = Buffer.from(signDeliveryCallback(secret, req.rawBody));
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

function parseGeneric(body: unknown): DeliveryUpdate[] {
  const items =
    body && typeof body === 'object' && Array.isArray((body as { events?: unknown }).events)
      ? (body as { events: unknown[] }).events
      : [body];
  return items.slice(0, 500).map((item) => {
    const parsed = deliveryCallbackSchema.safeParse(item);
    if (!parsed.success) throw new ValidationError('Invalid delivery callback payload');
    return {
      providerMessageId: parsed.data.providerMessageId,
      status: parsed.data.status.toUpperCase() as DeliveryUpdate['status'],
      rawStatus: parsed.data.status,
      cost: parsed.data.cost ?? null,
      error: parsed.data.error ?? null,
      occurredAt: parsed.data.occurredAt,
    };
  });
}

async function applyUpdates(providerId: string, updates: DeliveryUpdate[]) {
  const db = tenantDb();
  let updated = 0;
  for (const u of updates) {
    const log = await db.messageLog.findFirst({
      where: { providerId, providerMessageId: u.providerMessageId },
    });
    if (!log) continue;
    const at = u.occurredAt ?? new Date();
    await db.deliveryEvent.create({
      data: withTenant({
        messageLogId: log.id,
        status: u.status,
        rawStatus: u.rawStatus.slice(0, 64),
        payload: u.error ? { error: u.error } : Prisma.DbNull,
        occurredAt: at,
      }),
    });
    if ((STATUS_RANK[u.status] ?? 0) <= (STATUS_RANK[log.status] ?? 0)) continue;
    await db.messageLog.update({
      where: { id: log.id },
      data: {
        status: u.status,
        ...(u.status === 'DELIVERED' ? { deliveredAt: at } : {}),
        ...(u.status === 'FAILED' || u.status === 'BOUNCED'
          ? { failedAt: at, lastError: u.error?.slice(0, 1000) ?? u.rawStatus }
          : {}),
        ...(u.cost != null ? { cost: u.cost } : {}),
      },
    });
    updated += 1;
  }
  return updated;
}

/**
 * Public delivery-callback endpoint handler. The provider row identifies the tenant (looked up
 * platform-wide by id); the request must carry a valid signature — provider-native (Twilio) or
 * the generic ERP HMAC with the provider's webhook signing secret. Status never moves backwards.
 */
export async function handleDeliveryCallback(
  providerId: string,
  req: CallbackRequest,
): Promise<{ received: number; updated: number }> {
  const provider = await prisma.communicationProvider.findUnique({ where: { id: providerId } });
  if (!provider) throw new NotFoundError('Communication provider');
  return runAsSystem(provider.organizationId, async () => {
    const adapter = providerAdapter(provider.providerType);
    let updates: DeliveryUpdate[] | null = null;
    if (adapter?.parseNativeCallback && req.headers['x-twilio-signature']) {
      const secret = provider.credentialSecretId
        ? await getSecretById({
            id: provider.credentialSecretId,
            purpose: 'communication.callback',
          })
        : null;
      try {
        updates = adapter.parseNativeCallback(req, {
          providerId: provider.id,
          config: (provider.config as Record<string, string>) ?? {},
          credentials: secret?.reveal() ?? null,
        });
      } catch {
        throw new UnauthenticatedError('Invalid callback signature', 'INVALID_SIGNATURE');
      }
    }
    if (!updates) {
      const secret = provider.webhookSecretId
        ? await getSecretById({ id: provider.webhookSecretId, purpose: 'communication.callback' })
        : null;
      if (!secret || !verifyGeneric(secret.reveal(), req)) {
        throw new UnauthenticatedError('Invalid callback signature', 'INVALID_SIGNATURE');
      }
      updates = parseGeneric(req.body);
    }
    const updated = await applyUpdates(provider.id, updates);
    return { received: updates.length, updated };
  });
}

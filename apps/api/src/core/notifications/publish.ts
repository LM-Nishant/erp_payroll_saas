import type { MessageChannel, NotificationChannel } from '@erp/shared';
import type { Prisma } from '@prisma/client';
import { findScopeHolders } from '../authz/holders';
import { sendMessages } from '../communication/messaging';
import { resolveTemplate, targetFor } from '../communication/templates';
import { env } from '../config/env';
import { FeatureDisabledError } from '../features/features';
import { LimitExceededError } from '../features/limits';
import { logger } from '../logger';
import { defineJob, enqueue } from '../queue';
import { currentOrganizationId } from '../tenancy/context';
import { tenantDb, withTenant } from '../tenancy/tenant-db';
import { pushProvider } from './push';
import { getNotificationEvent } from './registry';

export interface PublishInput {
  /** Users chosen by the publishing module (e.g. the approver, the document owner). */
  recipients?: string[];
  title: string;
  body?: string | null;
  /** App-relative link (e.g. `/approvals/123`) or absolute URL. */
  link?: string | null;
  data?: Record<string, unknown>;
  institutionId?: string | null;
  /** Override the event's default channels (organization rules still apply). */
  channels?: NotificationChannel[];
}

interface NotificationJobData {
  organizationId: string;
  notificationJobId: string;
}

/**
 * Publish a notification event. Persists a `notification_jobs` row and fans out asynchronously
 * (queue job `notifications.dispatch`): in-app rows, email/SMS/WhatsApp through the
 * communication engine, and push to registered devices — honouring organization rules and
 * user channel preferences. Must run inside a tenant context. Returns the notification job id.
 */
export async function publish(eventKey: string, input: PublishInput): Promise<string> {
  const job = await tenantDb().notificationJob.create({
    data: withTenant({
      eventKey,
      payload: input as unknown as Prisma.InputJsonValue,
      status: 'PENDING',
    }),
  });
  await enqueue<NotificationJobData>(
    'notifications.dispatch',
    { organizationId: currentOrganizationId(), notificationJobId: job.id },
    { jobId: `notification:${job.id}` },
  );
  return job.id;
}

interface RuleRecipients {
  includeDefault: boolean;
  userIds: string[];
  roleKeys: string[];
  permissions: string[];
}

async function activeMembers(userIds: Iterable<string>): Promise<Set<string>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Set();
  const rows = await tenantDb().organizationMembership.findMany({
    where: {
      userId: { in: ids },
      status: 'ACTIVE',
      deletedAt: null,
      user: { status: 'ACTIVE', deletedAt: null },
    },
    select: { userId: true },
  });
  return new Set(rows.map((r) => r.userId));
}

function absoluteLink(link: string | null | undefined): string | null {
  if (!link) return null;
  return link.startsWith('/') ? `${env.APP_PUBLIC_URL}${link}` : link;
}

/** Resolve (recipient → channels, channel → template key) for one published event. */
async function plan(eventKey: string, input: PublishInput) {
  const event = getNotificationEvent(eventKey);
  const base = input.channels ?? event?.defaultChannels ?? ['in_app'];
  const defaults = new Set(input.recipients ?? []);
  const rules = await tenantDb().notificationRule.findMany({
    where: {
      eventKey,
      isActive: true,
      OR: [
        { institutionId: null },
        ...(input.institutionId ? [{ institutionId: input.institutionId }] : []),
      ],
    },
    orderBy: { createdAt: 'asc' },
  });
  const channelsFor = new Map<string, Set<NotificationChannel>>();
  const add = (userId: string, channels: Iterable<NotificationChannel>) => {
    const set = channelsFor.get(userId) ?? new Set<NotificationChannel>();
    for (const c of channels) set.add(c);
    channelsFor.set(userId, set);
  };
  const templateFor = new Map<NotificationChannel, string>();
  const defaultRuleChannels = rules
    .filter((r) => (r.recipients as unknown as RuleRecipients).includeDefault !== false)
    .flatMap((r) => r.channels as NotificationChannel[]);
  // Rules that include the module's recipients replace the default channel set for them.
  const defaultChannels = defaultRuleChannels.length > 0 ? defaultRuleChannels : base;
  for (const u of defaults) add(u, defaultChannels);
  const resource = { institutionId: input.institutionId ?? null };
  for (const rule of rules) {
    const r = rule.recipients as unknown as RuleRecipients;
    const channels = rule.channels as NotificationChannel[];
    const extra = new Set<string>(r.userIds ?? []);
    if (r.roleKeys?.length) {
      (await findScopeHolders({ roleKeys: r.roleKeys, resource })).forEach((u) => extra.add(u));
    }
    for (const permission of r.permissions ?? []) {
      (await findScopeHolders({ permission, resource })).forEach((u) => extra.add(u));
    }
    for (const u of extra) add(u, channels);
    if (rule.templateKey) {
      for (const c of channels) if (!templateFor.has(c)) templateFor.set(c, rule.templateKey);
    }
  }
  const members = await activeMembers(channelsFor.keys());
  for (const u of [...channelsFor.keys()]) if (!members.has(u)) channelsFor.delete(u);

  // User preferences (event-specific beats `*`), unless the event is mandatory.
  if (!event?.mandatory && channelsFor.size > 0) {
    const prefs = await tenantDb().notificationPreference.findMany({
      where: { userId: { in: [...channelsFor.keys()] }, eventKey: { in: [eventKey, '*'] } },
    });
    for (const [userId, channels] of channelsFor) {
      for (const channel of [...channels]) {
        const specific = prefs.find(
          (p) => p.userId === userId && p.channel === channel && p.eventKey === eventKey,
        );
        const wildcard = prefs.find(
          (p) => p.userId === userId && p.channel === channel && p.eventKey === '*',
        );
        if ((specific ?? wildcard)?.enabled === false) channels.delete(channel);
      }
    }
  }
  return { channelsFor, templateFor };
}

async function dispatch(jobId: string) {
  const db = tenantDb();
  const job = await db.notificationJob.findFirst({ where: { id: jobId } });
  if (!job || job.status === 'DONE') return;
  const eventKey = job.eventKey;
  const input = job.payload as unknown as PublishInput;
  const { channelsFor, templateFor } = await plan(eventKey, input);

  const byChannel = new Map<NotificationChannel, string[]>();
  for (const [userId, channels] of channelsFor) {
    for (const c of channels) byChannel.set(c, [...(byChannel.get(c) ?? []), userId]);
  }

  const inApp = byChannel.get('in_app') ?? [];
  if (inApp.length > 0) {
    // Idempotent on retry: skip users who already got this job's in-app row.
    const existing = await db.notification.findMany({
      where: { userId: { in: inApp }, data: { path: '$.notificationJobId', equals: jobId } },
      select: { userId: true },
    });
    const done = new Set(existing.map((e) => e.userId));
    const rows = inApp
      .filter((u) => !done.has(u))
      .map((userId) =>
        withTenant({
          userId,
          eventKey,
          title: input.title.slice(0, 300),
          body: input.body ?? null,
          link: input.link?.slice(0, 500) ?? null,
          data: { ...(input.data ?? {}), notificationJobId: jobId } as Prisma.InputJsonValue,
        }),
      );
    if (rows.length > 0) await db.notification.createMany({ data: rows });
  }

  const variables = {
    title: input.title,
    body: input.body ?? '',
    link: absoluteLink(input.link),
    data: input.data ?? {},
    ...(input.data ?? {}),
  };
  const target = await targetFor(input.institutionId);
  for (const channel of ['email', 'sms', 'whatsapp'] as MessageChannel[]) {
    const users = byChannel.get(channel) ?? [];
    if (users.length === 0) continue;
    const ruleTemplate = templateFor.get(channel);
    const templateKey =
      ruleTemplate ??
      ((await resolveTemplate(eventKey, channel, target)) ? eventKey : 'notification.generic');
    try {
      await sendMessages({
        channel,
        recipients: users.map((userId) => ({ userId })),
        templateKey,
        variables,
        institutionId: input.institutionId ?? null,
        eventKey,
        metadata: { notificationJobId: jobId },
      });
    } catch (err) {
      if (err instanceof FeatureDisabledError || err instanceof LimitExceededError) {
        logger.info({ eventKey, channel, reason: err.code }, 'Notification channel skipped');
        continue;
      }
      throw err;
    }
  }

  const pushUsers = byChannel.get('push') ?? [];
  if (pushUsers.length > 0) {
    const devices = await db.pushDevice.findMany({ where: { userId: { in: pushUsers } } });
    for (const d of devices) {
      const provider = pushProvider(d.platform);
      if (!provider) continue;
      const result = await provider.send({
        token: d.token,
        title: input.title,
        body: input.body ?? null,
        data: { eventKey, ...(input.link ? { link: input.link } : {}) },
      });
      if (result.invalidToken) await db.pushDevice.delete({ where: { id: d.id } });
    }
  }

  await db.notificationJob.update({
    where: { id: jobId },
    data: {
      status: 'DONE',
      recipientCount: channelsFor.size,
      attempts: { increment: 1 },
      processedAt: new Date(),
      error: null,
    },
  });
}

defineJob<NotificationJobData>({
  name: 'notifications.dispatch',
  attempts: 5,
  backoffMs: 5000,
  handler: async ({ notificationJobId }, info) => {
    try {
      await dispatch(notificationJobId);
    } catch (err) {
      await tenantDb().notificationJob.updateMany({
        where: { id: notificationJobId },
        data: {
          status: info.attempt >= info.maxAttempts ? 'FAILED' : 'RETRYING',
          attempts: { increment: 1 },
          error: (err as Error).message.slice(0, 1000),
        },
      });
      throw err;
    }
  },
});

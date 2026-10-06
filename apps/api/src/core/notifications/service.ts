import { createHash } from 'node:crypto';
import type {
  CreateNotificationRuleInput,
  ListNotificationsQuery,
  NotificationChannel,
  NotificationDto,
  NotificationEventDto,
  NotificationPreferenceDto,
  NotificationRuleDto,
  RegisterPushDeviceInput,
  UpdateNotificationPreferencesInput,
  UpdateNotificationRuleInput,
} from '@erp/shared';
import type { Notification, NotificationRule, Prisma } from '@prisma/client';
import { audit } from '../audit';
import { authorize, currentPrincipal } from '../authz';
import { NotFoundError, UnauthenticatedError, ValidationError } from '../http/errors';
import { toListResponse, toPageWindow } from '../http/pagination';
import { resolveSettingTarget, targetResource } from '../settings/target';
import { tenantDb, withTenant } from '../tenancy/tenant-db';
import { getNotificationEvent, listNotificationEvents } from './registry';

function me(): string {
  const userId = currentPrincipal().userId;
  if (!userId) throw new UnauthenticatedError('A user session is required');
  return userId;
}

function dto(row: Notification): NotificationDto {
  const data = (row.data as Record<string, unknown> | null) ?? null;
  if (data) delete data.notificationJobId;
  return {
    id: row.id,
    eventKey: row.eventKey,
    title: row.title,
    body: row.body,
    link: row.link,
    data,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function ruleDto(row: NotificationRule): NotificationRuleDto {
  return {
    id: row.id,
    eventKey: row.eventKey,
    name: row.name,
    channels: row.channels as NotificationChannel[],
    recipients: row.recipients as NotificationRuleDto['recipients'],
    templateKey: row.templateKey,
    institutionId: row.institutionId,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function ruleResource(institutionId: string | null | undefined) {
  if (!institutionId) return {};
  return targetResource(await resolveSettingTarget('INSTITUTION', institutionId));
}

async function findRule(id: string) {
  const row = await tenantDb().notificationRule.findFirst({ where: { id } });
  if (!row) throw new NotFoundError('Notification rule');
  try {
    await authorize(
      currentPrincipal(),
      'notification.manage',
      await ruleResource(row.institutionId),
    );
  } catch {
    throw new NotFoundError('Notification rule');
  }
  return row;
}

/** The signed-in user's inbox (always own rows only). */
export const notificationsService = {
  async list(query: ListNotificationsQuery) {
    const where: Prisma.NotificationWhereInput = {
      userId: me(),
      ...(query.unread === true ? { readAt: null } : {}),
      ...(query.unread === false ? { readAt: { not: null } } : {}),
    };
    const db = tenantDb();
    const [rows, total] = await Promise.all([
      db.notification.findMany({ where, orderBy: { createdAt: 'desc' }, ...toPageWindow(query) }),
      db.notification.count({ where }),
    ]);
    return toListResponse(rows.map(dto), total, query);
  },

  async unreadCount(): Promise<number> {
    return tenantDb().notification.count({ where: { userId: me(), readAt: null } });
  },

  async markRead(id: string) {
    const db = tenantDb();
    const row = await db.notification.findFirst({ where: { id, userId: me() } });
    if (!row) throw new NotFoundError('Notification');
    if (row.readAt) return dto(row);
    return dto(await db.notification.update({ where: { id }, data: { readAt: new Date() } }));
  },

  async markAllRead(): Promise<number> {
    const result = await tenantDb().notification.updateMany({
      where: { userId: me(), readAt: null },
      data: { readAt: new Date() },
    });
    return result.count;
  },

  async preferences(): Promise<NotificationPreferenceDto[]> {
    const rows = await tenantDb().notificationPreference.findMany({
      where: { userId: me() },
      orderBy: [{ eventKey: 'asc' }, { channel: 'asc' }],
    });
    return rows.map((r) => ({
      eventKey: r.eventKey,
      channel: r.channel as NotificationChannel,
      enabled: r.enabled,
    }));
  },

  async updatePreferences(input: UpdateNotificationPreferencesInput) {
    const userId = me();
    const db = tenantDb();
    for (const p of input.preferences) {
      if (p.eventKey !== '*' && getNotificationEvent(p.eventKey)?.mandatory && !p.enabled) {
        throw new ValidationError(`"${p.eventKey}" notifications cannot be disabled`, {
          field: 'preferences',
        });
      }
    }
    for (const p of input.preferences) {
      const existing = await db.notificationPreference.findFirst({
        where: { userId, eventKey: p.eventKey, channel: p.channel },
      });
      if (existing) {
        await db.notificationPreference.update({
          where: { id: existing.id },
          data: { enabled: p.enabled },
        });
      } else {
        await db.notificationPreference.create({
          data: withTenant({
            userId,
            eventKey: p.eventKey,
            channel: p.channel,
            enabled: p.enabled,
          }),
        });
      }
    }
    await audit.record({
      action: 'notification_preferences.update',
      entityType: 'user',
      entityId: userId,
      after: { preferences: input.preferences },
    });
    return this.preferences();
  },

  events(): NotificationEventDto[] {
    return listNotificationEvents();
  },

  async registerDevice(input: RegisterPushDeviceInput) {
    const userId = me();
    const tokenHash = createHash('sha256').update(input.token).digest('hex');
    const db = tenantDb();
    const existing = await db.pushDevice.findFirst({ where: { tokenHash } });
    const row = existing
      ? await db.pushDevice.update({
          where: { id: existing.id },
          data: {
            userId,
            platform: input.platform,
            deviceName: input.deviceName ?? null,
            lastSeenAt: new Date(),
          },
        })
      : await db.pushDevice.create({
          data: withTenant({
            userId,
            platform: input.platform,
            token: input.token,
            tokenHash,
            deviceName: input.deviceName ?? null,
          }),
        });
    await audit.record({
      action: 'push_device.register',
      entityType: 'push_device',
      entityId: row.id,
      after: { platform: row.platform, deviceName: row.deviceName },
    });
    return { id: row.id, platform: row.platform, deviceName: row.deviceName };
  },

  async removeDevice(id: string) {
    const db = tenantDb();
    const row = await db.pushDevice.findFirst({ where: { id, userId: me() } });
    if (!row) throw new NotFoundError('Push device');
    await db.pushDevice.delete({ where: { id } });
    await audit.record({ action: 'push_device.remove', entityType: 'push_device', entityId: id });
  },
};

export const notificationRulesService = {
  async list(): Promise<NotificationRuleDto[]> {
    const principal = currentPrincipal();
    const rows = await tenantDb().notificationRule.findMany({
      orderBy: [{ eventKey: 'asc' }, { createdAt: 'asc' }],
    });
    const out: NotificationRuleDto[] = [];
    for (const row of rows) {
      try {
        await authorize(principal, 'notification.manage', await ruleResource(row.institutionId));
        out.push(ruleDto(row));
      } catch {
        /* outside scope */
      }
    }
    return out;
  },

  async create(input: CreateNotificationRuleInput) {
    await authorize(
      currentPrincipal(),
      'notification.manage',
      await ruleResource(input.institutionId),
    );
    const row = await tenantDb().notificationRule.create({
      data: withTenant({
        eventKey: input.eventKey,
        name: input.name,
        channels: [...new Set(input.channels)],
        recipients: input.recipients as Prisma.InputJsonValue,
        templateKey: input.templateKey ?? null,
        institutionId: input.institutionId ?? null,
        isActive: input.isActive,
        createdById: currentPrincipal().userId,
      }),
    });
    await audit.record({
      action: 'notification_rule.create',
      entityType: 'notification_rule',
      entityId: row.id,
      after: ruleDto(row),
    });
    return ruleDto(row);
  },

  async update(id: string, input: UpdateNotificationRuleInput) {
    const before = await findRule(id);
    const row = await tenantDb().notificationRule.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.channels !== undefined ? { channels: [...new Set(input.channels)] } : {}),
        ...(input.recipients !== undefined
          ? { recipients: input.recipients as Prisma.InputJsonValue }
          : {}),
        ...(input.templateKey !== undefined ? { templateKey: input.templateKey } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
    await audit.record({
      action: 'notification_rule.update',
      entityType: 'notification_rule',
      entityId: id,
      before: ruleDto(before),
      after: ruleDto(row),
    });
    return ruleDto(row);
  },

  async remove(id: string) {
    const row = await findRule(id);
    await tenantDb().notificationRule.delete({ where: { id } });
    await audit.record({
      action: 'notification_rule.delete',
      entityType: 'notification_rule',
      entityId: id,
      before: ruleDto(row),
    });
  },
};

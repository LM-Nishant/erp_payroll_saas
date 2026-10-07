import { z } from 'zod';
import { idSchema, paginationQuerySchema } from './common';

/*
 * Notification engine (core/notifications): in-app notifications, user channel preferences,
 * per-organization rules (event → channels / recipients / template) and push devices.
 */

export const NOTIFICATION_CHANNELS = ['in_app', 'email', 'sms', 'whatsapp', 'push'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
export const notificationChannelSchema = z.enum(NOTIFICATION_CHANNELS);

export const eventKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/, 'Dotted event key, e.g. employee.created');

/** Event key or `*` (all events) for preferences. */
export const eventKeyOrWildcardSchema = z.union([z.literal('*'), eventKeySchema]);

export const listNotificationsQuerySchema = paginationQuerySchema
  .omit({ search: true })
  .extend({
    unread: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
  })
  .strict();
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

export const notificationPreferenceSchema = z
  .object({
    eventKey: eventKeyOrWildcardSchema,
    channel: notificationChannelSchema,
    enabled: z.boolean(),
  })
  .strict();
export const updateNotificationPreferencesSchema = z
  .object({ preferences: z.array(notificationPreferenceSchema).max(200) })
  .strict();
export type UpdateNotificationPreferencesInput = z.infer<
  typeof updateNotificationPreferencesSchema
>;

/** Recipients of a rule, merged with the recipients supplied by the publishing module. */
export const notificationRuleRecipientsSchema = z
  .object({
    /** Include the recipients chosen by the publishing module (default true). */
    includeDefault: z.boolean().default(true),
    userIds: z.array(idSchema).max(100).default([]),
    roleKeys: z.array(z.string().trim().min(1).max(64)).max(20).default([]),
    /** Users holding this permission in a scope covering the event's institution. */
    permissions: z
      .array(
        z
          .string()
          .max(100)
          .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/),
      )
      .max(10)
      .default([]),
  })
  .strict();

export const createNotificationRuleSchema = z
  .object({
    eventKey: eventKeySchema,
    name: z.string().trim().min(1).max(200),
    channels: z.array(notificationChannelSchema).min(1).max(5),
    recipients: notificationRuleRecipientsSchema.default({}),
    /** Message template key used for email/sms/whatsapp (defaults to the event key). */
    templateKey: z.string().trim().max(100).nullish(),
    institutionId: idSchema.optional(),
    isActive: z.boolean().default(true),
  })
  .strict();
export type CreateNotificationRuleInput = z.infer<typeof createNotificationRuleSchema>;

export const updateNotificationRuleSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    channels: z.array(notificationChannelSchema).min(1).max(5).optional(),
    recipients: notificationRuleRecipientsSchema.optional(),
    templateKey: z.string().trim().max(100).nullish(),
    isActive: z.boolean().optional(),
  })
  .strict();
export type UpdateNotificationRuleInput = z.infer<typeof updateNotificationRuleSchema>;

export const registerPushDeviceSchema = z
  .object({
    platform: z.enum(['fcm', 'apns']),
    token: z.string().trim().min(10).max(4096),
    deviceName: z.string().trim().max(100).optional(),
  })
  .strict();
export type RegisterPushDeviceInput = z.infer<typeof registerPushDeviceSchema>;

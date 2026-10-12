import { z } from 'zod';
import { idSchema, nameSchema, paginationQuerySchema } from './common';
import { refineSettingTarget, settingScopeTypeSchema } from './licensing';

/*
 * Communication engine (spec §38-§39): providers, templates, messages, campaigns, logs.
 * Provider credentials are write-only and stored through core/secrets (never returned).
 */

export const MESSAGE_CHANNELS = ['email', 'sms', 'whatsapp'] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];
export const messageChannelSchema = z.enum(MESSAGE_CHANNELS);

/** Provider adapters per channel (`log` = development/test outbox, never sends). */
export const PROVIDER_TYPES = {
  email: ['smtp', 'ses', 'sendgrid', 'log'],
  sms: ['twilio', 'msg91', 'http', 'log'],
  whatsapp: ['whatsapp_cloud', 'log'],
} as const satisfies Record<MessageChannel, readonly string[]>;
export type ProviderType = (typeof PROVIDER_TYPES)[MessageChannel][number];
const ALL_PROVIDER_TYPES = [...new Set(Object.values(PROVIDER_TYPES).flat())] as [
  ProviderType,
  ...ProviderType[],
];
export const providerTypeSchema = z.enum(ALL_PROVIDER_TYPES);

export const MESSAGE_STATUSES = [
  'QUEUED',
  'SENT',
  'DELIVERED',
  'FAILED',
  'BOUNCED',
  'SKIPPED',
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

/** Non-secret provider configuration (host, port, from address, sender id, base URL…). */
export const providerConfigSchema = z
  .record(
    z
      .string()
      .max(64)
      .regex(/^[A-Za-z][A-Za-z0-9_]*$/),
    z.union([z.string().max(500), z.number(), z.boolean()]),
  )
  .refine((v) => Object.keys(v).length <= 30, 'At most 30 config entries');

/** One non-secret configuration field of a provider type (drives the settings form). */
export interface ProviderConfigField {
  key: string;
  label: string;
  type: 'text' | 'email' | 'number' | 'boolean' | 'url' | 'phone';
  required?: boolean;
  hint?: string;
  placeholder?: string;
}

export interface ProviderTypeForm {
  label: string;
  fields: readonly ProviderConfigField[];
  /** Label of the write-only secret (password / API key / token); absent = no secret. */
  credentialsLabel?: string;
  credentialsRequired?: boolean;
}

const FROM_EMAIL: ProviderConfigField = {
  key: 'from',
  label: 'From address',
  type: 'email',
  required: true,
  placeholder: 'office@school.edu',
};
const FROM_NAME: ProviderConfigField = {
  key: 'fromName',
  label: 'From name',
  type: 'text',
  placeholder: 'Greenwood High School',
};

/** Per-provider-type configuration form (keys match the API adapters). */
export const PROVIDER_FORMS: Record<ProviderType, ProviderTypeForm> = {
  smtp: {
    label: 'SMTP server (own mailbox: Google Workspace, Microsoft 365, cPanel…)',
    fields: [
      {
        key: 'host',
        label: 'SMTP host',
        type: 'text',
        required: true,
        placeholder: 'smtp.gmail.com',
      },
      { key: 'port', label: 'Port', type: 'number', placeholder: '587' },
      { key: 'secure', label: 'Use TLS from the start (port 465)', type: 'boolean' },
      { key: 'user', label: 'Username', type: 'text', placeholder: 'office@school.edu' },
      FROM_EMAIL,
      FROM_NAME,
    ],
    credentialsLabel: 'SMTP password / app password',
  },
  ses: {
    label: 'Amazon SES (SMTP interface)',
    fields: [
      { key: 'region', label: 'AWS region', type: 'text', placeholder: 'ap-south-1' },
      { key: 'user', label: 'SES SMTP username', type: 'text', required: true },
      FROM_EMAIL,
      FROM_NAME,
    ],
    credentialsLabel: 'SES SMTP password',
    credentialsRequired: true,
  },
  sendgrid: {
    label: 'SendGrid',
    fields: [FROM_EMAIL, FROM_NAME],
    credentialsLabel: 'SendGrid API key',
    credentialsRequired: true,
  },
  twilio: {
    label: 'Twilio SMS',
    fields: [
      { key: 'accountSid', label: 'Account SID', type: 'text', required: true },
      {
        key: 'from',
        label: 'Sender number (E.164)',
        type: 'phone',
        placeholder: '+14155550100',
        hint: 'Or use a messaging service SID below',
      },
      { key: 'messagingServiceSid', label: 'Messaging service SID', type: 'text' },
    ],
    credentialsLabel: 'Auth token',
    credentialsRequired: true,
  },
  msg91: {
    label: 'MSG91 (India, DLT)',
    fields: [
      {
        key: 'senderId',
        label: 'Sender ID (6 letters)',
        type: 'text',
        required: true,
        placeholder: 'GRNWD',
      },
      { key: 'dltTemplateId', label: 'DLT template ID', type: 'text' },
      { key: 'route', label: 'Route', type: 'text', placeholder: '4' },
      { key: 'country', label: 'Country code', type: 'text', placeholder: '91' },
    ],
    credentialsLabel: 'Auth key',
    credentialsRequired: true,
  },
  http: {
    label: 'Generic HTTP SMS gateway',
    fields: [
      { key: 'url', label: 'Gateway URL (POST)', type: 'url', required: true },
      { key: 'from', label: 'Sender ID / number', type: 'text' },
      {
        key: 'messageIdField',
        label: 'Message id field in the response',
        type: 'text',
        placeholder: 'id',
      },
    ],
    credentialsLabel: 'Bearer token',
  },
  whatsapp_cloud: {
    label: 'WhatsApp Cloud API (Meta)',
    fields: [
      { key: 'phoneNumberId', label: 'Phone number ID', type: 'text', required: true },
      {
        key: 'businessNumber',
        label: 'WhatsApp business number (E.164)',
        type: 'phone',
        placeholder: '+919800000000',
        hint: 'Shown to staff; messages go out from this number',
      },
      { key: 'templateName', label: 'Approved template name', type: 'text' },
      { key: 'templateLanguage', label: 'Template language', type: 'text', placeholder: 'en' },
      { key: 'apiVersion', label: 'Graph API version', type: 'text', placeholder: 'v20.0' },
    ],
    credentialsLabel: 'Permanent access token',
    credentialsRequired: true,
  },
  log: {
    label: 'Log only (development / demo — never sends)',
    fields: [
      { key: 'from', label: 'Sender shown in the log (email / number / sender ID)', type: 'text' },
      FROM_NAME,
    ],
  },
};

const refineProviderType = (
  v: { channel?: MessageChannel | undefined; providerType?: ProviderType | undefined },
  ctx: z.RefinementCtx,
) => {
  if (
    v.channel &&
    v.providerType &&
    !(PROVIDER_TYPES[v.channel] as readonly string[]).includes(v.providerType)
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['providerType'],
      message: `Not a ${v.channel} provider`,
    });
  }
};

export const createCommunicationProviderSchema = z
  .object({
    scopeType: settingScopeTypeSchema.default('ORGANIZATION'),
    targetId: idSchema.optional(),
    channel: messageChannelSchema,
    providerType: providerTypeSchema,
    name: nameSchema,
    /** Lower runs first; the next provider of the channel is the fallback. */
    priority: z.number().int().min(0).max(1000).default(100),
    config: providerConfigSchema.default({}),
    /** Write-only credentials (password / API key / auth token), stored as a tenant secret. */
    credentials: z.string().min(1).max(8192).optional(),
    rateLimitPerMinute: z.number().int().min(1).max(100_000).nullish(),
    costPerMessage: z.number().min(0).max(1000).nullish(),
    isActive: z.boolean().default(true),
  })
  .strict()
  .superRefine(refineSettingTarget)
  .superRefine(refineProviderType);
export type CreateCommunicationProviderInput = z.infer<typeof createCommunicationProviderSchema>;

export const updateCommunicationProviderSchema = z
  .object({
    name: nameSchema.optional(),
    priority: z.number().int().min(0).max(1000).optional(),
    config: providerConfigSchema.optional(),
    credentials: z.string().min(1).max(8192).optional(),
    rateLimitPerMinute: z.number().int().min(1).max(100_000).nullish(),
    costPerMessage: z.number().min(0).max(1000).nullish(),
    isActive: z.boolean().optional(),
  })
  .strict();
export type UpdateCommunicationProviderInput = z.infer<typeof updateCommunicationProviderSchema>;

export const listProvidersQuerySchema = paginationQuerySchema
  .omit({ search: true })
  .extend({ channel: messageChannelSchema.optional() })
  .strict();
export type ListProvidersQuery = z.infer<typeof listProvidersQuerySchema>;

export const templateKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/, 'Lower-case dotted key, e.g. auth.invite');

const templateContent = {
  subject: z.string().trim().max(500).nullish(),
  /** Text body (handlebars-style `{{variable}}`; `{{{raw}}}` is not escaped). */
  body: z.string().min(1).max(20_000),
  /** Optional HTML body for email (inner content; wrapped in the branded layout). */
  htmlBody: z.string().max(100_000).nullish(),
};

export const createMessageTemplateSchema = z
  .object({
    scopeType: settingScopeTypeSchema.default('ORGANIZATION'),
    targetId: idSchema.optional(),
    key: templateKeySchema,
    channel: messageChannelSchema,
    name: nameSchema,
    description: z.string().trim().max(1000).nullish(),
    useBrandedLayout: z.boolean().default(true),
    ...templateContent,
  })
  .strict()
  .superRefine(refineSettingTarget);
export type CreateMessageTemplateInput = z.infer<typeof createMessageTemplateSchema>;

/** Publishes a NEW immutable version (older versions stay readable for message logs). */
export const reviseMessageTemplateSchema = z
  .object({
    name: nameSchema.optional(),
    description: z.string().trim().max(1000).nullish(),
    useBrandedLayout: z.boolean().optional(),
    ...templateContent,
  })
  .strict();
export type ReviseMessageTemplateInput = z.infer<typeof reviseMessageTemplateSchema>;

export const templateVariablesSchema = z
  .record(z.string().max(64), z.unknown())
  .refine((v) => JSON.stringify(v).length <= 20_000, 'Variables too large');

export const previewMessageTemplateSchema = z
  .object({ variables: templateVariablesSchema.default({}) })
  .strict();

export const listTemplatesQuerySchema = paginationQuerySchema
  .extend({ channel: messageChannelSchema.optional() })
  .strict();
export type ListTemplatesQuery = z.infer<typeof listTemplatesQuerySchema>;

export const messageRecipientSchema = z
  .object({
    userId: idSchema.optional(),
    /** Email address or E.164 phone number (when not addressing a user). */
    address: z.string().trim().min(3).max(254).optional(),
    name: z.string().trim().max(200).optional(),
    variables: templateVariablesSchema.optional(),
  })
  .strict()
  .refine((v) => !!v.userId !== !!v.address, 'Exactly one of userId / address');
export type MessageRecipientInput = z.infer<typeof messageRecipientSchema>;

const messageContent = {
  channel: messageChannelSchema,
  institutionId: idSchema.optional(),
  templateKey: templateKeySchema.optional(),
  subject: z.string().trim().max(500).optional(),
  body: z.string().min(1).max(20_000).optional(),
  variables: templateVariablesSchema.default({}),
};

const refineContent = (
  v: { templateKey?: string | undefined; body?: string | undefined },
  ctx: z.RefinementCtx,
) => {
  if (!!v.templateKey === !!v.body) {
    ctx.addIssue({ code: 'custom', path: ['body'], message: 'Give either templateKey or body' });
  }
};

export const sendMessageSchema = z
  .object({ ...messageContent, recipients: z.array(messageRecipientSchema).min(1).max(100) })
  .strict()
  .superRefine(refineContent);
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const createCampaignSchema = z
  .object({
    name: nameSchema,
    ...messageContent,
    recipients: z.array(messageRecipientSchema).min(1).max(5000),
    scheduledAt: z.coerce.date().optional(),
  })
  .strict()
  .superRefine(refineContent);
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

export const listCampaignsQuerySchema = paginationQuerySchema.strict();

/** Send a test message through ONE provider (bypasses the fallback chain). */
export const testCommunicationProviderSchema = z
  .object({
    /** Email address or phone number (E.164) to send the test to. */
    to: z.string().trim().min(3).max(254),
  })
  .strict();
export type TestCommunicationProviderInput = z.infer<typeof testCommunicationProviderSchema>;

/* ------------------------------------------------------------ audiences ---- */

/**
 * Who an announcement goes to. `institution` = everyone in the institution; `department` /
 * `program` / `class_section` = the listed units; `students` = listed students; `staff` = listed
 * employees (or every active employee of the institution when `ids` is empty).
 */
export const AUDIENCE_TYPES = [
  'institution',
  'department',
  'program',
  'class_section',
  'students',
  'staff',
] as const;
export type AudienceType = (typeof AUDIENCE_TYPES)[number];

/** Which people of the audience receive it. `staff` = employees of the institution / department. */
export const AUDIENCE_RECIPIENTS = ['students', 'guardians', 'both', 'staff'] as const;
export type AudienceRecipients = (typeof AUDIENCE_RECIPIENTS)[number];

export const audienceSchema = z
  .object({
    institutionId: idSchema,
    type: z.enum(AUDIENCE_TYPES),
    ids: z.array(idSchema).max(500).default([]),
    recipients: z.enum(AUDIENCE_RECIPIENTS).default('guardians'),
  })
  .strict()
  .superRefine((v, ctx) => {
    const needsIds = ['department', 'program', 'class_section', 'students', 'staff'].includes(
      v.type,
    );
    if (needsIds && v.ids.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['ids'], message: `Pick at least one ${v.type}` });
    }
    if (v.type === 'institution' && v.ids.length > 0) {
      ctx.addIssue({ code: 'custom', path: ['ids'], message: 'Not used for the institution' });
    }
    if (v.type === 'staff' && v.recipients !== 'staff') {
      ctx.addIssue({
        code: 'custom',
        path: ['recipients'],
        message: 'Staff audiences go to staff',
      });
    }
    if (['program', 'class_section', 'students'].includes(v.type) && v.recipients === 'staff') {
      ctx.addIssue({
        code: 'custom',
        path: ['recipients'],
        message: 'Pick students, guardians or both',
      });
    }
  });
export type AudienceInput = z.infer<typeof audienceSchema>;

const broadcastContent = {
  channel: messageChannelSchema,
  audience: audienceSchema,
  templateKey: templateKeySchema.optional(),
  subject: z.string().trim().max(500).optional(),
  body: z.string().min(1).max(20_000).optional(),
  variables: templateVariablesSchema.default({}),
};

/** Count / list the recipients of an audience (and optionally render the first message). */
export const previewAudienceSchema = z
  .object({
    channel: messageChannelSchema,
    audience: audienceSchema,
    templateKey: templateKeySchema.optional(),
    subject: z.string().trim().max(500).optional(),
    body: z.string().max(20_000).optional(),
    variables: templateVariablesSchema.default({}),
  })
  .strict();
export type PreviewAudienceInput = z.infer<typeof previewAudienceSchema>;

/** Announcement to an audience: resolved server-side and sent as a campaign. */
export const createBroadcastSchema = z
  .object({
    name: nameSchema,
    ...broadcastContent,
    scheduledAt: z.coerce.date().optional(),
  })
  .strict()
  .superRefine(refineContent);
export type CreateBroadcastInput = z.infer<typeof createBroadcastSchema>;

export const listMessageLogsQuerySchema = paginationQuerySchema
  .extend({
    channel: messageChannelSchema.optional(),
    status: z.enum(MESSAGE_STATUSES).optional(),
    campaignId: idSchema.optional(),
    institutionId: idSchema.optional(),
  })
  .strict();
export type ListMessageLogsQuery = z.infer<typeof listMessageLogsQuerySchema>;

/** Generic signed delivery callback (`log`/`http`/`msg91`… adapters). */
export const deliveryCallbackSchema = z
  .object({
    providerMessageId: z.string().min(1).max(255),
    status: z.enum(['sent', 'delivered', 'failed', 'bounced']),
    cost: z.number().min(0).max(1000).optional(),
    error: z.string().max(1000).optional(),
    occurredAt: z.coerce.date().optional(),
  })
  .passthrough();
export type DeliveryCallback = z.infer<typeof deliveryCallbackSchema>;

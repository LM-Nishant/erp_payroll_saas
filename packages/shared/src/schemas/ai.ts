import { z } from 'zod';
import { idSchema, paginationQuerySchema } from './common';
import { isoDateSchema } from './hr';

/** AI features an organization can enable individually (spec §43–§50). */
export const AI_FEATURES = [
  'assistant',
  'drafting',
  'payroll_anomaly',
  'student_insight',
  'summarizer',
] as const;
export const aiFeatureSchema = z.enum(AI_FEATURES);
export type AiFeature = z.infer<typeof aiFeatureSchema>;

/**
 * `mock` is deterministic and needs no credentials (demo + tests); `openai` covers OpenAI, Azure
 * OpenAI and any OpenAI-compatible endpoint (base URL from the `ai.openai` secret metadata).
 */
export const AI_PROVIDERS = ['mock', 'openai'] as const;
export const aiProviderSchema = z.enum(AI_PROVIDERS);
export type AiProviderKey = z.infer<typeof aiProviderSchema>;

export const AI_DRAFT_KINDS = [
  'offer_letter',
  'experience_letter',
  'relieving_letter',
  'circular',
  'notice',
  'parent_email',
  'generic',
] as const;
export const aiDraftKindSchema = z.enum(AI_DRAFT_KINDS);
export type AiDraftKind = z.infer<typeof aiDraftKindSchema>;

export const AI_TONES = ['formal', 'friendly', 'neutral'] as const;
export const aiToneSchema = z.enum(AI_TONES);

export const AI_SUMMARY_KINDS = ['resume', 'jd', 'generic'] as const;
export const aiSummaryKindSchema = z.enum(AI_SUMMARY_KINDS);
export type AiSummaryKind = z.infer<typeof aiSummaryKindSchema>;

const modelSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9._:/-]+$/, 'Invalid model name');

export const aiChatSchema = z
  .object({
    conversationId: idSchema.optional(),
    message: z.string().trim().min(1).max(4000),
  })
  .strict();
export type AiChatInput = z.infer<typeof aiChatSchema>;

export const aiDraftSchema = z
  .object({
    kind: aiDraftKindSchema,
    instructions: z.string().trim().min(1).max(2000),
    tone: aiToneSchema.default('formal'),
    /** Optional facts to weave into the draft (names, dates, amounts). */
    variables: z
      .record(z.string().trim().min(1).max(64), z.union([z.string().max(500), z.number()]))
      .refine((v) => Object.keys(v).length <= 30, 'Too many variables')
      .optional(),
  })
  .strict();
export type AiDraftInput = z.infer<typeof aiDraftSchema>;

export const aiPayrollExplainSchema = z.object({ runId: idSchema }).strict();
export type AiPayrollExplainInput = z.infer<typeof aiPayrollExplainSchema>;

export const aiStudentInsightSchema = z
  .object({
    institutionId: idSchema.optional(),
    classSectionId: idSchema.optional(),
  })
  .strict();
export type AiStudentInsightInput = z.infer<typeof aiStudentInsightSchema>;

export const aiSummarizeSchema = z
  .object({
    kind: aiSummaryKindSchema.default('generic'),
    text: z.string().trim().min(20).max(20_000),
  })
  .strict();
export type AiSummarizeInput = z.infer<typeof aiSummarizeSchema>;

export const updateAiSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    provider: aiProviderSchema.optional(),
    defaultModel: modelSchema.optional(),
    maxTokensPerRequest: z.number().int().min(64).max(32_000).optional(),
    temperature: z.number().min(0).max(2).optional(),
    enabledFeatures: z.array(aiFeatureSchema).max(AI_FEATURES.length).optional(),
    /** Whether tenant data may be sent to an EXTERNAL provider (off → mock only). */
    dataSharing: z.boolean().optional(),
  })
  .strict();
export type UpdateAiSettingsInput = z.infer<typeof updateAiSettingsSchema>;

export const listAiConversationsQuerySchema = paginationQuerySchema
  .extend({ feature: aiFeatureSchema.optional() })
  .strict();
export type ListAiConversationsQuery = z.infer<typeof listAiConversationsQuerySchema>;

export const aiUsageQuerySchema = z
  .object({
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    feature: aiFeatureSchema.optional(),
  })
  .strict();
export type AiUsageQuery = z.infer<typeof aiUsageQuerySchema>;

export const listAiUsageLogsQuerySchema = paginationQuerySchema
  .extend({
    feature: aiFeatureSchema.optional(),
    status: z.enum(['OK', 'ERROR', 'LIMITED']).optional(),
  })
  .strict();
export type ListAiUsageLogsQuery = z.infer<typeof listAiUsageLogsQuerySchema>;

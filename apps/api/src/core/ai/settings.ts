import {
  AI_FEATURES,
  aiFeatureSchema,
  aiProviderSchema,
  type AiFeature,
  type AiSettingsDto,
  type UpdateAiSettingsInput,
} from '@erp/shared';
import type { AiSetting } from '@prisma/client';
import { audit } from '../audit';
import { assertPermission, currentPrincipal } from '../authz';
import { tenantDb, withTenant } from '../tenancy';

export const DEFAULT_AI_MODEL = 'gpt-4o-mini';

export const DEFAULT_AI_SETTINGS: Omit<AiSettingsDto, 'updatedAt'> = {
  enabled: true,
  provider: 'mock',
  defaultModel: DEFAULT_AI_MODEL,
  maxTokensPerRequest: 1024,
  temperature: 0.2,
  enabledFeatures: [...AI_FEATURES],
  dataSharing: false,
};

function featuresOf(value: unknown): AiFeature[] {
  if (!Array.isArray(value)) return [...AI_FEATURES];
  return value.filter((v): v is AiFeature => aiFeatureSchema.safeParse(v).success);
}

export function toAiSettingsDto(row: AiSetting | null): AiSettingsDto {
  if (!row) return { ...DEFAULT_AI_SETTINGS, updatedAt: null };
  const provider = aiProviderSchema.safeParse(row.provider);
  return {
    enabled: row.enabled,
    provider: provider.success ? provider.data : 'mock',
    defaultModel: row.defaultModel,
    maxTokensPerRequest: row.maxTokensPerRequest,
    temperature: Number(row.temperature),
    enabledFeatures: featuresOf(row.enabledFeatures),
    dataSharing: row.dataSharing,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Effective AI settings of the current tenant (defaults when never configured). */
export async function loadAiSettings(): Promise<AiSettingsDto> {
  return toAiSettingsDto(await tenantDb().aiSetting.findFirst({}));
}

/**
 * Org-wide settings change: needs `ai.manage` (any scope, like feature overrides / secrets — the
 * settings are not hierarchy-scoped). Audited.
 */
export async function updateAiSettings(input: UpdateAiSettingsInput): Promise<AiSettingsDto> {
  const principal = currentPrincipal();
  assertPermission(principal, 'ai.manage');
  const db = tenantDb();
  const existing = await db.aiSetting.findFirst({});
  const before = toAiSettingsDto(existing);
  const next = {
    enabled: input.enabled ?? before.enabled,
    provider: input.provider ?? before.provider,
    defaultModel: input.defaultModel ?? before.defaultModel,
    maxTokensPerRequest: input.maxTokensPerRequest ?? before.maxTokensPerRequest,
    temperature: input.temperature ?? before.temperature,
    enabledFeatures: [...new Set(input.enabledFeatures ?? before.enabledFeatures)],
    dataSharing: input.dataSharing ?? before.dataSharing,
    updatedByUserId: principal.userId,
  };
  const row = existing
    ? await db.aiSetting.update({ where: { id: existing.id }, data: next })
    : await db.aiSetting.create({ data: withTenant(next) });
  const after = toAiSettingsDto(row);
  await audit.record({
    action: 'ai.settings.update',
    entityType: 'ai_setting',
    entityId: row.id,
    before: existing ? { ...before, updatedAt: undefined } : null,
    after: { ...after, updatedAt: undefined },
  });
  return after;
}

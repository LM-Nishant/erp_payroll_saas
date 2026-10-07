import {
  FEATURE_KEYS,
  type EffectiveFeaturesDto,
  type FeatureKey,
  type FeatureOverrideDto,
  type FeaturesOverviewDto,
  type EffectiveFeaturesQuery,
  type SetFeatureOverrideInput,
} from '@erp/shared';
import type { FeatureOverride } from '@prisma/client';
import { audit } from '../../core/audit';
import { authorize, currentPrincipal } from '../../core/authz';
import {
  currentFeatureContext,
  featureStatesFor,
  invalidateLicenseCache,
  loadLicense,
} from '../../core/features';
import { AppError, NotFoundError } from '../../core/http/errors';
import {
  resolveSettingTarget,
  resolveTargetFromQuery,
  targetResource,
} from '../../core/settings/target';
import { tenantDb, withTenant } from '../../core/tenancy/tenant-db';

/** 422: an override tried to enable a module the subscription does not license. */
export class FeatureNotLicensedError extends AppError {
  constructor(feature: FeatureKey) {
    super(422, 'FEATURE_NOT_LICENSED', `The "${feature}" module is not included in the plan`, {
      feature,
    });
  }
}

const toDto = (row: FeatureOverride): FeatureOverrideDto => ({
  id: row.id,
  scopeType: row.scopeType,
  targetId: row.targetId,
  featureKey: row.featureKey as FeatureKey,
  enabled: row.enabled,
  updatedAt: row.updatedAt.toISOString(),
});

export const featuresService = {
  /** License + organization-level states + every override (feature.view, any scope). */
  async overview(): Promise<FeaturesOverviewDto> {
    const ctx = currentFeatureContext();
    const license = await loadLicense(ctx.organizationId);
    const overrides = await tenantDb().featureOverride.findMany({
      orderBy: [{ scopeType: 'asc' }, { featureKey: 'asc' }],
    });
    return {
      licensedFeatures: FEATURE_KEYS.filter((k) => license.features.has(k)),
      features: await featureStatesFor(ctx),
      overrides: overrides.map(toDto),
    };
  },

  async effective(query: EffectiveFeaturesQuery): Promise<EffectiveFeaturesDto> {
    const target = await resolveTargetFromQuery(query);
    if (target.scopeType !== 'ORGANIZATION') {
      await authorize(currentPrincipal(), 'feature.view', targetResource(target));
    }
    return {
      target: { scopeType: target.scopeType, id: target.targetId },
      features: await featureStatesFor(currentFeatureContext(), {
        groupId: target.groupId,
        institutionId: target.institutionId,
      }),
    };
  },

  /** Upsert an override. Enabling requires the module to be licensed. */
  async setOverride(input: SetFeatureOverrideInput): Promise<FeatureOverrideDto> {
    const target = await resolveSettingTarget(input.scopeType, input.targetId);
    await authorize(currentPrincipal(), 'feature.manage', targetResource(target));
    const license = await loadLicense(currentFeatureContext().organizationId);
    if (input.enabled && !license.features.has(input.featureKey)) {
      throw new FeatureNotLicensedError(input.featureKey);
    }
    const db = tenantDb();
    const before = await db.featureOverride.findFirst({
      where: {
        scopeType: target.scopeType,
        targetId: target.targetId,
        featureKey: input.featureKey,
      },
    });
    const after = before
      ? await db.featureOverride.update({
          where: { id: before.id },
          data: { enabled: input.enabled },
        })
      : await db.featureOverride.create({
          data: withTenant({
            scopeType: target.scopeType,
            targetId: target.targetId,
            groupId: target.groupId,
            institutionId: target.institutionId,
            featureKey: input.featureKey,
            enabled: input.enabled,
          }),
        });
    invalidateLicenseCache();
    await audit.record({
      action: before ? 'feature_override.update' : 'feature_override.create',
      entityType: 'feature_override',
      entityId: after.id,
      before: before ? toDto(before) : undefined,
      after: toDto(after),
    });
    return toDto(after);
  },

  async removeOverride(id: string): Promise<void> {
    const db = tenantDb();
    const row = await db.featureOverride.findFirst({ where: { id } });
    if (!row) throw new NotFoundError('Feature override');
    await authorize(
      currentPrincipal(),
      'feature.manage',
      row.scopeType === 'ORGANIZATION'
        ? {}
        : { groupId: row.groupId, institutionId: row.institutionId },
    );
    await db.featureOverride.delete({ where: { id } });
    invalidateLicenseCache();
    await audit.record({
      action: 'feature_override.delete',
      entityType: 'feature_override',
      entityId: id,
      before: toDto(row),
    });
  },
};

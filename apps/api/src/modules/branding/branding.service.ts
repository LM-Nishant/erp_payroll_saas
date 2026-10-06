import {
  BRANDING_FIELDS,
  type BrandingInput,
  type BrandingProfileDto,
  type ResolvedBrandingDto,
  type ResolvedBrandingQuery,
  type SettingScopeType,
} from '@erp/shared';
import type { BrandingProfile } from '@prisma/client';
import { audit } from '../../core/audit';
import { assertPermission, authorize, currentPrincipal } from '../../core/authz';
import { invalidateBrandingCache, resolveBranding } from '../../core/branding';
import {
  resolveSettingTarget,
  resolveTargetFromQuery,
  targetResource,
  type SettingTarget,
} from '../../core/settings/target';
import { currentOrganizationId } from '../../core/tenancy/context';
import { tenantDb, withTenant } from '../../core/tenancy/tenant-db';

function toDto(target: SettingTarget, row: BrandingProfile | null): BrandingProfileDto {
  const values = Object.fromEntries(BRANDING_FIELDS.map((f) => [f, row?.[f] ?? null])) as Omit<
    BrandingProfileDto,
    'id' | 'scopeType' | 'targetId' | 'updatedAt'
  >;
  return {
    id: row?.id ?? null,
    scopeType: target.scopeType,
    targetId: target.targetId,
    updatedAt: row?.updatedAt.toISOString() ?? null,
    ...values,
  };
}

async function authorizedTarget(
  scopeType: SettingScopeType,
  targetId: string | undefined,
  permission: 'branding.view' | 'branding.manage',
) {
  const target = await resolveSettingTarget(scopeType, targetId);
  const principal = currentPrincipal();
  if (permission === 'branding.view' && target.scopeType === 'ORGANIZATION') {
    // Organization branding is inherited by every level: any branding.view grant may read it.
    assertPermission(principal, permission);
  } else {
    await authorize(principal, permission, targetResource(target));
  }
  return target;
}

const findProfile = (target: SettingTarget) =>
  tenantDb().brandingProfile.findFirst({
    where: { scopeType: target.scopeType, targetId: target.targetId },
  });

export const brandingService = {
  async get(scopeType: SettingScopeType, targetId?: string): Promise<BrandingProfileDto> {
    const target = await authorizedTarget(scopeType, targetId, 'branding.view');
    return toDto(target, await findProfile(target));
  },

  /** Full replace of a level's profile (omitted fields → null → inherited). */
  async put(
    scopeType: SettingScopeType,
    targetId: string | undefined,
    input: BrandingInput,
  ): Promise<BrandingProfileDto> {
    const target = await authorizedTarget(scopeType, targetId, 'branding.manage');
    const before = await findProfile(target);
    const data = Object.fromEntries(
      BRANDING_FIELDS.filter((f) => f !== 'logoFileId').map((f) => [
        f,
        (input as Record<string, string | null | undefined>)[f] ?? null,
      ]),
    );
    // logoFileId is set by the file engine (Layer 4); a changed logo key invalidates it.
    if (before && before.logoStorageKey !== data.logoStorageKey) data.logoFileId = null;
    const db = tenantDb();
    const after = before
      ? await db.brandingProfile.update({ where: { id: before.id }, data })
      : await db.brandingProfile.create({
          data: withTenant({
            scopeType: target.scopeType,
            targetId: target.targetId,
            groupId: target.groupId,
            institutionId: target.institutionId,
            ...data,
          }),
        });
    invalidateBrandingCache();
    await audit.record({
      action: before ? 'branding.update' : 'branding.create',
      entityType: 'branding_profile',
      entityId: after.id,
      before: before ? toDto(target, before) : undefined,
      after: toDto(target, after),
      metadata: { scopeType: target.scopeType, targetId: target.targetId },
    });
    return toDto(target, after);
  },

  /** Remove a level's profile so it fully inherits again. */
  async remove(scopeType: SettingScopeType, targetId?: string): Promise<void> {
    const target = await authorizedTarget(scopeType, targetId, 'branding.manage');
    const before = await findProfile(target);
    if (!before) return;
    await tenantDb().brandingProfile.delete({ where: { id: before.id } });
    invalidateBrandingCache();
    await audit.record({
      action: 'branding.delete',
      entityType: 'branding_profile',
      entityId: before.id,
      before: toDto(target, before),
    });
  },

  async resolved(query: ResolvedBrandingQuery): Promise<ResolvedBrandingDto> {
    const target = await resolveTargetFromQuery(query);
    const principal = currentPrincipal();
    if (target.scopeType === 'ORGANIZATION') assertPermission(principal, 'branding.view');
    else await authorize(principal, 'branding.view', targetResource(target));
    return resolveBranding(currentOrganizationId(), target);
  },
};

import {
  BRANDING_FIELDS,
  LOGO_MAX_BYTES,
  LOGO_UPLOAD_TYPES,
  type SignedUrlDto,
  type BrandingInput,
  type BrandingProfileDto,
  type ResolvedBrandingDto,
  type ResolvedBrandingQuery,
  type SettingScopeType,
} from '@erp/shared';
import type { BrandingProfile } from '@prisma/client';
import { audit } from '../../core/audit';
import { assertPermission, authorize, currentPrincipal } from '../../core/authz';
import { brandingLogoUrl, invalidateBrandingCache, resolveBranding } from '../../core/branding';
import { documentEngine, type IncomingFile } from '../../core/documents';
import { NotFoundError } from '../../core/http/errors';
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
    const data: Record<string, string | null> = Object.fromEntries(
      BRANDING_FIELDS.filter((f) => f !== 'logoFileId').map((f) => [
        f,
        (input as Record<string, string | null | undefined>)[f] ?? null,
      ]),
    );
    if (input.logoStorageKey === undefined) {
      // The logo is managed through the logo upload endpoints: omitting it keeps the current one.
      data.logoStorageKey = before?.logoStorageKey ?? null;
      data.logoFileId = before?.logoFileId ?? null;
    } else if (before && before.logoStorageKey !== data.logoStorageKey) {
      // A changed (or cleared) logo key detaches the uploaded logo file.
      data.logoFileId = null;
    }
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

  /**
   * Upload a level's logo through the document engine (PUBLIC `branding` document owned by the
   * organization / group / institution; PNG/JPEG ≤ 2 MB). Replacing a logo adds a new version
   * of the same logo document. Authorized by `branding.manage` on the target.
   */
  async uploadLogo(
    scopeType: SettingScopeType,
    targetId: string | undefined,
    file: IncomingFile,
  ): Promise<BrandingProfileDto> {
    const target = await authorizedTarget(scopeType, targetId, 'branding.manage');
    const before = await findProfile(target);
    const policy = { types: LOGO_UPLOAD_TYPES, maxBytes: LOGO_MAX_BYTES };
    let documentId: string | null = null;
    if (before?.logoFileId) {
      try {
        await documentEngine.addVersion(before.logoFileId, file, {
          policy,
          reason: 'Logo replaced',
          authorization: 'caller',
        });
        documentId = before.logoFileId;
      } catch (err) {
        if (!(err instanceof NotFoundError)) throw err;
      }
    }
    if (!documentId) {
      const ownerType = scopeType.toLowerCase();
      const doc = await documentEngine.attach({
        ownerType,
        ownerId: target.targetId,
        module: 'branding',
        metadata: {
          title: `Logo (${ownerType})`,
          category: 'branding',
          documentType: 'logo',
          confidentiality: 'PUBLIC',
        },
        file,
        policy,
        authorization: 'caller',
      });
      documentId = doc.id;
    }
    const db = tenantDb();
    const current = await db.document.findFirst({
      where: { id: documentId },
      include: { currentVersion: true },
    });
    const logo = {
      logoFileId: documentId,
      logoStorageKey: current?.currentVersion?.storageKey ?? null,
    };
    const after = before
      ? await db.brandingProfile.update({ where: { id: before.id }, data: logo })
      : await db.brandingProfile.create({
          data: withTenant({
            scopeType: target.scopeType,
            targetId: target.targetId,
            groupId: target.groupId,
            institutionId: target.institutionId,
            ...logo,
          }),
        });
    invalidateBrandingCache();
    await audit.record({
      action: 'branding.logo_upload',
      entityType: 'branding_profile',
      entityId: after.id,
      before: { logoFileId: before?.logoFileId ?? null },
      after: { logoFileId: documentId },
      metadata: { scopeType: target.scopeType, targetId: target.targetId },
    });
    return toDto(target, after);
  },

  /** Detach a level's logo (the logo document itself is kept; delete it via /documents). */
  async removeLogo(scopeType: SettingScopeType, targetId?: string): Promise<BrandingProfileDto> {
    const target = await authorizedTarget(scopeType, targetId, 'branding.manage');
    const before = await findProfile(target);
    if (!before || (!before.logoFileId && !before.logoStorageKey)) return toDto(target, before);
    const after = await tenantDb().brandingProfile.update({
      where: { id: before.id },
      data: { logoFileId: null, logoStorageKey: null },
    });
    invalidateBrandingCache();
    await audit.record({
      action: 'branding.logo_remove',
      entityType: 'branding_profile',
      entityId: before.id,
      before: { logoFileId: before.logoFileId },
      after: { logoFileId: null },
      metadata: { scopeType: target.scopeType, targetId: target.targetId },
    });
    return toDto(target, after);
  },

  /** Signed (audited, short-lived) URL of the resolved logo for a target. */
  async logoUrl(query: ResolvedBrandingQuery): Promise<SignedUrlDto | null> {
    const target = await resolveTargetFromQuery(query);
    const principal = currentPrincipal();
    if (target.scopeType === 'ORGANIZATION') assertPermission(principal, 'branding.view');
    else await authorize(principal, 'branding.view', targetResource(target));
    return brandingLogoUrl(target);
  },

  async resolved(query: ResolvedBrandingQuery): Promise<ResolvedBrandingDto> {
    const target = await resolveTargetFromQuery(query);
    const principal = currentPrincipal();
    if (target.scopeType === 'ORGANIZATION') assertPermission(principal, 'branding.view');
    else await authorize(principal, 'branding.view', targetResource(target));
    return resolveBranding(currentOrganizationId(), target);
  },
};

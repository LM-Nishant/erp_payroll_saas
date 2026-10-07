import type { MeResponse, ResolvedBrandingDto, ScopeSummary, SignedUrlDto } from '@erp/shared';
import { prisma } from '../db/prisma';
import { effectivePermissions, type Principal } from '../authz/principal';
import { resolveBranding } from '../branding';
import { documentEngine } from '../documents';
import { enabledFeaturesAnywhere } from '../features/features';
import type { SettingTarget } from '../settings/target';
import { getUserById } from './identity';

async function licensing(principal: Principal) {
  if (!principal.organizationId) return { features: [], branding: null };
  const organizationId = principal.organizationId;
  return {
    features: await enabledFeaturesAnywhere({ organizationId }),
    branding: await homeBranding(principal, organizationId),
  };
}

/**
 * Signed URL of the principal's home logo for the app shell. Any member may read it (the logo is
 * shown to everyone); issuing it is audited as `document.download`, so clients fetch it only when
 * `branding.logoFileId` changes.
 */
export async function homeLogoUrl(principal: Principal): Promise<SignedUrlDto | null> {
  if (!principal.organizationId) return null;
  const branding = await homeBranding(principal, principal.organizationId);
  if (!branding.logoFileId) return null;
  return documentEngine.currentVersionUrl(branding.logoFileId, 'inline');
}

/**
 * Branding for the principal's "home": its single institution, else its single group, else the
 * organization. Campus / department scopes count as their institution.
 */
async function homeBranding(
  principal: Principal,
  organizationId: string,
): Promise<ResolvedBrandingDto> {
  const orgTarget: SettingTarget = {
    scopeType: 'ORGANIZATION',
    targetId: organizationId,
    groupId: null,
    institutionId: null,
  };
  const scopes = principal.grants.flatMap((g) => g.scopes);
  if (scopes.length === 0 || scopes.some((s) => s.type === 'ORGANIZATION')) {
    return resolveBranding(organizationId, orgTarget);
  }
  const ids = (type: string) => scopes.filter((s) => s.type === type).map((s) => s.id!);
  const [campuses, departments] = await Promise.all([
    prisma.campus.findMany({
      where: { organizationId, id: { in: ids('CAMPUS') } },
      select: { institutionId: true },
    }),
    prisma.department.findMany({
      where: { organizationId, id: { in: ids('DEPARTMENT') } },
      select: { institutionId: true },
    }),
  ]);
  const institutionIds = new Set([
    ...ids('INSTITUTION'),
    ...campuses.map((c) => c.institutionId),
    ...departments.map((d) => d.institutionId),
  ]);
  const groupIds = new Set(ids('GROUP'));
  if (groupIds.size === 0 && institutionIds.size === 1) {
    const inst = await prisma.institution.findFirst({
      where: { organizationId, id: [...institutionIds][0]! },
      select: { id: true, groupId: true },
    });
    if (inst) {
      return resolveBranding(organizationId, {
        scopeType: 'INSTITUTION',
        targetId: inst.id,
        groupId: inst.groupId,
        institutionId: inst.id,
      });
    }
  }
  if (groupIds.size === 1) {
    const groupId = [...groupIds][0]!;
    const outside = await prisma.institution.count({
      where: { organizationId, id: { in: [...institutionIds] }, NOT: { groupId } },
    });
    if (outside === 0) {
      return resolveBranding(organizationId, {
        scopeType: 'GROUP',
        targetId: groupId,
        groupId,
        institutionId: null,
      });
    }
  }
  return resolveBranding(organizationId, orgTarget);
}

/** Profile + roles/scopes + effective permissions of the principal (drives the frontend menu). */
export async function getMe(principal: Principal): Promise<MeResponse> {
  if (!principal.userId) {
    // Dev-header principal (dev/test only): no identity.
    return {
      user: { id: 'dev', email: 'dev@localhost', name: 'Developer', mfaEnabled: false },
      organization: principal.organizationId
        ? await organizationSummary(principal.organizationId)
        : null,
      platformAccess: false,
      platformRoles: [],
      roles: [],
      permissions: effectivePermissions(principal),
      ...(await licensing(principal)),
    };
  }
  const user = await getUserById(principal.userId);
  const roles =
    principal.organizationId && principal.actorType === 'user'
      ? await roleSummaries(principal.userId, principal.organizationId)
      : [];
  return {
    user: { id: user.id, email: user.email, name: user.name, mfaEnabled: user.mfaEnabled },
    organization: principal.organizationId
      ? await organizationSummary(principal.organizationId)
      : null,
    platformAccess: principal.actorType === 'platform',
    platformRoles: [...principal.platformRoles],
    roles,
    permissions: effectivePermissions(principal),
    ...(await licensing(principal)),
  };
}

function organizationSummary(id: string) {
  return prisma.organization.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, slug: true, name: true, kind: true },
  });
}

async function roleSummaries(userId: string, organizationId: string) {
  const rows = await prisma.userRole.findMany({
    where: { userId, organizationId, role: { deletedAt: null } },
    include: {
      role: { select: { key: true, name: true } },
      scopes: {
        include: {
          group: { select: { name: true } },
          institution: { select: { name: true } },
          campus: { select: { name: true } },
          department: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((row) => ({
    key: row.role.key,
    name: row.role.name,
    scopes: row.scopes.map(scopeSummary),
  }));
}

type ScopeRow = {
  scopeType: ScopeSummary['type'];
  groupId: string | null;
  institutionId: string | null;
  campusId: string | null;
  departmentId: string | null;
  group: { name: string } | null;
  institution: { name: string } | null;
  campus: { name: string } | null;
  department: { name: string } | null;
};

export function scopeSummary(s: ScopeRow): ScopeSummary {
  switch (s.scopeType) {
    case 'GROUP':
      return { type: 'GROUP', id: s.groupId, name: s.group?.name ?? null };
    case 'INSTITUTION':
      return { type: 'INSTITUTION', id: s.institutionId, name: s.institution?.name ?? null };
    case 'CAMPUS':
      return { type: 'CAMPUS', id: s.campusId, name: s.campus?.name ?? null };
    case 'DEPARTMENT':
      return { type: 'DEPARTMENT', id: s.departmentId, name: s.department?.name ?? null };
    default:
      return { type: 'ORGANIZATION', id: null, name: null };
  }
}

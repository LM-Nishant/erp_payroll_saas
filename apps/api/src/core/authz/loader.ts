import { prisma } from '../db/prisma';
import { ALL_TENANT_PERMISSIONS, PLATFORM_ROLES } from './default-roles';
import { createPrincipal, type Grant, type Principal } from './principal';

export async function loadPlatformRoleKeys(userId: string): Promise<string[]> {
  const rows = await prisma.platformRoleAssignment.findMany({
    where: { userId },
    select: { roleKey: true },
  });
  const known = new Set(PLATFORM_ROLES.map((r) => r.key));
  return rows.map((r) => r.roleKey).filter((k) => known.has(k));
}

function platformDefinitions(roleKeys: readonly string[]) {
  return PLATFORM_ROLES.filter((r) => roleKeys.includes(r.key));
}

export function platformPermissionsFor(roleKeys: readonly string[]): Set<string> {
  return new Set(platformDefinitions(roleKeys).flatMap((r) => r.platformPermissions));
}

/** Role assignments (+ permissions + scopes) of a user within one organization. */
export async function loadUserGrants(userId: string, organizationId: string): Promise<Grant[]> {
  const rows = await prisma.userRole.findMany({
    where: { organizationId, userId, role: { deletedAt: null } },
    include: {
      role: {
        select: {
          key: true,
          rolePermissions: { select: { permission: { select: { code: true } } } },
        },
      },
      scopes: {
        select: {
          scopeType: true,
          groupId: true,
          institutionId: true,
          campusId: true,
          departmentId: true,
        },
      },
    },
  });
  return rows.map((row) => ({
    roleKey: row.role.key,
    permissions: new Set(row.role.rolePermissions.map((rp) => rp.permission.code)),
    scopes: row.scopes.map((s) => ({
      type: s.scopeType,
      id:
        s.scopeType === 'GROUP'
          ? s.groupId
          : s.scopeType === 'INSTITUTION'
            ? s.institutionId
            : s.scopeType === 'CAMPUS'
              ? s.campusId
              : s.scopeType === 'DEPARTMENT'
                ? s.departmentId
                : null,
    })),
  }));
}

export interface AuthContext {
  userId: string;
  sessionId: string;
  organizationId: string | null;
  platformAccessReason: string | null;
}

export async function buildPrincipal(auth: AuthContext): Promise<Principal> {
  const platformRoles = await loadPlatformRoleKeys(auth.userId);
  const base = {
    userId: auth.userId,
    sessionId: auth.sessionId,
    organizationId: auth.organizationId,
    platformRoles,
    platformPermissions: platformPermissionsFor(platformRoles),
  };
  if (auth.platformAccessReason && auth.organizationId) {
    // Audited platform tenant-access session: tenant permissions from the platform role, org-wide.
    const permissions = new Set(
      platformDefinitions(platformRoles).flatMap((r) => r.tenantAccessPermissions),
    );
    return createPrincipal({
      ...base,
      actorType: 'platform',
      platformAccessReason: auth.platformAccessReason,
      grants: [
        { roleKey: 'platform_access', permissions, scopes: [{ type: 'ORGANIZATION', id: null }] },
      ],
    });
  }
  const grants = auth.organizationId ? await loadUserGrants(auth.userId, auth.organizationId) : [];
  return createPrincipal({ ...base, actorType: 'user', grants });
}

/** DEV/TEST ONLY principal for the X-Dev-Organization header: every tenant permission, org-wide. */
export function devPrincipal(organizationId: string): Principal {
  return createPrincipal({
    actorType: 'dev',
    userId: null,
    sessionId: null,
    organizationId,
    grants: [
      {
        roleKey: 'dev',
        permissions: new Set(ALL_TENANT_PERMISSIONS),
        scopes: [{ type: 'ORGANIZATION', id: null }],
      },
    ],
  });
}

/** Principal for trusted server code (jobs, seeds) acting inside a tenant. */
export function systemPrincipal(organizationId: string | null): Principal {
  return createPrincipal({
    actorType: 'system',
    userId: null,
    sessionId: null,
    organizationId,
    grants: [
      {
        roleKey: 'system',
        permissions: new Set(ALL_TENANT_PERMISSIONS),
        scopes: [{ type: 'ORGANIZATION', id: null }],
      },
    ],
  });
}

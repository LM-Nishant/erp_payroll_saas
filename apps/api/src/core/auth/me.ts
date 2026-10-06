import type { MeResponse, ScopeSummary } from '@erp/shared';
import { prisma } from '../db/prisma';
import { effectivePermissions, type Principal } from '../authz/principal';
import { getUserById } from './identity';

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
  };
}

function organizationSummary(id: string) {
  return prisma.organization.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, slug: true, name: true },
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

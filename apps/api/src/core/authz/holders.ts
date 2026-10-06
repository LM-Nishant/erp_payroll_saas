import { currentOrganizationId } from '../tenancy/context';
import { tenantDb } from '../tenancy/tenant-db';
import type { ResourceScope } from './engine';

/** Fill in missing ancestor coordinates (department → campus/institution → group). */
export async function completeResource(resource: ResourceScope): Promise<ResourceScope> {
  const db = tenantDb();
  const out: ResourceScope = { ...resource };
  if (out.departmentId && (!out.institutionId || out.campusId === undefined)) {
    const d = await db.department.findFirst({
      where: { id: out.departmentId },
      select: { institutionId: true, campusId: true },
    });
    if (d) {
      out.institutionId ??= d.institutionId;
      out.campusId ??= d.campusId;
    }
  }
  if (out.campusId && !out.institutionId) {
    const c = await db.campus.findFirst({
      where: { id: out.campusId },
      select: { institutionId: true },
    });
    if (c) out.institutionId = c.institutionId;
  }
  if (out.institutionId && out.groupId === undefined) {
    const i = await db.institution.findFirst({
      where: { id: out.institutionId },
      select: { groupId: true },
    });
    out.groupId = i?.groupId ?? null;
  }
  return out;
}

export interface HolderQuery {
  /** Users holding this permission (via any role) in a scope covering the resource. */
  permission?: string;
  /** …or holding one of these roles in a covering scope. */
  roleKeys?: string[];
  resource?: ResourceScope;
}

/**
 * Active members of the current organization whose role assignment matches the query in a scope
 * covering `resource` (organization-wide, or its group / institution / campus / department).
 * Mirrors `covers()` for the stored (unexpanded) scopes, so call it with a completed resource.
 */
export async function findScopeHolders(query: HolderQuery): Promise<string[]> {
  if (!query.permission && !query.roleKeys?.length) return [];
  const r = await completeResource(query.resource ?? {});
  const coords = [
    { scopeType: 'ORGANIZATION' as const },
    ...(r.groupId ? [{ groupId: r.groupId }] : []),
    ...(r.institutionId ? [{ institutionId: r.institutionId }] : []),
    ...(r.campusId ? [{ campusId: r.campusId }] : []),
    ...(r.departmentId ? [{ departmentId: r.departmentId }] : []),
  ];
  const roleFilter = {
    deletedAt: null,
    ...(query.roleKeys?.length ? { key: { in: query.roleKeys } } : {}),
    ...(query.permission
      ? { rolePermissions: { some: { permission: { code: query.permission } } } }
      : {}),
  };
  const rows = await tenantDb().userScope.findMany({
    where: {
      OR: coords,
      userRole: { role: roleFilter },
      user: {
        status: 'ACTIVE',
        deletedAt: null,
        memberships: {
          some: { organizationId: currentOrganizationId(), status: 'ACTIVE', deletedAt: null },
        },
      },
    },
    select: { userId: true },
    distinct: ['userId'],
  });
  return rows.map((row) => row.userId);
}

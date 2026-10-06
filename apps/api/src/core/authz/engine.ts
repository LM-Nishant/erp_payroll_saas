import { ForbiddenError } from '../http/errors';
import { tenantDb } from '../tenancy/tenant-db';
import type { Principal } from './principal';

/**
 * Hierarchy coordinates of a resource. Pass every ancestor id you have — a resource is
 * covered when ANY coordinate falls within the principal's (expanded) scopes.
 * `{}` means an organization-level resource: only ORGANIZATION-scoped grants cover it.
 */
export interface ResourceScope {
  groupId?: string | null;
  institutionId?: string | null;
  campusId?: string | null;
  departmentId?: string | null;
}

/**
 * Where a principal holds a permission. Group scopes are expanded to their institutions and
 * campus scopes to their departments, so a coordinate match on any level is sufficient.
 */
export interface AccessSet {
  all: boolean;
  groupIds: ReadonlySet<string>;
  institutionIds: ReadonlySet<string>;
  campusIds: ReadonlySet<string>;
  departmentIds: ReadonlySet<string>;
}

export interface ScopeExpander {
  institutionIdsInGroups(groupIds: string[]): Promise<string[]>;
  departmentIdsInCampuses(campusIds: string[]): Promise<string[]>;
}

/** Default expander: hierarchy lookups through the tenant client (current organization only). */
export const tenantScopeExpander: ScopeExpander = {
  async institutionIdsInGroups(groupIds) {
    if (groupIds.length === 0) return [];
    const rows = await tenantDb().institution.findMany({
      where: { groupId: { in: groupIds } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  },
  async departmentIdsInCampuses(campusIds) {
    if (campusIds.length === 0) return [];
    const rows = await tenantDb().department.findMany({
      where: { campusId: { in: campusIds } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  },
};

/** True if the principal holds `permission` in at least one scope (or platform-wide). */
export function hasPermission(principal: Principal, permission: string): boolean {
  if (principal.platformPermissions.has(permission)) return true;
  return principal.grants.some((g) => g.permissions.has(permission));
}

export function assertPermission(principal: Principal, permission: string): void {
  if (!hasPermission(principal, permission)) throw permissionDenied(permission);
}

export function permissionDenied(permission: string): ForbiddenError {
  return new ForbiddenError(`Missing permission "${permission}"`, 'PERMISSION_DENIED');
}

/** Unexpanded scopes in which the principal holds `permission`. */
function directAccess(principal: Principal, permission: string) {
  const access = {
    all: false,
    groupIds: new Set<string>(),
    institutionIds: new Set<string>(),
    campusIds: new Set<string>(),
    departmentIds: new Set<string>(),
  };
  for (const grant of principal.grants) {
    if (!grant.permissions.has(permission)) continue;
    for (const scope of grant.scopes) {
      if (scope.type === 'ORGANIZATION') access.all = true;
      else if (scope.id) {
        const key = {
          GROUP: 'groupIds',
          INSTITUTION: 'institutionIds',
          CAMPUS: 'campusIds',
          DEPARTMENT: 'departmentIds',
        } as const;
        access[key[scope.type]].add(scope.id);
      }
    }
  }
  return access;
}

export async function accessFor(
  principal: Principal,
  permission: string,
  expander: ScopeExpander = tenantScopeExpander,
): Promise<AccessSet> {
  const cacheKey = `access:${permission}`;
  const cached = principal.cache.get(cacheKey) as AccessSet | undefined;
  if (cached) return cached;
  const access = directAccess(principal, permission);
  if (!access.all) {
    const [institutions, departments] = await Promise.all([
      expander.institutionIdsInGroups([...access.groupIds]),
      expander.departmentIdsInCampuses([...access.campusIds]),
    ]);
    institutions.forEach((id) => access.institutionIds.add(id));
    departments.forEach((id) => access.departmentIds.add(id));
  }
  principal.cache.set(cacheKey, access);
  return access;
}

export function covers(access: AccessSet, resource: ResourceScope): boolean {
  if (access.all) return true;
  return Boolean(
    (resource.groupId && access.groupIds.has(resource.groupId)) ||
    (resource.institutionId && access.institutionIds.has(resource.institutionId)) ||
    (resource.campusId && access.campusIds.has(resource.campusId)) ||
    (resource.departmentId && access.departmentIds.has(resource.departmentId)),
  );
}

export async function can(
  principal: Principal,
  permission: string,
  resource: ResourceScope = {},
  expander?: ScopeExpander,
): Promise<boolean> {
  if (!hasPermission(principal, permission)) return false;
  return covers(await accessFor(principal, permission, expander), resource);
}

/**
 * Service-level authorization: the principal must hold `permission` AND the resource must fall
 * inside one of the scopes the permission was granted in. Throws 403 PERMISSION_DENIED.
 */
export async function authorize(
  principal: Principal,
  permission: string,
  resource: ResourceScope = {},
  expander?: ScopeExpander,
): Promise<void> {
  if (!hasPermission(principal, permission)) throw permissionDenied(permission);
  if (!covers(await accessFor(principal, permission, expander), resource)) {
    throw new ForbiddenError(
      `Permission "${permission}" is not granted for this resource's scope`,
      'SCOPE_DENIED',
    );
  }
}

/** Hierarchy models that can be scope-filtered with `scopeWhere`. */
export type ScopedModel =
  | 'group'
  | 'institution'
  | 'campus'
  | 'department'
  | 'program'
  | 'classSection'
  | 'userScope'
  | 'document';

type Column = 'id' | 'groupId' | 'institutionId' | 'campusId' | 'departmentId';

/** Which column of each model is matched against each kind of scope id. */
const COLUMNS: Record<ScopedModel, Partial<Record<keyof Omit<AccessSet, 'all'>, Column>>> = {
  group: { groupIds: 'id' },
  institution: { groupIds: 'groupId', institutionIds: 'id' },
  campus: { institutionIds: 'institutionId', campusIds: 'id' },
  department: { institutionIds: 'institutionId', campusIds: 'campusId', departmentIds: 'id' },
  program: { institutionIds: 'institutionId', departmentIds: 'departmentId' },
  classSection: {
    institutionIds: 'institutionId',
    campusIds: 'campusId',
    departmentIds: 'departmentId',
  },
  userScope: {
    groupIds: 'groupId',
    institutionIds: 'institutionId',
    campusIds: 'campusId',
    departmentIds: 'departmentId',
  },
  document: {
    groupIds: 'groupId',
    institutionIds: 'institutionId',
    campusIds: 'campusId',
    departmentIds: 'departmentId',
  },
};

/** Prisma `where` fragment restricting `model` rows to the access set (undefined = no filter). */
export function whereForAccess(
  access: AccessSet,
  model: ScopedModel,
): Record<string, unknown> | undefined {
  if (access.all) return undefined;
  const or: Record<string, unknown>[] = [];
  for (const [kind, column] of Object.entries(COLUMNS[model]) as [
    keyof Omit<AccessSet, 'all'>,
    Column,
  ][]) {
    const ids = [...access[kind]];
    if (ids.length > 0) or.push({ [column]: { in: ids } });
  }
  // No accessible scope: match nothing.
  return or.length > 0 ? { OR: or } : { id: { in: [] } };
}

/**
 * Prisma `where` fragment limiting a list/read query on a hierarchy model to the principal's
 * scopes for `permission`. Combine with AND: `{ AND: [userWhere, await scopeWhere(...)] }`.
 * Throws 403 if the permission is not held at all.
 */
export async function scopeWhere(
  principal: Principal,
  permission: string,
  model: ScopedModel,
): Promise<Record<string, unknown> | undefined> {
  assertPermission(principal, permission);
  return whereForAccess(await accessFor(principal, permission), model);
}

/** Combine a query `where` with a `scopeWhere` fragment. */
export function andScope<T extends object>(
  where: T,
  scope: Record<string, unknown> | undefined,
): T {
  return scope ? ({ AND: [where, scope] } as T) : where;
}

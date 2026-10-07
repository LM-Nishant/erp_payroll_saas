import type { SettingScopeType } from '@erp/shared';
import type { ResourceScope } from '../authz/engine';
import { InvalidReferenceError, ValidationError } from '../http/errors';
import { currentOrganizationId } from '../tenancy/context';
import { tenantDb } from '../tenancy/tenant-db';

/**
 * A hierarchy level that carries settings (feature overrides, branding, secrets):
 * the organization itself, a group, or an institution (with its denormalized group).
 */
export interface SettingTarget {
  scopeType: SettingScopeType;
  /** organizationId / groupId / institutionId according to scopeType. */
  targetId: string;
  groupId: string | null;
  institutionId: string | null;
}

/** Resolve a client-supplied target inside the CURRENT tenant (422 if it does not exist). */
export async function resolveSettingTarget(
  scopeType: SettingScopeType,
  targetId?: string | null,
): Promise<SettingTarget> {
  const organizationId = currentOrganizationId();
  if (scopeType === 'ORGANIZATION') {
    return { scopeType, targetId: organizationId, groupId: null, institutionId: null };
  }
  if (!targetId) throw new ValidationError('targetId is required for GROUP / INSTITUTION');
  if (scopeType === 'GROUP') {
    const group = await tenantDb().group.findFirst({
      where: { id: targetId },
      select: { id: true },
    });
    if (!group) throw new InvalidReferenceError('targetId', 'Group');
    return { scopeType, targetId: group.id, groupId: group.id, institutionId: null };
  }
  const inst = await tenantDb().institution.findFirst({
    where: { id: targetId },
    select: { id: true, groupId: true },
  });
  if (!inst) throw new InvalidReferenceError('targetId', 'Institution');
  return { scopeType, targetId: inst.id, groupId: inst.groupId, institutionId: inst.id };
}

/**
 * Resolve the most specific target from optional query coordinates
 * (institution > group > organization).
 */
export async function resolveTargetFromQuery(query: {
  institutionId?: string | undefined;
  groupId?: string | undefined;
}): Promise<SettingTarget> {
  if (query.institutionId) return resolveSettingTarget('INSTITUTION', query.institutionId);
  if (query.groupId) return resolveSettingTarget('GROUP', query.groupId);
  return resolveSettingTarget('ORGANIZATION');
}

/** Authorization coordinates of a target (`{}` = organization-wide). */
export function targetResource(target: SettingTarget): ResourceScope {
  if (target.scopeType === 'ORGANIZATION') return {};
  return { groupId: target.groupId, institutionId: target.institutionId };
}

/**
 * Prisma `where` fragment for rows carrying settings-target columns (`groupId`,
 * `institutionId`): organization-level rows need organization-wide access.
 */
export function whereForTargetAccess(access: {
  all: boolean;
  groupIds: ReadonlySet<string>;
  institutionIds: ReadonlySet<string>;
}): { OR: Array<Record<string, unknown>> } | { id: { in: string[] } } | undefined {
  if (access.all) return undefined;
  const or: Array<Record<string, unknown>> = [];
  if (access.groupIds.size > 0) or.push({ groupId: { in: [...access.groupIds] } });
  if (access.institutionIds.size > 0)
    or.push({ institutionId: { in: [...access.institutionIds] } });
  return or.length > 0 ? { OR: or } : { id: { in: [] } };
}

/** Same for rows that only carry an optional `institutionId` (null = organization level). */
export function whereForInstitutionAccess(access: {
  all: boolean;
  institutionIds: ReadonlySet<string>;
}): { institutionId: { in: string[] } } | undefined {
  if (access.all) return undefined;
  return { institutionId: { in: [...access.institutionIds] } };
}

/** Resource scope of a row with an optional institution (+ its group). */
export function rowResource(row: { groupId?: string | null; institutionId?: string | null }) {
  return { groupId: row.groupId ?? null, institutionId: row.institutionId ?? null };
}

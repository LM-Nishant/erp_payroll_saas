import type { ScopeInput, ScopeType } from '@erp/shared';
import { InvalidReferenceError } from '../http/errors';
import { tenantDb } from '../tenancy/tenant-db';
import type { ResourceScope } from './engine';

/** A scope target with its denormalized ancestors (stored on UserScope). */
export interface ResolvedScope {
  scopeType: ScopeType;
  groupId: string | null;
  institutionId: string | null;
  campusId: string | null;
  departmentId: string | null;
}

/** Resolve a client-supplied scope to a hierarchy entity of the CURRENT tenant (422 if absent). */
export async function resolveScopeTarget(scope: ScopeInput): Promise<ResolvedScope> {
  const db = tenantDb();
  const empty = { groupId: null, institutionId: null, campusId: null, departmentId: null };
  switch (scope.type) {
    case 'ORGANIZATION':
      return { scopeType: 'ORGANIZATION', ...empty };
    case 'GROUP': {
      const group = await db.group.findFirst({ where: { id: scope.id }, select: { id: true } });
      if (!group) throw new InvalidReferenceError('scopes.id', 'Group');
      return { scopeType: 'GROUP', ...empty, groupId: group.id };
    }
    case 'INSTITUTION': {
      const inst = await db.institution.findFirst({
        where: { id: scope.id },
        select: { id: true, groupId: true },
      });
      if (!inst) throw new InvalidReferenceError('scopes.id', 'Institution');
      return { scopeType: 'INSTITUTION', ...empty, groupId: inst.groupId, institutionId: inst.id };
    }
    case 'CAMPUS': {
      const campus = await db.campus.findFirst({
        where: { id: scope.id },
        select: { id: true, institutionId: true, institution: { select: { groupId: true } } },
      });
      if (!campus) throw new InvalidReferenceError('scopes.id', 'Campus');
      return {
        scopeType: 'CAMPUS',
        ...empty,
        groupId: campus.institution.groupId,
        institutionId: campus.institutionId,
        campusId: campus.id,
      };
    }
    case 'DEPARTMENT': {
      const dept = await db.department.findFirst({
        where: { id: scope.id },
        select: {
          id: true,
          institutionId: true,
          campusId: true,
          institution: { select: { groupId: true } },
        },
      });
      if (!dept) throw new InvalidReferenceError('scopes.id', 'Department');
      return {
        scopeType: 'DEPARTMENT',
        groupId: dept.institution.groupId,
        institutionId: dept.institutionId,
        campusId: dept.campusId,
        departmentId: dept.id,
      };
    }
  }
}

/**
 * The resource coordinates of a scope target, used to check that an assigner's own scopes
 * cover it. Only the target level and its ancestors are included.
 */
export function scopeAsResource(scope: ResolvedScope): ResourceScope {
  return {
    groupId: scope.groupId,
    institutionId: scope.institutionId,
    campusId: scope.campusId,
    departmentId: scope.departmentId,
  };
}

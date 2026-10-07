import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '../http/errors';
import {
  authorize,
  can,
  covers,
  hasPermission,
  whereForAccess,
  type ScopeExpander,
} from './engine';
import { createPrincipal, type Grant } from './principal';

const expander: ScopeExpander = {
  institutionIdsInGroups: async (ids) => (ids.includes('g1') ? ['i1', 'i2'] : []),
  departmentIdsInCampuses: async (ids) => (ids.includes('c1') ? ['d1'] : []),
};

function principal(...grants: Grant[]) {
  return createPrincipal({
    actorType: 'user',
    userId: 'u',
    sessionId: 's',
    organizationId: 'o',
    grants,
  });
}
const grant = (permissions: string[], scopes: Grant['scopes']): Grant => ({
  roleKey: 'r',
  permissions: new Set(permissions),
  scopes,
});

describe('authorization engine', () => {
  it('requires the permission', async () => {
    const p = principal(grant(['institution.view'], [{ type: 'ORGANIZATION', id: null }]));
    expect(hasPermission(p, 'institution.view')).toBe(true);
    expect(await can(p, 'institution.update', {}, expander)).toBe(false);
    await expect(authorize(p, 'institution.update', {}, expander)).rejects.toThrow(ForbiddenError);
  });

  it('organization scope covers everything', async () => {
    const p = principal(grant(['institution.view'], [{ type: 'ORGANIZATION', id: null }]));
    expect(await can(p, 'institution.view', { institutionId: 'x' }, expander)).toBe(true);
    expect(await can(p, 'institution.view', {}, expander)).toBe(true);
  });

  it('group scope covers institutions of the group, not org-level resources', async () => {
    const p = principal(grant(['institution.view'], [{ type: 'GROUP', id: 'g1' }]));
    expect(await can(p, 'institution.view', { institutionId: 'i2' }, expander)).toBe(true);
    expect(await can(p, 'institution.view', { groupId: 'g1' }, expander)).toBe(true);
    expect(await can(p, 'institution.view', { institutionId: 'i9' }, expander)).toBe(false);
    expect(await can(p, 'institution.view', {}, expander)).toBe(false);
  });

  it('institution scope does not leak into sibling institutions', async () => {
    const p = principal(grant(['department.view'], [{ type: 'INSTITUTION', id: 'i1' }]));
    expect(
      await can(p, 'department.view', { institutionId: 'i1', departmentId: 'd5' }, expander),
    ).toBe(true);
    expect(
      await can(p, 'department.view', { institutionId: 'i2', departmentId: 'd6' }, expander),
    ).toBe(false);
  });

  it('campus scope expands to departments; department scope is narrow', async () => {
    const campus = principal(grant(['program.view'], [{ type: 'CAMPUS', id: 'c1' }]));
    expect(
      await can(campus, 'program.view', { institutionId: 'i1', departmentId: 'd1' }, expander),
    ).toBe(true);
    const hod = principal(grant(['program.view'], [{ type: 'DEPARTMENT', id: 'd1' }]));
    expect(
      await can(hod, 'program.view', { institutionId: 'i1', departmentId: 'd2' }, expander),
    ).toBe(false);
  });

  it('scopes are per grant: a permission only applies within its own assignment scopes', async () => {
    const p = principal(
      grant(['institution.update'], [{ type: 'INSTITUTION', id: 'i1' }]),
      grant(['institution.view'], [{ type: 'ORGANIZATION', id: null }]),
    );
    expect(await can(p, 'institution.view', { institutionId: 'i2' }, expander)).toBe(true);
    expect(await can(p, 'institution.update', { institutionId: 'i2' }, expander)).toBe(false);
  });

  it('builds where clauses', () => {
    const none = {
      all: false,
      groupIds: new Set<string>(),
      institutionIds: new Set<string>(),
      campusIds: new Set<string>(),
      departmentIds: new Set<string>(),
    };
    expect(whereForAccess({ ...none, all: true }, 'campus')).toBeUndefined();
    expect(whereForAccess(none, 'campus')).toEqual({ id: { in: [] } });
    expect(whereForAccess({ ...none, institutionIds: new Set(['i1']) }, 'program')).toEqual({
      OR: [{ institutionId: { in: ['i1'] } }],
    });
    expect(covers({ ...none, departmentIds: new Set(['d1']) }, { departmentId: 'd1' })).toBe(true);
  });
});

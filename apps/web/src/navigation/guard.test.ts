import { describe, expect, it } from 'vitest';
import type { RouteLocationNormalized } from 'vue-router';
import { guardDecision, isPortalOnlyUser } from './guard';

const route = (
  name: string,
  fullPath: string,
  metas: Array<Record<string, unknown>>,
): Pick<RouteLocationNormalized, 'matched' | 'fullPath' | 'name'> => ({
  name,
  fullPath,
  matched: metas.map((meta) => ({ meta })) as unknown as RouteLocationNormalized['matched'],
});

const anon = { isAuthenticated: false, can: () => false };
const user = (perms: string[]) => ({
  isAuthenticated: true,
  can: (p?: string) => !p || perms.includes(p),
});

describe('guardDecision', () => {
  it('redirects anonymous users to login with a return path', () => {
    expect(guardDecision(route('x', '/group/users', [{}, {}]), anon)).toEqual({
      name: 'login',
      query: { redirect: '/group/users' },
    });
  });

  it('allows public routes and bounces signed-in users away from login', () => {
    expect(guardDecision(route('login', '/login', [{ public: true }]), anon)).toBe(true);
    expect(guardDecision(route('login', '/login', [{ public: true }]), user([]))).toEqual({
      name: 'home',
    });
  });

  it('sends platform-only users (no organization) home from tenant workspaces', () => {
    const r = route('employee-approvals', '/employee/approvals', [{ tenant: true }, {}]);
    expect(guardDecision(r, { ...user([]), hasOrganization: false })).toEqual({ name: 'home' });
    expect(guardDecision(r, { ...user([]), hasOrganization: true })).toBe(true);
    expect(
      guardDecision(route('platform', '/platform', [{}]), { ...user([]), hasOrganization: false }),
    ).toBe(true);
  });

  it('requires every matched permission', () => {
    const to = route('group-users', '/group/users', [
      { permission: 'group.view' },
      { permission: 'user.view' },
    ]);
    expect(guardDecision(to, user(['group.view', 'user.view']))).toBe(true);
    expect(guardDecision(to, user(['group.view']))).toEqual({ name: 'forbidden' });
  });

  it('redirects to module-disabled when the module is not enabled', () => {
    const to = route('payroll', '/institution/payroll', [{}, { feature: 'payroll' }]);
    const state = { ...user([]), hasFeature: (f?: string) => !f || f === 'education' };
    expect(guardDecision(to, state)).toEqual({ name: 'module-disabled' });
    expect(guardDecision(to, { ...user([]), hasFeature: () => true })).toBe(true);
  });
});

describe('portal-only users (students/parents)', () => {
  const me = (keys: string[], permissions: string[] = []) => ({
    roles: keys.map((key) => ({ key })),
    permissions,
  });

  it('detects accounts whose roles are all student/parent', () => {
    expect(isPortalOnlyUser(me(['student']))).toBe(true);
    expect(isPortalOnlyUser(me(['parent']))).toBe(true);
    expect(isPortalOnlyUser(me(['parent', 'student']))).toBe(true);
    expect(isPortalOnlyUser(me(['parent', 'teacher']))).toBe(false);
    expect(isPortalOnlyUser(me(['parent'], ['employee.view_own']))).toBe(false);
    expect(isPortalOnlyUser(me([]))).toBe(false);
    expect(isPortalOnlyUser(null)).toBe(false);
  });

  it('redirects them from staff workspaces to the portal', () => {
    const r = route('employee-home', '/employee', [{ tenant: true, staff: true }, {}]);
    expect(guardDecision(r, { ...user([]), portalOnly: true })).toEqual({ path: '/portal' });
    expect(guardDecision(r, { ...user([]), portalOnly: false })).toBe(true);
    const portal = route('portal-profile', '/portal/profile', [{ tenant: true }, {}]);
    expect(guardDecision(portal, { ...user([]), portalOnly: true })).toBe(true);
  });
});

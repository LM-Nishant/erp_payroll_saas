import { describe, expect, it } from 'vitest';
import type { RouteLocationNormalized } from 'vue-router';
import { guardDecision } from './guard';

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

  it('requires every matched permission', () => {
    const to = route('group-users', '/group/users', [
      { permission: 'group.view' },
      { permission: 'user.view' },
    ]);
    expect(guardDecision(to, user(['group.view', 'user.view']))).toBe(true);
    expect(guardDecision(to, user(['group.view']))).toEqual({ name: 'forbidden' });
  });
});

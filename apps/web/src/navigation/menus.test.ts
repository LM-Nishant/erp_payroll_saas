import { describe, expect, it } from 'vitest';
import { MENUS, WORKSPACES, visibleMenu } from './menus';

describe('visibleMenu', () => {
  it('hides items the user lacks permission for', () => {
    const items = visibleMenu(MENUS.group, (p) => !p);
    expect(items.map((i) => i.title)).toEqual(['Dashboard']);
  });

  it('shows everything for wildcard permissions', () => {
    expect(visibleMenu(MENUS.group, () => true)).toHaveLength(MENUS.group.length);
  });

  it('filters by the exact permissions from /me', () => {
    const perms = new Set(['institution.view', 'department.view']);
    const can = (p?: string) => !p || perms.has(p);
    expect(visibleMenu(MENUS.institution, can).map((i) => i.title)).toEqual([
      'Dashboard',
      'Departments',
    ]);
    expect(visibleMenu(WORKSPACES, can).map((w) => w.layout)).toEqual(['institution', 'employee']);
  });
});

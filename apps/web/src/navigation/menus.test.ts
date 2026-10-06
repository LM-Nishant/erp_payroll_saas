import { describe, expect, it } from 'vitest';
import { MENUS, WORKSPACES, visibleMenu, type MenuItem } from './menus';

describe('visibleMenu', () => {
  it('hides items the user lacks permission for', () => {
    const items = visibleMenu(MENUS.group, (p) => !p);
    // Approvals inbox is self-scoped, so it needs no permission.
    expect(items.map((i) => i.title)).toEqual(['Dashboard', 'Approvals']);
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
      'Approvals',
    ]);
    expect(visibleMenu(WORKSPACES, can).map((w) => w.layout)).toEqual(['institution', 'employee']);
  });

  it('hides modules that are not enabled for the organization', () => {
    const items: MenuItem[] = [
      { title: 'Dashboard', icon: 'x', to: '/' },
      { title: 'Payroll', icon: 'x', to: '/p', permission: 'payroll.view', feature: 'payroll' },
      { title: 'Students', icon: 'x', to: '/s', feature: 'education' },
    ];
    const features = new Set(['education']);
    const visible = visibleMenu(
      items,
      () => true,
      (f) => !f || features.has(f),
    );
    expect(visible.map((i) => i.title)).toEqual(['Dashboard', 'Students']);
  });
});

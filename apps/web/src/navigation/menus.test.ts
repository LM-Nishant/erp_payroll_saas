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

  it('shows the HR workspace only with employee.view and the hr module', () => {
    const perms = new Set(['employee.view', 'designation.view']);
    const can = (p?: string) => !p || perms.has(p);
    const withHr = (f?: string) => !f || f === 'hr';
    expect(visibleMenu(WORKSPACES, can, withHr).map((w) => w.layout)).toContain('hr');
    expect(visibleMenu(WORKSPACES, can, (f) => !f).map((w) => w.layout)).not.toContain('hr');
    expect(visibleMenu(MENUS.hr, can, withHr).map((i) => i.title)).toEqual([
      'Dashboard',
      'Employees',
      'Employee types',
      'Designations',
      'Approvals',
    ]);
  });

  it('relabels and hides education-only items for company organizations', () => {
    const can = () => true;
    const all = () => true;
    const titles = (kind?: 'EDUCATION' | 'COMPANY') =>
      visibleMenu(WORKSPACES, can, all, kind).map((w) => w.title);
    expect(titles('COMPANY')).toEqual(expect.arrayContaining(['Head office', 'Company']));
    expect(titles('EDUCATION')).not.toContain('Head office');
  });

  it('shows time-office pages by their own permissions', () => {
    const perms = new Set(['employee.view', 'attendance.view', 'holiday.view']);
    const can = (p?: string) => !p || perms.has(p);
    const withHr = (f?: string) => !f || f === 'hr';
    expect(visibleMenu(MENUS.hr, can, withHr).map((i) => i.title)).toEqual([
      'Dashboard',
      'Employees',
      'Attendance',
      'Holiday calendars',
      'Approvals',
    ]);
    const self = new Set(['attendance.view_own', 'leave.view_own']);
    expect(
      visibleMenu(MENUS.employee, (p) => !p || self.has(p), withHr).map((i) => i.title),
    ).toEqual(['Home', 'My attendance', 'My leave', 'Approvals']);
  });
});

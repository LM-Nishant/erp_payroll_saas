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

  it('shows transport and hostel pages by permission and licensed module', () => {
    const perms = new Set(['institution.view', 'transport.view', 'hostel.view']);
    const can = (p?: string) => !p || perms.has(p);
    const onlyTransport = (f?: string) => !f || f === 'transport';
    const titles = visibleMenu(MENUS.institution, can, onlyTransport).map((i) => i.title);
    expect(titles).toContain('Transport');
    expect(titles).not.toContain('Hostel');
    const own = new Set(['transport.view_own', 'hostel.view_own']);
    expect(
      visibleMenu(
        MENUS.portal,
        (p) => !p || own.has(p),
        () => true,
      ).map((i) => i.title),
    ).toEqual(['My transport', 'My hostel']);
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

  it('shows education-only items for company organizations that license education', () => {
    const can = () => true;
    const items: MenuItem[] = [
      { title: 'Employees', icon: 'x', to: '/e' },
      { title: 'Students', icon: 'x', to: '/s', feature: 'education', educationOnly: true },
    ];
    const titles = (features: string[]) =>
      visibleMenu(items, can, (f) => !f || features.includes(f), 'COMPANY').map((i) => i.title);
    expect(titles(['hr'])).toEqual(['Employees']);
    expect(titles(['hr', 'education'])).toEqual(['Employees', 'Students']);
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

describe('fees & finance menus', () => {
  it('adds fees + finance items gated by the finance feature', () => {
    const can = (p?: string) => !p || p === 'fee.view' || p === 'finance.view';
    const finance = (f?: string) => !f || f === 'finance';
    const titles = visibleMenu(MENUS.institution, can, finance).map((i) => i.title);
    expect(titles).toEqual(expect.arrayContaining(['Fee structures', 'Trial balance']));
    expect(titles).not.toContain('Collect fee');
    expect(visibleMenu(MENUS.institution, can, (f) => !f).map((i) => i.title)).not.toContain(
      'Fee heads',
    );
    expect(MENUS.portal.some((i) => i.to === '/portal/fees')).toBe(true);
  });
});

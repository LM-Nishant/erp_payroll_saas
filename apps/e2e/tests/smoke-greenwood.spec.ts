import { expect, test } from '@playwright/test';
import { BLOCKED_PATHS } from '../src/app';
import { signedIn } from '../src/session';
import { expectClean, expectRows } from '../src/ui';

/**
 * Greenwood (enterprise, every module) smoke: each module's main list page renders seeded rows
 * for the group owner without errors.
 */
const PAGES: Array<{ module: string; path: string; tab?: string }> = [
  { module: 'students', path: '/institution/students' },
  { module: 'admissions', path: '/institution/admissions' },
  { module: 'classes', path: '/institution/classes' },
  { module: 'subjects', path: '/institution/subjects' },
  { module: 'exams', path: '/institution/exams' },
  { module: 'employees', path: '/hr/employees' },
  { module: 'departments', path: '/hr/departments' },
  { module: 'attendance', path: '/hr/attendance' },
  { module: 'leave', path: '/hr/leave' },
  { module: 'payroll runs', path: '/hr/payroll/runs' },
  { module: 'salary components', path: '/hr/payroll/components' },
  { module: 'payslips', path: '/hr/payroll/payslips' },
  { module: 'fee invoices', path: '/institution/fees/invoices' },
  { module: 'fee heads', path: '/institution/fees/heads' },
  { module: 'finance accounts', path: '/institution/finance/accounts' },
  { module: 'library catalogue', path: '/institution/library/catalogue' },
  { module: 'transport', path: '/institution/transport', tab: 'Vehicles' },
  { module: 'hostel', path: '/institution/hostel', tab: 'Hostels / rooms' },
  { module: 'assets', path: '/assets/register' },
  { module: 'documents', path: '/institution/documents' },
  { module: 'communication', path: '/institution/communication', tab: 'Templates' },
  { module: 'users', path: '/institution/users' },
];

test.describe('Greenwood smoke · owner@greenwood.demo', () => {
  test.describe.configure({ mode: 'serial' });
  const session = signedIn('owner@greenwood.demo');

  for (const p of PAGES) {
    test(`${p.module} list shows seeded rows`, async () => {
      const s = session();
      const mark = s.mark();
      await s.go(p.path);
      expect(BLOCKED_PATHS).not.toContain(s.pathname());
      if (p.tab) {
        await s.page.getByRole('tab', { name: p.tab, exact: true }).click();
        await s.settle();
      }
      await expectRows(s.page);
      await expectClean(s, mark, p.module);
    });
  }
});

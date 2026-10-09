import { expect, test } from '@playwright/test';
import { BLOCKED_PATHS } from '../src/app';
import { signedIn } from '../src/session';

/**
 * Role-based access through the UI: for each role, its key pages open cleanly and a page outside
 * its permissions is denied by the router guard (redirect to /forbidden or the home page).
 */
interface RoleCase {
  email: string;
  allowed: string[];
  denied: string[];
  /** Text that must be visible on the first allowed page. */
  shows?: RegExp;
  /** Typed into the page's Search box before checking `shows` (lists grow across runs). */
  search?: string;
}

const CASES: RoleCase[] = [
  {
    email: 'teacher@greenwood.demo',
    allowed: [
      '/institution/student-attendance',
      '/institution/marks-entry',
      '/institution/my-classes',
    ],
    denied: ['/hr/payroll/runs', '/hr/employees', '/institution/finance/accounts'],
  },
  {
    email: 'student@greenwood.demo',
    allowed: ['/portal/profile', '/portal/timetable', '/portal/results', '/portal/fees'],
    denied: ['/institution/students', '/hr/employees', '/institution/fees/invoices'],
  },
  {
    email: 'parent@greenwood.demo',
    allowed: ['/portal/wards', '/portal/fees', '/portal/attendance'],
    denied: ['/institution/students', '/hr/payroll/runs', '/institution/exams'],
  },
  {
    email: 'employee@greenwood.demo',
    allowed: ['/employee/salary', '/employee/payslips', '/employee/leave', '/employee/attendance'],
    denied: ['/hr/payroll/runs', '/institution/students', '/hr/employees'],
  },
  {
    email: 'librarian@greenwood.demo',
    allowed: [
      '/institution/library',
      '/institution/library/catalogue',
      '/institution/library/desk',
    ],
    denied: ['/hr/payroll/runs', '/institution/fees/invoices'],
  },
  {
    email: 'payroll@greenwood.demo',
    allowed: ['/hr/payroll/runs', '/hr/payroll/components', '/hr/payroll/salary'],
    denied: ['/institution/students', '/institution/library'],
  },
  {
    email: 'finance@greenwood.demo',
    allowed: ['/institution/finance/accounts', '/institution/fees/invoices', '/hr/payroll/runs'],
    denied: ['/institution/library/desk', '/institution/exams'],
  },
  {
    email: 'transport@greenwood.demo',
    allowed: ['/institution/transport'],
    denied: ['/hr/payroll/runs', '/institution/exams'],
  },
  {
    email: 'warden@greenwood.demo',
    allowed: ['/institution/hostel'],
    denied: ['/hr/payroll/runs', '/institution/fees/invoices'],
  },
  {
    email: 'assets@greenwood.demo',
    allowed: ['/assets/register', '/assets/categories', '/assets/assignments'],
    denied: ['/hr/payroll/runs', '/institution/students'],
  },
  {
    email: 'hr@greenwood.demo',
    allowed: ['/hr/employees', '/hr/leave', '/hr/attendance'],
    denied: ['/institution/fees/invoices', '/institution/library/desk'],
  },
  {
    email: 'principal@greenwood.demo',
    allowed: ['/institution/students', '/institution/exams', '/institution/timetable'],
    denied: ['/hr/payroll/runs', '/hr/payroll/salary'],
  },
  {
    email: 'superadmin@erp.local',
    allowed: ['/platform/organizations'],
    denied: ['/institution/students', '/hr/employees'],
    shows: /Greenwood/,
    search: 'Greenwood',
  },
];

for (const c of CASES) {
  test.describe(`role · ${c.email}`, () => {
    test.describe.configure({ mode: 'serial' });
    const session = signedIn(c.email);

    test(`opens ${c.allowed.length} permitted pages`, async () => {
      const s = session();
      const problems: string[] = [];
      for (const p of c.allowed) {
        const mark = s.mark();
        await s.go(p);
        if (BLOCKED_PATHS.includes(s.pathname()))
          problems.push(`${p} redirected to ${s.pathname()}`);
        const failed = await s.failedSince(
          mark,
          // Optional lookups / self-vs-ward probes the page absorbs quietly.
          (x) =>
            (x.status === 403 && (x.code === 'PERMISSION_DENIED' || x.code === 'SCOPE_DENIED')) ||
            (x.status === 404 && x.code === 'NOT_FOUND'),
        );
        for (const f of failed)
          problems.push(`${p}: ${f.status} ${f.method} ${f.path} ${f.code ?? ''}`);
        for (const a of await s.errorAlerts()) problems.push(`${p}: alert ${a}`);
      }
      expect(problems).toEqual([]);
      if (c.shows) {
        await s.go(c.allowed[0]!);
        if (c.search) {
          await s.page.getByLabel('Search').fill(c.search);
          await s.settle();
        }
        await expect(s.page.getByText(c.shows).first()).toBeVisible();
      }
    });

    test(`is denied ${c.denied.length} pages outside the role`, async () => {
      const s = session();
      for (const p of c.denied) {
        await s.go(p);
        expect(BLOCKED_PATHS, `${c.email} must not open ${p}`).toContain(s.pathname());
      }
    });
  });
}

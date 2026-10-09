import { expect, test } from '@playwright/test';
import { BLOCKED_PATHS } from '../src/app';
import { signedIn } from '../src/session';
import { dialog, fill, pick, uniq } from '../src/ui';

/**
 * Licence enforcement through the UI: unlicensed modules are hidden from menus AND blocked when a
 * route is opened directly; institution-level overrides are enforced by the API and surfaced.
 * (users.spec.ts checks every unlicensed page for every user; these are the named scenarios.)
 */
const expectBlocked = async (s: ReturnType<ReturnType<typeof signedIn>>, path: string) => {
  await s.go(path);
  expect(BLOCKED_PATHS, `${path} must be blocked`).toContain(s.pathname());
};

test.describe('Sunrise (starter: education/documents/communication) · teacher', () => {
  test.describe.configure({ mode: 'serial' });
  const session = signedIn('teacher@sunrise.demo');

  test('has no HR / payroll / finance / transport in any menu', async () => {
    const s = session();
    await s.go('/institution');
    const titles = (await s.drawerItems()).map((i) => i.title);
    for (const t of ['Payroll runs', 'Employees', 'Accounts', 'Transport', 'Hostel', 'Library']) {
      expect(titles).not.toContain(t);
    }
  });

  test('payroll runs URL is blocked', async () => {
    await expectBlocked(session(), '/hr/payroll/runs');
  });

  test('transport and finance URLs are blocked', async () => {
    await expectBlocked(session(), '/institution/transport');
    await expectBlocked(session(), '/institution/finance/accounts');
  });
});

test.describe('Sunrise · owner sees the module-disabled page', () => {
  test.describe.configure({ mode: 'serial' });
  const session = signedIn('owner@sunrise.demo');

  test('opening an unlicensed module explains it is not enabled', async () => {
    const s = session();
    await s.go('/institution/library');
    expect(BLOCKED_PATHS).toContain(s.pathname());
    if (s.pathname() === '/module-disabled') {
      await expect(
        s.page.getByText('This module is not enabled for your organization'),
      ).toBeVisible();
    }
  });
});

test.describe('Acme (company: hr/payroll/documents) · HR manager', () => {
  test.describe.configure({ mode: 'serial' });
  const session = signedIn('hr@acme.demo');

  test('has no Students / Academics / Communication menus', async () => {
    const s = session();
    await s.go('/hr');
    const titles = (await s.drawerItems()).map((i) => i.title);
    for (const t of ['Students', 'Classes & sections', 'Exams', 'Communication', 'Fee invoices']) {
      expect(titles).not.toContain(t);
    }
    expect(titles).toContain('Employees');
  });

  test('students and exams URLs are blocked', async () => {
    await expectBlocked(session(), '/institution/students');
    await expectBlocked(session(), '/institution/exams');
  });

  test('communication is disabled even though the plan includes it', async () => {
    await expectBlocked(session(), '/institution/communication');
  });
});

test.describe('Brightway (professional, AI off) · owner', () => {
  test.describe.configure({ mode: 'serial' });
  const session = signedIn('owner@brightway.demo');

  test('has no AI menus and AI URLs are blocked', async () => {
    const s = session();
    await s.go('/group');
    const titles = (await s.drawerItems()).map((i) => i.title);
    expect(titles.filter((t) => t.startsWith('AI'))).toEqual([]);
    await expectBlocked(s, '/group/ai');
  });

  test('WhatsApp add-on modules stay available (communication page loads)', async () => {
    const s = session();
    const mark = s.mark();
    await s.go('/group/communication');
    expect(BLOCKED_PATHS).not.toContain(s.pathname());
    expect(
      await s.failedSince(mark, (c) => c.status === 403 && c.code !== 'FEATURE_DISABLED'),
    ).toEqual([]);
  });
});

test.describe('Brightway South (hostel switched off at the institution) · hostel manager', () => {
  test.describe.configure({ mode: 'serial' });
  const session = signedIn('south.hostel@brightway.demo');

  test('creating a hostel is refused by the API and the reason is shown', async () => {
    const s = session();
    await s.go('/institution/hostel');
    await s.page.getByRole('tab', { name: 'Hostels / rooms' }).click();
    await s.settle();
    await s.page.getByRole('button', { name: 'New hostel' }).click();
    const d = dialog(s.page);
    await pick(d, 'Institution', 'Brightway South School');
    await fill(d, 'Code *', uniq('H').slice(0, 12));
    await fill(d, 'Name *', 'Blocked hostel');
    const mark = s.mark();
    await d.getByRole('button', { name: 'Save' }).click();
    await s.settle();
    const failed = await s.failedSince(mark);
    expect(failed.map((c) => `${c.status} ${c.code}`)).toContain('403 FEATURE_DISABLED');
    await expect(d.locator('.v-alert.bg-error, .v-alert.text-error')).toBeVisible();
  });
});

test.describe('Oldtown (CANCELLED subscription) · owner', () => {
  test.describe.configure({ mode: 'serial' });
  const session = signedIn('owner@oldtown.demo');

  test('every licensed module is blocked', async () => {
    const s = session();
    for (const p of ['/institution/students', '/hr/employees', '/institution/library', '/assets']) {
      await expectBlocked(s, p);
    }
  });

  test('menus offer only administration', async () => {
    const s = session();
    await s.go('/institution');
    const titles = (await s.drawerItems()).map((i) => i.title);
    for (const t of ['Students', 'Employees', 'Fee invoices', 'Library', 'Hostel']) {
      expect(titles).not.toContain(t);
    }
  });
});

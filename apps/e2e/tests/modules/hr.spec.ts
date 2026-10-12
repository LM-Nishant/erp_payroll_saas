import { expect, test, type Locator } from '@playwright/test';
import { signedIn } from '../../src/session';
import {
  dialog,
  expectClean,
  expectDownload,
  expectRow,
  fill,
  isoDate,
  pick,
  saveDialog,
  uniq,
} from '../../src/ui';
import type { AppSession } from '../../src/app';

async function deactivate(s: AppSession, row: Locator) {
  await row.getByRole('button').last().click();
  const d = dialog(s.page);
  await d.getByLabel('Active', { exact: true }).click();
  await saveDialog(s);
}

/** HR master data and employee records, driven by the institution HR manager. */
test.describe('HR · hr@greenwood.demo', () => {
  test.describe.configure({ mode: 'serial' });
  const session = signedIn('hr@greenwood.demo');

  test('creates a designation', async () => {
    const s = session();
    await s.go('/hr/designations');
    const mark = s.mark();
    const code = uniq('DS').replace(/-/g, '').slice(0, 10);
    await s.page.getByRole('button', { name: 'New designation' }).click();
    const d = dialog(s.page);
    await fill(d, 'Code *', code);
    await fill(d, 'Name *', `E2E Designation ${code}`);
    await pick(d, 'Institution (empty = organization-wide)', 'Greenwood International School');
    await saveDialog(s);
    await expectRow(s.page, code);
    await expectClean(s, mark, 'designation create');
  });

  test('creates a shift', async () => {
    const s = session();
    await s.go('/hr/shifts');
    const mark = s.mark();
    const code = uniq('S').replace(/-/g, '').slice(0, 10);
    await s.page.getByRole('button', { name: 'New shift' }).click();
    const d = dialog(s.page);
    await fill(d, 'Code *', code);
    await fill(d, 'Name *', `E2E Shift ${code}`);
    await fill(d, 'Start', '09:00');
    await fill(d, 'End', '17:00');
    await saveDialog(s);
    await expect(s.page.getByText(`E2E Shift ${code}`).first()).toBeVisible();
    await expectClean(s, mark, 'shift create');
  });

  test('creates a holiday calendar and adds a holiday', async () => {
    const s = session();
    await s.go('/hr/holidays');
    const mark = s.mark();
    const name = `E2E Calendar ${uniq('H')}`;
    // One calendar per level and year: walk future years until a free one is found.
    let year = 2030 + Math.floor(Math.random() * 60);
    for (let attempt = 0; ; attempt++) {
      await fill(s.page, 'Year', String(year));
      await s.settle();
      await s.page.getByRole('button', { name: /New calendar/ }).click();
      const d = dialog(s.page);
      await pick(d, 'Scope *', /Institution|School/);
      await pick(d, 'Institution *', 'Greenwood International School');
      await fill(d, 'Name *', name);
      const err = await saveDialog(s).then(
        () => null,
        (e: Error) => e,
      );
      if (!err) break;
      if (!/already exists/.test(err.message) || attempt > 8) throw err;
      await d.getByRole('button', { name: 'Cancel' }).click();
      await s.page
        .locator('.v-alert .v-alert__close button, .v-alert button[aria-label=Close]')
        .first()
        .click();
      year = year >= 2099 ? 2030 : year + 1;
    }
    const row = s.page.locator('tbody tr').filter({ hasText: name });
    await expect(row).toBeVisible();
    await row.locator('button:has(.mdi-calendar-star)').click();
    await s.settle();
    const detail = dialog(s.page);
    await fill(detail, 'Date', `${year}-08-15`);
    await fill(detail, 'Name', 'E2E Founders Day');
    await detail.getByRole('button', { name: /add/i }).click();
    await s.settle();
    await expect(detail.getByText('E2E Founders Day')).toBeVisible();
    // The year loop above skips calendars left by earlier runs (409 CONFLICT).
    await expectClean(s, mark, 'holiday calendar', ['CONFLICT']);
  });

  test('creates an institution leave policy', async () => {
    const s = session();
    await s.go('/hr/leave-setup');
    const mark = s.mark();
    const name = `E2E Policy ${uniq('P')}`;
    const policyRows = s.page.locator('tbody tr').filter({ hasText: 'E2E Policy' });
    const activeRows = policyRows.filter({ has: s.page.locator('td', { hasText: /^Active$/ }) });
    // Only one active policy per scope: retire leftovers of interrupted runs first.
    while (await activeRows.count()) await deactivate(s, activeRows.first());
    await s.page.getByRole('button', { name: 'New policy' }).click();
    const d = dialog(s.page);
    await fill(d, 'Name *', name);
    await pick(d, 'Applies to *', /^(?!Organization)(?!Group)/);
    await pick(d, /^(Institution|School|Company|College) \*$/, 'Greenwood International School');
    await d.getByRole('button', { name: /Add leave type/ }).click();
    await saveDialog(s);
    const created = policyRows.filter({ hasText: name });
    await expect(created).toBeVisible();
    // Deactivate it again so the seeded Greenwood leave rules stay in force (and re-runs pass).
    await deactivate(s, created);
    await expect(created).toContainText('Inactive');
    await expectClean(s, mark, 'leave policy create');
  });

  test('creates an employee and finds it by search', async () => {
    const s = session();
    await s.go('/hr/employees');
    const mark = s.mark();
    const last = uniq('Emp');
    await s.page.getByRole('button', { name: 'New employee' }).click();
    const d = dialog(s.page);
    await fill(d, 'First name *', 'Eeto');
    await fill(d, 'Last name', last);
    await pick(d, 'Institution *', 'Greenwood International School');
    await fill(d, 'Date of joining', isoDate(0));
    await saveDialog(s);
    await s.go('/hr/employees');
    await fill(s.page, 'Search name / code', last);
    await s.page.keyboard.press('Enter');
    await s.settle();
    await expectRow(s.page, last);
    await expectClean(s, mark, 'employee create');
  });

  test('exports the employee list as CSV', async () => {
    const s = session();
    await s.go('/hr/employees');
    await expectDownload(
      s.page,
      () => s.page.getByRole('button', { name: 'Export CSV' }).click(),
      /\.csv$/i,
    );
  });
});

/** Departments are institution structure, owned by the institution admin (HR only views them). */
test.describe('HR departments · admin@greenwood.demo', () => {
  test.describe.configure({ mode: 'serial' });
  const session = signedIn('admin@greenwood.demo');

  test('creates a department', async () => {
    const s = session();
    await s.go('/institution/departments');
    const mark = s.mark();
    const code = uniq('D').replace(/-/g, '').slice(0, 10);
    await s.page.getByRole('button', { name: 'New department' }).click();
    const d = dialog(s.page);
    await fill(d, 'Code * (e.g. IT)', code);
    await fill(d, 'Name * (e.g. Information Technology)', `E2E Dept ${code}`);
    await saveDialog(s);
    await expectRow(s.page, `E2E Dept ${code}`);
    await expectClean(s, mark, 'department create');
  });
});

/** Employee types are organization-wide masters, managed at organization scope. */
test.describe('HR employee types · owner@greenwood.demo', () => {
  test.describe.configure({ mode: 'serial' });
  const session = signedIn('owner@greenwood.demo');

  test('creates an employee type', async () => {
    const s = session();
    await s.go('/hr/employee-types');
    const mark = s.mark();
    const code = uniq('T').replace(/-/g, '').slice(0, 10);
    await s.page.getByRole('button', { name: 'New employee type' }).click();
    const d = dialog(s.page);
    await fill(d, 'Code * (e.g. PERM)', code);
    await fill(d, 'Name * (e.g. Permanent)', `E2E Type ${code}`);
    await pick(d, 'Category *');
    await saveDialog(s);
    await expectRow(s.page, code);
    await expectClean(s, mark, 'employee type create');
  });

  test('creates a leave type', async () => {
    const s = session();
    await s.go('/hr/leave-setup');
    const mark = s.mark();
    const code = uniq('L').replace(/-/g, '').slice(0, 10);
    await s.page.getByRole('button', { name: 'New leave type' }).click();
    const d = dialog(s.page);
    await fill(d, 'Code *', code);
    await fill(d, 'Name *', `E2E Leave ${code}`);
    await saveDialog(s);
    await expectRow(s.page, code);
    await expectClean(s, mark, 'leave type create');
  });
});

import { expect, test } from '@playwright/test';
import { signedIn } from '../../src/session';
import {
  dialog,
  expectClean,
  expectDownload,
  expectRow,
  expectSignedPdf,
  fill,
  isoDate,
  pick,
  saveDialog,
  uniq,
} from '../../src/ui';

/**
 * Payroll end to end with maker-checker:
 *  - hr creates a new employee and locks the payroll month's attendance;
 *  - payroll manager adds a component and a structure, assigns the employee a salary with PF
 *    opted out, requests a revision with a reason, creates this month's run, computes & submits;
 *  - finance manager approves and finalizes (a maker can never approve their own run);
 *  - payroll manager downloads a payslip and the register, generates & publishes a Form 16;
 *  - group finance reopens the finalized run (audited) and payroll cancels the new revision so
 *    the flow is repeatable on the seeded database; group admin unlocks the attendance month.
 */
test.describe.configure({ mode: 'serial' });
const id = uniq('P').replace(/-/g, '').slice(0, 10);
const last = `Payee${id}`;
const component = `E2E${id}`.slice(0, 12).toUpperCase();
const structure = `S${id}`.toUpperCase();
let runUrl = '';
// Two months back: a closed past period, so the flow never touches the live month and the
// seeded finalized run (last month) stays untouched.
const period = (() => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 2);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
})();
const periodStart = `${period}-01`;

test.describe('Payroll · hr@greenwood.demo', () => {
  const session = signedIn('hr@greenwood.demo');
  test('hr onboards the employee to be paid', async () => {
    const s = session();
    await s.go('/hr/employees');
    const mark = s.mark();
    await s.page.getByRole('button', { name: 'New employee' }).click();
    const d = dialog(s.page);
    await fill(d, 'First name *', 'Eeto');
    await fill(d, 'Last name', last);
    await pick(d, 'Institution *', 'Greenwood International School');
    await fill(d, 'Date of joining', periodStart);
    await saveDialog(s);
    // Creating opens the employee; new employees start as DRAFT and only ACTIVE ones are paid.
    await s.page.waitForURL(/\/hr\/employees\/[0-9a-f-]{36}/);
    await s.settle();
    await s.page.getByRole('button', { name: 'Lifecycle' }).click();
    await s.page
      .locator('.v-list-item')
      .filter({ hasText: /^Activate$/ })
      .click();
    const l = dialog(s.page);
    await fill(l, 'Date of joining', periodStart);
    await l.getByRole('button', { name: 'Confirm' }).click();
    await s.settle();
    await expect(s.page.getByText('Active', { exact: true }).first()).toBeVisible();
    await expectClean(s, mark, 'employee create + activate');
  });

  test('hr locks the payroll month attendance', async () => {
    const s = session();
    await s.go('/hr/attendance');
    const mark = s.mark();
    await pick(s.page, 'Institution', 'Greenwood International School');
    await s.page.getByLabel('Month', { exact: true }).fill(period);
    await s.page.getByLabel('Month', { exact: true }).press('Tab');
    await s.settle();
    await s.page.getByRole('tab', { name: 'Period locks' }).click();
    await s.settle();
    const row = s.page
      .locator('tbody tr')
      .filter({ hasText: periodStart })
      .filter({ has: s.page.getByText('Locked', { exact: true }) });
    if (!(await row.count())) {
      await s.page.getByRole('button', { name: `Lock ${period}` }).click();
      await s.settle();
    }
    await expect(row).toHaveCount(1);
    await expectClean(s, mark, 'attendance lock');
  });
});

test.describe('Payroll · payroll@greenwood.demo (maker)', () => {
  const session = signedIn('payroll@greenwood.demo');

  test('creates a fixed earning component', async () => {
    const s = session();
    await s.go('/hr/payroll/components');
    const mark = s.mark();
    await s.page.getByRole('button', { name: 'New component' }).click();
    const d = dialog(s.page);
    await fill(d, 'Code', component);
    await fill(d, 'Name', `E2E allowance ${id}`);
    await pick(d, 'Institution (empty = organization)', 'Greenwood International School');
    await pick(d, 'Calculation', 'Fixed');
    await fill(d, 'Monthly amount', '1500');
    await saveDialog(s);
    await expectRow(s.page, component);
    await expectClean(s, mark, 'component');
  });

  test('creates a salary structure', async () => {
    const s = session();
    await s.go('/hr/payroll/structures');
    const mark = s.mark();
    await s.page.getByRole('button', { name: 'New structure' }).click();
    const d = dialog(s.page);
    await pick(d, 'Institution', 'Greenwood International School');
    await fill(d, 'Code', structure);
    await fill(d, 'Name', `E2E structure ${id}`);
    await saveDialog(s);
    await expectRow(s.page, structure);
    await expectClean(s, mark, 'structure');
  });

  test('assigns a salary with PF opted out', async () => {
    const s = session();
    await s.go('/hr/payroll/salary');
    const mark = s.mark();
    await pick(s.page, 'Employee', last, last);
    await s.settle();
    await s.page.getByRole('button', { name: 'Assign' }).click();
    const d = dialog(s.page);
    await pick(d, 'Structure', 'Standard CTC');
    await fill(d, 'Effective from', periodStart);
    await fill(d, 'Annual CTC', '480000');
    await d.getByRole('checkbox', { name: 'PF_EE applies' }).uncheck();
    await expect(d.getByRole('checkbox', { name: 'PF_ER applies' })).not.toBeChecked();
    await saveDialog(s);
    const history = s.page.locator('.v-card').filter({ hasText: 'Salary history (immutable)' });
    await expect(history.locator('tbody tr').first()).toContainText('PF_EE');
    await expectClean(s, mark, 'salary assign');
  });

  test('downloads the salary history PDF', async () => {
    const s = session();
    await expectDownload(s.page, () =>
      s.page.getByRole('button', { name: 'Download PDF' }).click(),
    );
  });

  test('requests a salary revision with a reason', async () => {
    const s = session();
    const mark = s.mark();
    await s.page.getByRole('button', { name: 'Request revision' }).click();
    const d = dialog(s.page);
    await fill(d, 'Effective from', isoDate(0));
    await fill(d, 'Annual CTC', '540000');
    await fill(d, 'Reason *', `E2E annual appraisal ${id}`);
    await saveDialog(s);
    const revisions = s.page.locator('.v-card').filter({ hasText: 'Revisions' });
    await expect(
      revisions.locator('tbody tr').filter({ hasText: `E2E annual appraisal ${id}` }),
    ).toBeVisible();
    await expectClean(s, mark, 'revision');
  });

  test('creates, computes and submits the run', async () => {
    const s = session();
    await s.go('/hr/payroll/runs');
    const mark = s.mark();
    await s.page.getByRole('button', { name: 'New run' }).click();
    const d = dialog(s.page);
    await pick(d, 'Institution', 'Greenwood International School');
    await fill(d, 'Period start', periodStart);
    await fill(d, 'Label (optional)', `E2E run ${id}`);
    await d.getByRole('button', { name: 'Create' }).click();
    await s.settle();
    await expect(s.page).toHaveURL(/\/hr\/payroll\/runs\/[0-9a-f-]{36}$/);
    runUrl = new URL(s.page.url()).pathname;
    await s.page.getByRole('button', { name: 'Compute', exact: true }).click();
    await expect(s.page.getByText('Computed', { exact: true }).first()).toBeVisible({
      timeout: 60_000,
    });
    await s.page.getByRole('button', { name: 'Submit for approval' }).click();
    await s.settle();
    await expect(s.page.getByText(/^Pending approval$/i).first()).toBeVisible();
    await expectClean(s, mark, 'run submit');
  });
});

test.describe('Payroll · finance@greenwood.demo (checker)', () => {
  const session = signedIn('finance@greenwood.demo');
  test('approves and finalizes the run', async () => {
    const s = session();
    // The run is attached to the "Finance approval" workflow: the checker acts in the inbox.
    await s.go('/hr/approvals');
    const mark = s.mark();
    await s.page
      .locator('tbody tr')
      .filter({ hasText: `E2E run ${id}` })
      .first()
      .click();
    const d = dialog(s.page);
    await fill(d, 'Comment', 'Checked by E2E');
    await d.getByRole('button', { name: 'Approve', exact: true }).click();
    await s.settle();
    await expect(s.page.locator('tbody tr').filter({ hasText: `E2E run ${id}` })).toHaveCount(0);
    await s.go(runUrl);
    await expect(s.page.getByText('Approved', { exact: true }).first()).toBeVisible();
    await s.page.getByRole('button', { name: 'Finalize & lock' }).click();
    await s.settle();
    await expect(s.page.getByText('Locked', { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expectClean(s, mark, 'approve & finalize');
  });
});

test.describe('Payroll · payroll@greenwood.demo (payslips & Form 16)', () => {
  const session = signedIn('payroll@greenwood.demo');

  test('downloads a payslip of the finalized run', async () => {
    const s = session();
    await s.go(runUrl);
    const mark = s.mark();
    await s.page.getByRole('tab', { name: 'Payslips' }).click();
    const slip = s.page.locator('tbody tr').filter({ hasText: last }).filter({ hasText: ' · ' });
    await expect(slip).toBeVisible({ timeout: 60_000 });
    await expectSignedPdf(s.page, () => slip.getByRole('button').click());
    await expectClean(s, mark, 'payslip download');
  });

  test('generates and publishes a Form 16', async () => {
    const s = session();
    await s.go('/hr/payroll/payslips');
    const mark = s.mark();
    await s.page.getByRole('tab', { name: 'Form 16' }).click();
    await s.settle();
    await s.page.getByRole('button', { name: 'Add Form 16' }).click();
    const d = dialog(s.page);
    await pick(d, 'Employee', last, last);
    const year = 2030 + Math.floor(Math.random() * 60);
    const fy = `${year}-${String((year + 1) % 100).padStart(2, '0')}`;
    await fill(d, 'Financial year (YYYY-YY)', fy);
    await saveDialog(s, 'Generate placeholder');
    const row = s.page.locator('tbody tr').filter({ hasText: fy });
    await row.getByRole('button', { name: 'Publish' }).click();
    await s.settle();
    await expect(row).toContainText('Published');
    await expectSignedPdf(s.page, () => row.getByRole('button').last().click());
    await expectClean(s, mark, 'form 16');
  });
});

test.describe('Payroll · group.finance@greenwood.demo (reopen)', () => {
  const session = signedIn('group.finance@greenwood.demo');
  test('reopens the finalized run with a reason', async () => {
    const s = session();
    await s.go(runUrl);
    const mark = s.mark();
    await s.page.getByRole('button', { name: 'Reopen…' }).click();
    const d = dialog(s.page);
    await fill(d, 'Reason (required)', `E2E cleanup ${id}`);
    await d.getByRole('button', { name: 'Reopen' }).click();
    await s.settle();
    await expect(s.page).not.toHaveURL(new RegExp(`${runUrl}$`));
    runUrl = new URL(s.page.url()).pathname;
    await expect(s.page.getByText('Revision 2')).toBeVisible();
    await expectClean(s, mark, 'reopen');
  });
});

test.describe('Payroll · payroll@greenwood.demo (cleanup)', () => {
  const session = signedIn('payroll@greenwood.demo');
  test('cancels the new draft revision', async () => {
    const s = session();
    await s.go(runUrl);
    const mark = s.mark();
    await s.page.getByRole('button', { name: 'Cancel run' }).click();
    await s.settle();
    await expect(s.page.getByText('Cancelled', { exact: true }).first()).toBeVisible();
    await expectClean(s, mark, 'cancel');
  });
});

test.describe('Payroll · group.admin@greenwood.demo (unlock)', () => {
  const session = signedIn('group.admin@greenwood.demo');
  test('unlocks the attendance month with a reason', async () => {
    const s = session();
    await s.go('/hr/attendance');
    const mark = s.mark();
    await pick(s.page, 'Institution', 'Greenwood International School');
    await s.page.getByRole('tab', { name: 'Period locks' }).click();
    await s.settle();
    const row = s.page
      .locator('tbody tr')
      .filter({ hasText: periodStart })
      .filter({ has: s.page.getByText('Locked', { exact: true }) });
    await row.getByRole('button', { name: 'Unlock' }).click();
    const d = dialog(s.page);
    await fill(d, 'Reason *', `E2E cleanup ${id}`);
    await d.getByRole('button', { name: 'Unlock' }).click();
    await s.settle();
    await expect(row).toHaveCount(0);
    await expectClean(s, mark, 'unlock');
  });
});

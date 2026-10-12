import { expect, test, type Locator, type Page } from '@playwright/test';
import { BLOCKED_PATHS, type AppSession } from '../../src/app';
import { signedIn } from '../../src/session';
import { dialog, expectClean, expectRow, fill, pick, rows, uniq } from '../../src/ui';

/**
 * HR attendance (Greenwood), end to end through the UI:
 *  - employee@ cannot open HR › Attendance; requests two status regularizations from My attendance;
 *  - hr@ sees them in the Regularizations tab, approves one and rejects the other in Approvals,
 *    corrects a register day (present / absent) with a reason and restores it, saves an attendance
 *    policy toggle (restored afterwards) and locks a month it cannot unlock;
 *  - owner@ unlocks that month with a reason; employee@ sees the approved / rejected outcomes.
 * Approved / manual corrections are cleared again so the seeded register stays as it was.
 */

const INSTITUTION = 'Greenwood International School';
const EMPLOYEE_CODE = 'GWIS-MAIN-0021'; // employee@greenwood.demo
const id = uniq('ATT');

const monthOf = (offset: number) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const thisMonth = monthOf(0);
// payroll.spec locks two months back and the seed locks last month: use one far from both.
const lockMonth = monthOf(-5);

let lockedByHr = false;

const requests = {
  approve: { date: '', reason: `E2E reg approve ${id}` },
  reject: { date: '', reason: `E2E reg reject ${id}` },
};

async function openAttendance(s: AppSession, tab: string, month = thisMonth) {
  await s.go('/hr/attendance');
  await pick(s.page, 'Institution', INSTITUTION);
  await s.page.getByLabel('Month', { exact: true }).fill(month);
  await s.page.getByLabel('Month', { exact: true }).press('Tab');
  await s.settle();
  await s.page.getByRole('tab', { name: tab }).click();
  await s.settle();
}

/** Register row of the filtered employee for `date`. */
const registerRow = (page: Page, date: string) => rows(page).filter({ hasText: date }).first();
const statusChip = (row: Locator) => row.locator('td').nth(2).locator('.v-chip');
const overrideIcon = (row: Locator) => row.locator('.mdi-pencil-lock');

async function correct(s: AppSession, row: Locator, status: string | null, reason: string) {
  await row.locator('button:has(.mdi-pencil)').click();
  const d = dialog(s.page);
  await expect(d).toContainText('Correct ');
  if (status) {
    await pick(d, 'Status (empty = clear correction)', status);
  } else {
    const field = d.locator('.v-select').first();
    await field.hover();
    const clear = field.locator('.v-field__clearable .v-icon');
    if (await clear.count()) await clear.click({ force: true });
    await expect(field.locator('.v-select__selection')).toHaveCount(0);
  }
  await fill(d, 'Reason *', reason);
  await d.getByRole('button', { name: /^save$/i }).click();
  await s.settle();
  await expect(s.page.locator('.v-dialog.v-overlay--active')).toHaveCount(0);
}

// Later blocks depend on earlier ones (data and locks), so the whole file runs in order.
test.describe.configure({ mode: 'serial' });

test.describe('Attendance · employee@greenwood.demo (self-service)', () => {
  test.describe.configure({ mode: 'serial' });
  const session = signedIn('employee@greenwood.demo');

  test('cannot open HR attendance nor see its menu', async () => {
    const s = session();
    await s.go('/employee');
    const items = await s.drawerItems();
    expect(items.map((i) => i.to)).not.toContain('/hr/attendance');
    await s.go('/hr/attendance');
    expect(BLOCKED_PATHS).toContain(s.pathname());
    await expect(s.page.locator('button:has(.mdi-pencil)')).toHaveCount(0);
  });

  test('requests two status regularizations from My attendance', async () => {
    const s = session();
    await s.go('/employee/attendance');
    const mark = s.mark();
    const mine = s.page.locator('tbody tr');
    // Withdraw leftovers of interrupted runs so their days are free again.
    const stale = mine
      .filter({ hasText: 'E2E reg' })
      .filter({ has: s.page.getByRole('button', { name: /withdraw/i }) });
    while (await stale.count()) {
      await stale
        .first()
        .getByRole('button', { name: /withdraw/i })
        .click();
      await s.settle();
    }

    const cells = s.page
      .locator('.calendar .cell')
      .filter({ has: s.page.locator('button[title="Regularize"]') });
    const days = await cells.locator('strong').allInnerTexts();
    test.skip(days.length < 2, `fewer than two regularizable days in ${thisMonth}`);

    const pending = [requests.approve, requests.reject];
    for (const day of days.reverse()) {
      const req = pending[0];
      if (!req) break;
      const date = `${thisMonth}-${day.trim().padStart(2, '0')}`;
      // A day with someone else's pending request answers 409 — try the previous one.
      if (
        await mine
          .filter({ hasText: date })
          .filter({ hasText: /Pending/i })
          .count()
      )
        continue;
      await cells
        .filter({ has: s.page.locator('strong', { hasText: new RegExp(`^${day}$`) }) })
        .locator('button[title="Regularize"]')
        .click();
      const d = dialog(s.page);
      await expect(d).toContainText(`Regularize ${date}`);
      await d.getByRole('button', { name: /request status/i }).click();
      await pick(d, 'Status', 'On Duty');
      await fill(d, 'Reason *', 'ab');
      await expect(d.getByRole('button', { name: /^submit$/i })).toBeDisabled();
      await fill(d, 'Reason *', req.reason);
      await d.getByRole('button', { name: /^submit$/i }).click();
      await s.settle();
      await expect(s.page.getByText('Regularization submitted')).toBeVisible();
      req.date = date;
      pending.shift();
    }
    expect(pending, 'two regularization requests submitted').toHaveLength(0);
    for (const r of [requests.approve, requests.reject]) {
      await expect(mine.filter({ hasText: r.reason })).toContainText(/Pending Approval/i);
    }
    await expectClean(s, mark, 'regularization requests');
  });
});

test.describe('Attendance · hr@greenwood.demo', () => {
  test.describe.configure({ mode: 'serial' });
  const session = signedIn('hr@greenwood.demo');

  test('sees the pending regularizations in the Regularizations tab', async () => {
    test.skip(!requests.approve.date, 'no regularization requested');
    const s = session();
    const mark = s.mark();
    await openAttendance(s, 'Regularizations');
    for (const r of [requests.approve, requests.reject]) {
      const row = s.page.locator('tbody tr').filter({ hasText: r.reason });
      await expect(row).toContainText(EMPLOYEE_CODE);
      await expect(row).toContainText(r.date);
      await expect(row).toContainText('On Duty');
      await expect(row).toContainText(/Pending Approval/i);
    }
    await expectClean(s, mark, 'regularizations tab');
  });

  test('approves one regularization and rejects the other in Approvals', async () => {
    test.skip(!requests.approve.date, 'no regularization requested');
    const s = session();
    await s.go('/hr/approvals');
    const mark = s.mark();
    for (const [r, action] of [
      [requests.approve, 'Approve'],
      [requests.reject, 'Reject'],
    ] as const) {
      const title = `Attendance regularization ${r.date}`;
      await expectRow(s.page, title);
      await rows(s.page).filter({ hasText: title }).filter({ hasText: EMPLOYEE_CODE }).click();
      const d = dialog(s.page);
      await expect(d).toContainText(title);
      await fill(d, 'Comment', `E2E ${action.toLowerCase()} ${id}`);
      await d.getByRole('button', { name: new RegExp(`^${action}$`, 'i') }).click();
      await s.settle();
      await expect(d.getByRole('button', { name: /^approve$/i })).toHaveCount(0);
      await d.getByRole('button', { name: /^close$/i }).click();
      await s.settle();
    }
    await expectClean(s, mark, 'regularization approvals');
  });

  test('shows the outcomes and applies the approved status to the register', async () => {
    test.skip(!requests.approve.date, 'no regularization requested');
    const s = session();
    const mark = s.mark();
    await openAttendance(s, 'Regularizations');
    const tab = s.page.locator('tbody tr');
    await expect(tab.filter({ hasText: requests.approve.reason })).toContainText(/Approved/i);
    await expect(tab.filter({ hasText: requests.reject.reason })).toContainText(/Rejected/i);

    await s.page.getByRole('tab', { name: 'Register' }).click();
    await s.settle();
    await pick(s.page, 'Employee', EMPLOYEE_CODE, EMPLOYEE_CODE);
    await s.settle();
    const approved = registerRow(s.page, requests.approve.date);
    await expect(statusChip(approved)).toHaveText('On Duty');
    await expect(overrideIcon(approved)).toBeVisible();
    // Clear the correction again so the seeded register is unchanged.
    await correct(s, approved, null, `E2E restore ${id}`);
    await expect(overrideIcon(registerRow(s.page, requests.approve.date))).toHaveCount(0);
    await expectClean(s, mark, 'regularization outcome');
  });

  test('marks a register day absent / present with a reason and restores it', async () => {
    const s = session();
    const mark = s.mark();
    await openAttendance(s, 'Register');
    await pick(s.page, 'Employee', EMPLOYEE_CODE, EMPLOYEE_CODE);
    await s.settle();
    const candidates = rows(s.page)
      .filter({ has: s.page.locator('button:has(.mdi-pencil)') })
      .filter({ hasNot: s.page.locator('.mdi-pencil-lock, .mdi-lock') });
    test.skip(!(await candidates.count()), `no correctable day for ${EMPLOYEE_CODE}`);
    const row = candidates.last();
    const date = (await row.locator('td').first().innerText()).trim();
    const original = (await statusChip(row).innerText()).trim();
    const target = original === 'Absent' ? 'Present' : 'Absent';

    // Reason is mandatory (min 3 characters).
    await row.locator('button:has(.mdi-pencil)').click();
    const d = dialog(s.page);
    await expect(d).toContainText(`Correct ${date}`);
    await fill(d, 'Reason *', 'ab');
    await expect(d.getByRole('button', { name: /^save$/i })).toBeDisabled();
    await d.getByRole('button', { name: /^cancel$/i }).click();

    await correct(s, row, target, `E2E mark ${target.toLowerCase()} ${id}`);
    const corrected = registerRow(s.page, date);
    await expect(statusChip(corrected)).toHaveText(target);
    await expect(overrideIcon(corrected)).toBeVisible();

    await correct(s, corrected, null, `E2E restore ${id}`);
    const restored = registerRow(s.page, date);
    await expect(statusChip(restored)).toHaveText(original);
    await expect(overrideIcon(restored)).toHaveCount(0);
    await expectClean(s, mark, 'register correction');
  });

  test('saves an attendance policy toggle and restores it', async () => {
    const s = session();
    const mark = s.mark();
    await openAttendance(s, 'Policy');
    const box = s.page.getByLabel('Allow mobile punch', { exact: true });
    const original = await box.isChecked();
    const save = async (checked: boolean) => {
      await box.setChecked(checked);
      await s.page.getByRole('button', { name: /^save$/i }).click();
      await s.settle();
      await expect(s.page.getByText('Policy saved')).toBeVisible();
      // Re-open the tab: the value comes back from the server.
      await s.page.getByRole('tab', { name: 'Register' }).click();
      await s.settle();
      await s.page.getByRole('tab', { name: 'Policy' }).click();
      await s.settle();
      await expect(box).toBeChecked({ checked });
    };
    await save(!original);
    await save(original);
    await expect(
      s.page.getByLabel('Require selfie matched to profile photo for self punches'),
    ).toBeVisible();
    await expectClean(s, mark, 'attendance policy');
  });

  test(`locks ${lockMonth} but is not offered an unlock`, async () => {
    const s = session();
    const mark = s.mark();
    await openAttendance(s, 'Period locks', lockMonth);
    const locked = s.page
      .locator('tbody tr')
      .filter({ hasText: `${lockMonth}-01` })
      .filter({ has: s.page.getByText('Locked', { exact: true }) });
    if (!(await locked.count())) {
      await s.page.getByRole('button', { name: new RegExp(`lock ${lockMonth}`, 'i') }).click();
      await s.settle();
    }
    await expect(locked).toHaveCount(1);
    await expect(locked).toContainText(`Payroll ${lockMonth}`);
    // Time office may lock, but unlocking is reserved for owners / group admins.
    await expect(locked.getByRole('button', { name: /unlock/i })).toHaveCount(0);
    lockedByHr = true;
    await expectClean(s, mark, 'attendance lock');
  });
});

test.describe('Attendance · owner@greenwood.demo (unlock)', () => {
  test.describe.configure({ mode: 'serial' });
  const session = signedIn('owner@greenwood.demo');

  test(`unlocks ${lockMonth} with a reason`, async () => {
    test.skip(!lockedByHr, `${lockMonth} was not locked by hr@`);
    const s = session();
    const mark = s.mark();
    await openAttendance(s, 'Period locks', lockMonth);
    const locked = s.page
      .locator('tbody tr')
      .filter({ hasText: `${lockMonth}-01` })
      .filter({ has: s.page.getByText('Locked', { exact: true }) });
    await expect(locked).toHaveCount(1);
    await locked.getByRole('button', { name: /unlock/i }).click();
    const d = dialog(s.page);
    await fill(d, 'Reason *', 'no');
    await expect(d.getByRole('button', { name: /^unlock$/i })).toBeDisabled();
    const reason = `E2E unlock ${id}`;
    await fill(d, 'Reason *', reason);
    await d.getByRole('button', { name: /^unlock$/i }).click();
    await s.settle();
    await expect(locked).toHaveCount(0);
    await expect(s.page.locator('tbody tr').filter({ hasText: reason })).toContainText(/Unlocked/i);
    await expectClean(s, mark, 'attendance unlock');
  });
});

test.describe('Attendance · employee@greenwood.demo (outcomes)', () => {
  const session = signedIn('employee@greenwood.demo');

  test('sees the approved and rejected regularizations', async () => {
    test.skip(!requests.approve.date, 'no regularization requested');
    const s = session();
    await s.go('/employee/attendance');
    const mark = s.mark();
    const mine = s.page.locator('tbody tr');
    await expect(mine.filter({ hasText: requests.approve.reason })).toContainText(/Approved/i);
    await expect(mine.filter({ hasText: requests.reject.reason })).toContainText(/Rejected/i);
    await expect(
      mine.filter({ hasText: id }).getByRole('button', { name: /withdraw/i }),
    ).toHaveCount(0);
    await expectClean(s, mark, 'regularization outcomes');
  });
});

import { expect, test, type Page } from '@playwright/test';
import type { AppSession } from '../../src/app';
import { signedIn } from '../../src/session';
import { dialog, expectClean, expectRow, fill, pick, uniq } from '../../src/ui';

/**
 * Staff leave end to end: the employee applies twice, HR approves one and rejects the other on
 * the Leave page, the employee sees both outcomes and cancels the approved (future) leave so the
 * balance is restored and the flow stays repeatable.
 */
test.describe.configure({ mode: 'serial' });
const approveReason = `E2E approve ${uniq('L')}`;
const rejectReason = `E2E reject ${uniq('L')}`;

/** A random weekday 3–20 weeks ahead (unlikely to clash with earlier runs). */
function futureWeekday(): string {
  const d = new Date();
  d.setDate(d.getDate() + 21 + Math.floor(Math.random() * 120));
  while ([0, 6].includes(d.getDay())) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function applyLeave(s: AppSession, reason: string) {
  for (let attempt = 0; attempt < 6; attempt++) {
    await s.page.getByRole('button', { name: 'Apply leave' }).click();
    const d = dialog(s.page);
    // Loss of Pay has no balance, so repeated runs never exhaust an entitlement.
    await pick(d, 'Leave type *', /Loss of Pay/);
    const day = futureWeekday();
    await fill(d, 'From *', day);
    await fill(d, 'To *', day);
    await fill(d, 'Reason *', reason);
    await s.settle();
    const submit = d.getByRole('button', { name: 'Submit' });
    if (await submit.isEnabled()) {
      await submit.click();
      await s.settle();
      if (!(await s.page.locator('.v-dialog.v-overlay--active').count())) return day;
    }
    await d.getByRole('button', { name: 'Close' }).click();
    await s.settle();
  }
  throw new Error('could not find a free weekday to apply leave');
}

const requestRow = (page: Page, reason: string) =>
  page.locator('tbody tr').filter({ hasText: reason });

test.describe('Leave · employee applies', () => {
  const session = signedIn('employee@greenwood.demo');

  test('applies two loss-of-pay leaves', async () => {
    const s = session();
    await s.go('/employee/leave');
    const mark = s.mark();
    const a = await applyLeave(s, approveReason);
    const b = await applyLeave(s, rejectReason);
    await expect(s.page.getByText('Leave request submitted')).toBeVisible();
    for (const day of [a, b])
      await expect(s.page.locator('tbody tr').filter({ hasText: day }).first()).toContainText(
        /Pending/i,
      );
    // applyLeave retries on another day when the random one overlaps an earlier run's request.
    await expectClean(s, mark, 'apply leave', ['CONFLICT']);
  });
});

test.describe('Leave · HR decides', () => {
  const session = signedIn('hr@greenwood.demo');

  test('approves one request and rejects the other', async () => {
    const s = session();
    await s.go('/hr/leave');
    const mark = s.mark();
    await expect(requestRow(s.page, approveReason)).toBeVisible();
    await requestRow(s.page, approveReason).getByRole('button', { name: 'Approve' }).click();
    await s.settle();
    // The list defaults to "Pending approval": decided requests drop out of it.
    await expect(requestRow(s.page, approveReason)).toHaveCount(0);
    await requestRow(s.page, rejectReason).getByRole('button', { name: 'Reject' }).click();
    const d = dialog(s.page);
    await fill(d, 'Reason *', 'Exam week — please reschedule');
    await d.getByRole('button', { name: 'Reject' }).click();
    await s.settle();
    await expect(requestRow(s.page, rejectReason)).toHaveCount(0);
    await pick(s.page, 'Status', /^Approved$/);
    await s.settle();
    await expectRow(s.page, approveReason);
    await pick(s.page, 'Status', /^Rejected$/);
    await s.settle();
    await expectRow(s.page, rejectReason);
    await expectClean(s, mark, 'leave decisions');
  });

  test('approvals inbox opens a pending item', async () => {
    const s = session();
    await s.go('/hr/approvals');
    const mark = s.mark();
    await s.page.getByRole('tab', { name: /My requests/ }).click();
    await s.page.getByRole('tab', { name: /Pending my approval/ }).click();
    const first = s.page.locator('tbody tr').first();
    if (await first.locator('.v-chip').count()) {
      await first.click();
      await expect(dialog(s.page).getByText('Steps')).toBeVisible();
      await dialog(s.page).getByRole('button', { name: 'Close' }).click();
    }
    await expectClean(s, mark, 'approvals inbox');
  });
});

test.describe('Leave · employee sees outcomes', () => {
  const session = signedIn('employee@greenwood.demo');

  test('sees approved + rejected and cancels the approved leave', async () => {
    const s = session();
    await s.go('/employee/leave');
    const mark = s.mark();
    const rows = s.page.locator('tbody tr');
    await expect(rows.filter({ hasText: /Rejected/i }).first()).toBeVisible();
    const approved = rows.filter({ hasText: /Approved/i }).filter({
      has: s.page.getByRole('button', { name: 'Cancel' }),
    });
    const before = await approved.count();
    expect(before).toBeGreaterThan(0);
    await approved.first().getByRole('button', { name: 'Cancel' }).click();
    const d = dialog(s.page);
    await fill(d, 'Reason *', 'Plans changed (e2e)');
    await d.getByRole('button', { name: 'Confirm' }).click();
    await s.settle();
    await expect(approved).toHaveCount(before - 1);
    await expectClean(s, mark, 'cancel leave');
  });
});

test.describe('Leave · students', () => {
  test.fixme('student applies leave and the class teacher approves', async () => {}); // Product gap: there is no student leave model, API or page (only staff leave exists).
});

import { expect, test } from '@playwright/test';
import { signedIn } from '../../src/session';
import {
  dialog,
  expectClean,
  expectRow,
  expectRows,
  fill,
  pick,
  rows,
  saveDialog,
  uniq,
} from '../../src/ui';

/**
 * Fees beyond collection (isolated class so invoice generation touches one student only):
 * the finance manager grants a 20% concession that discounts the generated invoice, collects two
 * instalments, refunds part of one (an over-refund is rejected) and cancels the other, then
 * deactivates the concession. The accountant (no fee.concession / fee.refund) sees neither the
 * concession nor the refund/cancel controls. Defaulters link straight into collection.
 */
test.describe.configure({ mode: 'serial' });
const id = uniq('FD').replace(/-/g, '');
const cls = `E2E Conc ${id}`;
const pupil = `Concession${id}`;
const concession = `E2E Merit ${id}`;
const head = `E2E Tuition ${id}`;
const structure = `E2E Plan ${id}`;

test.describe('Fees depth · admin prepares a class', () => {
  const session = signedIn('admin@greenwood.demo');
  test('creates a one-section class with one student', async () => {
    const s = session();
    await s.go('/institution/classes');
    const mark = s.mark();
    await s.page.getByRole('button', { name: /Add classes & sections/ }).click();
    let d = dialog(s.page);
    await fill(d, 'Classes (one per line)', cls);
    await fill(d, 'Sections in every class', 'A');
    await saveDialog(s, 'Create');
    await s.go('/institution/students');
    await s.page.getByRole('button', { name: 'New student' }).click();
    d = dialog(s.page);
    await fill(d, 'First name', pupil);
    await fill(d, 'Last name', 'E2E');
    await pick(d, 'Class section', new RegExp(cls), cls);
    await saveDialog(s, 'Create');
    await expect(s.page.getByText(pupil).first()).toBeVisible();
    await expectClean(s, mark, 'class + student');
  });
});

test.describe('Fees depth · finance@greenwood.demo', () => {
  const session = signedIn('finance@greenwood.demo');

  test('grants a 20% student concession', async () => {
    const s = session();
    await s.go('/institution/fees/concessions');
    const mark = s.mark();
    await s.page.getByRole('button', { name: 'New concession' }).click();
    const d = dialog(s.page);
    await fill(d, 'Name', concession);
    await pick(d, 'Student', new RegExp(pupil), pupil);
    await fill(d, 'Value', '20');
    await fill(d, 'Reason', 'E2E merit');
    await saveDialog(s, 'Create');
    const row = rows(s.page).filter({ hasText: concession });
    await expect(row).toBeVisible();
    await expect(row).toContainText(pupil);
    await expect(row).toContainText('20%');
    await expect(row).toContainText('Yes');
    await expectClean(s, mark, 'concession');
  });

  test('the generated invoice is discounted by the concession', async () => {
    const s = session();
    await s.go('/institution/fees/heads');
    const mark = s.mark();
    await s.page.getByRole('button', { name: 'New fee head' }).click();
    let d = dialog(s.page);
    await pick(d, 'Institution', 'Greenwood International School');
    await fill(d, 'Code', id.slice(-10));
    await fill(d, 'Name', head);
    await saveDialog(s);
    await s.go('/institution/fees/structures');
    await s.page.getByRole('button', { name: 'New structure' }).click();
    d = dialog(s.page);
    await pick(d, 'Class section (blank = whole institution)', new RegExp(cls), cls);
    await fill(d, 'Code', id.slice(-10));
    await fill(d, 'Name', structure);
    await pick(d, 'Fee head', head);
    await fill(d, 'Amount', '5000');
    await saveDialog(s, 'Create');
    const row = rows(s.page).filter({ hasText: structure });
    s.page.once('dialog', (x) => void x.accept());
    await row.getByRole('button', { name: 'Generate invoices' }).click();
    await s.settle();
    await expect(s.page.getByText(/Generated 1 invoice\(s\) for 1 student/)).toBeVisible();
    await s.go('/institution/fees/invoices');
    await pick(s.page, 'Class section', new RegExp(cls), cls);
    await s.settle();
    const inv = rows(s.page).filter({ hasText: pupil });
    await expect(inv).toHaveCount(1);
    // 5,000 less 20% → 4,000 net.
    await expect(inv).toContainText('4,000');
    await expect(inv).not.toContainText('5,000');
    await expectClean(s, mark, 'discounted invoice');
  });

  test('collects two instalments', async () => {
    const s = session();
    await s.go('/institution/fees/collect');
    const mark = s.mark();
    await pick(s.page, 'Student', new RegExp(pupil), pupil);
    await s.settle();
    const inv = s.page.locator('tbody tr').filter({ hasText: structure });
    await expect(inv).toBeVisible();
    for (const n of [1, 2]) {
      await inv.locator('input[type=checkbox]').check();
      await fill(s.page, 'Amount', '1000');
      await fill(s.page, 'Reference (cheque / UTR / txn)', `E2E-${id}-${n}`);
      await s.page.getByRole('button', { name: /^Collect/ }).click();
      await s.settle();
      await expect(s.page.getByText(/Receipt .* recorded for/)).toBeVisible();
    }
    await expect(inv).toContainText('2,000');
    await expectClean(s, mark, 'instalments');
  });

  test('refunds part of a receipt and rejects an over-refund', async () => {
    const s = session();
    await s.go('/institution/fees/receipts');
    await pick(s.page, 'Student', new RegExp(pupil), pupil);
    await s.settle();
    await expectRows(s.page, 2);
    const mark = s.mark();
    const first = rows(s.page).filter({ hasText: `E2E-${id}-1` });
    await first.getByTitle('Refund').click();
    const d = dialog(s.page);
    await fill(d, 'Amount', '5000');
    await fill(d, 'Reason', 'E2E over-refund');
    await d.getByRole('button', { name: /^Refund$/i }).click();
    await s.settle();
    const overRefund = s.page.locator('.v-alert').filter({ hasText: /At most .* can be refunded/ });
    await expect(overRefund).toBeVisible();
    await fill(d, 'Amount', '400');
    await fill(d, 'Reason', 'E2E partial refund');
    await d.getByRole('button', { name: /^Refund$/i }).click();
    await s.settle();
    await expect(d).toBeHidden();
    // The successful refund reloads the list, which clears the earlier rejection message.
    await expect(overRefund).toBeHidden();
    await expect(first).toContainText('400');
    // A refunded receipt can be refunded further but no longer cancelled.
    await expect(first.getByTitle('Refund')).toBeVisible();
    await expect(first.getByTitle('Cancel receipt')).toHaveCount(0);
    await expectClean(s, mark, 'refund', ['VALIDATION_ERROR', 'BAD_REQUEST']);
  });

  test('cancels the other receipt with a reason', async () => {
    const s = session();
    await s.go('/institution/fees/receipts');
    await pick(s.page, 'Student', new RegExp(pupil), pupil);
    await s.settle();
    const mark = s.mark();
    s.page.once('dialog', (x) => void x.accept('E2E wrong student'));
    const second = rows(s.page).filter({ hasText: `E2E-${id}-2` });
    await second.getByTitle('Cancel receipt').click();
    await s.settle();
    await expect(second).toContainText('CANCELLED');
    await expect(second.getByTitle('Refund')).toHaveCount(0);
    await expect(second.getByTitle('Receipt PDF')).toBeVisible();
    await expectClean(s, mark, 'cancel receipt');
  });

  test('deactivates the concession', async () => {
    const s = session();
    await s.go('/institution/fees/concessions');
    const mark = s.mark();
    const row = rows(s.page).filter({ hasText: concession });
    await row.getByRole('button', { name: /^Deactivate$/i }).click();
    await s.settle();
    await expect(row).toContainText('No');
    await expect(row.getByRole('button', { name: /^Activate$/i })).toBeVisible();
    await expectClean(s, mark, 'deactivate');
  });

  test('a defaulter row opens collection for that student', async () => {
    const s = session();
    await s.go('/institution/fees/defaulters');
    const mark = s.mark();
    await expect(s.page.getByRole('heading', { name: 'Fee defaulters' })).toBeVisible();
    await pick(s.page, 'Institution', 'Greenwood International School');
    await pick(s.page, 'Class section', /^Grade 1 - A$/);
    await s.settle();
    const row = rows(s.page).filter({ hasText: 'GWIS-MAIN-2026-0001' });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: /^Collect$/i }).click();
    await expect(s.page).toHaveURL(/\/institution\/fees\/collect\?studentId=[0-9a-f-]{36}/);
    await s.settle();
    await expect(s.page.locator('.v-field').filter({ hasText: 'Student' })).toContainText(/Aarav/);
    await expectRows(s.page);
    await expectClean(s, mark, 'defaulters → collect');
  });
});

test.describe('Fees depth · accountant@greenwood.demo (no concession / refund rights)', () => {
  const session = signedIn('accountant@greenwood.demo');

  test('sees concessions read-only', async () => {
    const s = session();
    await s.go('/institution/fees/concessions');
    const mark = s.mark();
    await expectRow(s.page, concession);
    await expect(s.page.getByRole('button', { name: 'New concession' })).toHaveCount(0);
    await expect(s.page.getByRole('button', { name: /^(Activate|Deactivate)$/i })).toHaveCount(0);
    await expectClean(s, mark, 'concessions read-only');
  });

  test('receipts offer the PDF but no refund or cancel', async () => {
    const s = session();
    await s.go('/institution/fees/receipts');
    await pick(s.page, 'Student', new RegExp(pupil), pupil);
    await s.settle();
    const mark = s.mark();
    await expectRows(s.page, 2);
    await expect(rows(s.page).first().getByTitle('Receipt PDF')).toBeVisible();
    await expect(s.page.getByTitle('Refund')).toHaveCount(0);
    await expect(s.page.getByTitle('Cancel receipt')).toHaveCount(0);
    await expectClean(s, mark, 'receipts read-only');
  });
});

import { expect, test, type Locator } from '@playwright/test';
import { signedIn } from '../../src/session';
import {
  dialog,
  expectClean,
  expectDownload,
  expectRow,
  expectRows,
  fill,
  menu,
  pick,
  rows,
  saveDialog,
  uniq,
} from '../../src/ui';

/**
 * Finance (Greenwood): the org owner maintains the chart of accounts; the accountant posts and cancels a
 * manual journal voucher, adds a vendor, records and cancels an expense and exports the trial
 * balance; the finance manager reads an account ledger.
 */
test.describe.configure({ mode: 'serial' });
const id = uniq('FIN').replace(/-/g, '');
const account = `E2E Account ${id}`;
const vendor = `E2E Vendor ${id}`;

/** Picks option `option` in the `index`-th field labelled `label` (repeated voucher lines). */
async function pickNth(scope: Locator, label: string, index: number, option: string) {
  const input = scope.getByLabel(label, { exact: true }).nth(index);
  await input.locator('xpath=ancestor::div[contains(@class,"v-field")][1]').click();
  await menu(scope.page()).filter({ hasText: option }).first().click();
  await expect(scope.page().locator('.v-menu.v-overlay--active')).toHaveCount(0);
}

// The chart of accounts is organization-wide: only organization-scoped finance.manage maintains it.
test.describe('Finance · owner@greenwood.demo (chart of accounts)', () => {
  const session = signedIn('owner@greenwood.demo');

  test('creates a ledger account and toggles it', async () => {
    const s = session();
    await s.go('/institution/finance/accounts');
    const mark = s.mark();
    await expectRows(s.page, 10);
    await s.page.getByRole('button', { name: 'New account' }).click();
    const d = dialog(s.page);
    await fill(d, 'Code', id.slice(-12));
    await fill(d, 'Name', account);
    await pick(d, 'Type', 'EXPENSE');
    await saveDialog(s, 'Create');
    const row = rows(s.page).filter({ hasText: account });
    await expect(row).toContainText('Yes');
    await row.getByRole('button', { name: 'Deactivate' }).click();
    await s.settle();
    await expect(row).toContainText('No');
    await row.getByRole('button', { name: 'Activate' }).click();
    await s.settle();
    await expect(row).toContainText('Yes');
    await expectClean(s, mark, 'ledger account');
  });
});

test.describe('Finance · accountant@greenwood.demo', () => {
  const session = signedIn('accountant@greenwood.demo');

  test('posts a balanced journal voucher and cancels it', async () => {
    const s = session();
    s.page.once('dialog', (dlg) => void dlg.accept(`E2E reversal ${id}`));
    await s.go('/institution/finance/vouchers');
    const mark = s.mark();
    await s.page.getByRole('button', { name: 'New voucher' }).click();
    const d = dialog(s.page);
    await pick(d, 'Institution', 'Greenwood International School');
    await fill(d, 'Narration', `E2E JV ${id}`);
    await pickNth(d, 'Account', 0, '5900 General expenses');
    await d.getByLabel('Debit', { exact: true }).nth(0).fill('150');
    await pickNth(d, 'Account', 1, '1100 Cash in hand');
    await d.getByLabel('Credit', { exact: true }).nth(1).fill('150');
    await expect(d.getByText('(balanced)')).toBeVisible();
    await saveDialog(s);
    await expectRow(s.page, `E2E JV ${id}`);
    const row = rows(s.page)
      .filter({ hasText: `E2E JV ${id}` })
      .first();
    await expect(row).toContainText('POSTED');
    await row.click();
    const v = dialog(s.page);
    await expect(v.getByText('5900 General expenses')).toBeVisible();
    await v.getByRole('button', { name: 'Cancel voucher' }).click();
    await s.settle();
    await expect(row).toContainText('CANCELLED');
    await expectClean(s, mark, 'voucher');
  });

  test('adds a vendor, records an expense and cancels it', async () => {
    const s = session();
    s.page.once('dialog', (dlg) => void dlg.accept(`E2E wrong bill ${id}`));
    await s.go('/institution/finance/expenses');
    const mark = s.mark();
    await s.page.getByRole('tab', { name: 'Vendors' }).click();
    await s.page.getByRole('button', { name: 'New vendor' }).click();
    let d = dialog(s.page);
    await pick(d, 'Institution (blank = all)', 'Greenwood International School');
    await fill(d, 'Code', `V${id}`.slice(0, 30));
    await fill(d, 'Name', vendor);
    await fill(d, 'Phone', '9876500000');
    await saveDialog(s, 'Create');
    await expectRow(s.page, vendor);

    await s.page.getByRole('tab', { name: 'Expenses' }).click();
    await s.page.getByRole('button', { name: 'Record expense' }).click();
    d = dialog(s.page);
    await pick(d, 'Institution', 'Greenwood International School');
    await pick(d, 'Vendor (optional)', vendor);
    await pick(d, 'Expense head', '5600 Repairs');
    await fill(d, 'Amount', '275');
    await fill(d, 'Description', `E2E expense ${id}`);
    await saveDialog(s);
    await expectRow(s.page, `E2E expense ${id}`);
    const row = rows(s.page)
      .filter({ hasText: `E2E expense ${id}` })
      .first();
    await expect(row).toContainText(vendor);
    await row.getByRole('button', { name: 'Cancel' }).click();
    await s.settle();
    await expect(row).toContainText('CANCELLED');
    await expectClean(s, mark, 'vendor + expense');
  });

  test('exports the trial balance as PDF', async () => {
    const s = session();
    await s.go('/institution/finance/trial-balance');
    const mark = s.mark();
    await expectRows(s.page, 2);
    await expectDownload(s.page, () => s.page.getByRole('button', { name: 'PDF' }).click());
    await expectClean(s, mark, 'trial balance');
  });
});

test.describe('Finance · finance@greenwood.demo', () => {
  const session = signedIn('finance@greenwood.demo');

  test('reads the general-expenses ledger', async () => {
    const s = session();
    await s.go('/institution/finance/ledger');
    const mark = s.mark();
    await pick(s.page, 'Account', '5900 General expenses');
    await s.settle();
    await expectRows(s.page, 1);
    await expectClean(s, mark, 'ledger');
  });
});

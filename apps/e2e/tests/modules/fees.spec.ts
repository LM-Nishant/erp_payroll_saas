import { expect, test } from '@playwright/test';
import { signedIn } from '../../src/session';
import {
  dialog,
  expectClean,
  expectDownload,
  expectRow,
  fill,
  pick,
  saveDialog,
  uniq,
} from '../../src/ui';

/**
 * Fees end to end on an isolated class (so invoice generation touches one student only):
 * admin sets up class + student → accountant creates a fee head and structure, activates it,
 * generates invoices, collects a part payment and downloads the receipt; the portal student
 * sees their own fees.
 */
test.describe.configure({ mode: 'serial' });
const id = uniq('F').replace(/-/g, '');
const cls = `E2E Fees ${id}`;
const pupil = `Feepayer${id}`;
const head = `E2E Tuition ${id}`;
const structure = `E2E Plan ${id}`;

test.describe('Fees · admin prepares a class', () => {
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

test.describe('Fees · accountant', () => {
  const session = signedIn('accountant@greenwood.demo');

  test('creates a fee head', async () => {
    const s = session();
    await s.go('/institution/fees/heads');
    const mark = s.mark();
    await s.page.getByRole('button', { name: 'New fee head' }).click();
    const d = dialog(s.page);
    await pick(d, 'Institution', 'Greenwood International School');
    await fill(d, 'Code', id.slice(-10));
    await fill(d, 'Name', head);
    await saveDialog(s);
    await expect(s.page.getByText(head)).toBeVisible();
    await expectClean(s, mark, 'fee head');
  });

  test('creates a fee structure, toggles its status and generates invoices', async () => {
    const s = session();
    await s.go('/institution/fees/structures');
    const mark = s.mark();
    s.page.on('dialog', (x) => void x.accept());
    await s.page.getByRole('button', { name: 'New structure' }).click();
    const d = dialog(s.page);
    await pick(d, 'Class section (blank = whole institution)', new RegExp(cls), cls);
    await fill(d, 'Code', id.slice(-10));
    await fill(d, 'Name', structure);
    await pick(d, 'Fee head', head);
    await fill(d, 'Amount', '5000');
    await saveDialog(s, 'Create');
    const row = s.page.locator('tbody tr').filter({ hasText: structure });
    await expect(row).toBeVisible();
    // New structures start ACTIVE; Archive/Activate toggles the status.
    await expect(row).toContainText('ACTIVE');
    await row.getByRole('button', { name: 'Archive' }).click();
    await s.settle();
    await expect(row).toContainText('ARCHIVED');
    await row.getByRole('button', { name: 'Activate' }).click();
    await s.settle();
    await expect(row).toContainText('ACTIVE');
    await row.getByRole('button', { name: 'Generate invoices' }).click();
    await s.settle();
    await expect(s.page.getByText(/Generated 1 invoice\(s\) for 1 student/)).toBeVisible();
    await expectClean(s, mark, 'structure');
  });

  test('the invoice is listed', async () => {
    const s = session();
    await s.go('/institution/fees/invoices');
    const mark = s.mark();
    await pick(s.page, 'Class section', new RegExp(cls), cls);
    await s.settle();
    await expectRow(s.page, pupil);
    await expectClean(s, mark, 'invoice list');
  });

  test('collects a part payment and downloads the receipt', async () => {
    const s = session();
    await s.go('/institution/fees/collect');
    const mark = s.mark();
    await pick(s.page, 'Student', new RegExp(pupil), pupil);
    await s.settle();
    const inv = s.page.locator('tbody tr').filter({ hasText: structure });
    await expect(inv).toBeVisible();
    await inv.locator('input[type=checkbox]').check();
    await fill(s.page, 'Amount', '2000');
    await fill(s.page, 'Reference (cheque / UTR / txn)', `E2E-${id}`);
    await s.page.getByRole('button', { name: /^Collect/ }).click();
    await s.settle();
    await expect(s.page.getByText(/Receipt .* recorded for/)).toBeVisible();
    await expect(inv).toContainText('3,000');
    await expectDownload(s.page, () => s.page.getByRole('button', { name: 'Receipt PDF' }).click());
    await expectClean(s, mark, 'collect');
  });

  test('the receipt appears in the receipts register', async () => {
    const s = session();
    await s.go('/institution/fees/receipts');
    const mark = s.mark();
    await expectRow(s.page, pupil);
    await expectClean(s, mark, 'receipts');
  });
});

test.describe('Fees · student portal', () => {
  const session = signedIn('student@greenwood.demo');
  test('student sees own invoices', async () => {
    const s = session();
    const mark = s.mark();
    await s.go('/portal/fees');
    await expect(s.page.locator('tbody tr').first()).toBeVisible();
    await expectClean(s, mark, 'my fees', ['NOT_FOUND']);
  });
});

test.describe('Fees · parent portal', () => {
  const session = signedIn('parent@greenwood.demo');
  test('parent sees the ward invoices', async () => {
    const s = session();
    const mark = s.mark();
    await s.go('/portal/fees');
    await expect(s.page.locator('tbody tr').first()).toBeVisible();
    await expectClean(s, mark, 'ward fees', ['NOT_FOUND']);
  });
});

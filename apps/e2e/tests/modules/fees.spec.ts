import { expect, test } from '@playwright/test';
import type { AppSession } from '../../src/app';
import { signedIn } from '../../src/session';
import {
  dialog,
  expectClean,
  expectDownload,
  expectRow,
  fill,
  pick,
  rows,
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
    await fill(s.page, 'UPI UTR / transaction ID *', `E2E-${id}`);
    await s.page.getByRole('button', { name: /^Record UPI/ }).click();
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

/** Call the API with the signed-in browser's refresh cookie (test data set-up only). */
async function api<T>(s: AppSession, method: string, path: string, body?: object): Promise<T> {
  return s.page.evaluate(
    async ({ method, path, body }) => {
      const json = { 'content-type': 'application/json' };
      const auth = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        headers: json,
        body: '{}',
        credentials: 'include',
      });
      const token = ((await auth.json()) as { data: { accessToken: string } }).data.accessToken;
      const res = await fetch(`/api/v1${path}`, {
        method,
        headers: { ...json, authorization: `Bearer ${token}` },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
      return (await res.json()) as T;
    },
    { method, path, body },
  );
}

test.describe.serial('Fees · UPI pay & verify', () => {
  const utr = `UPI${id}`.slice(0, 20);
  const parent = signedIn('parent@greenwood.demo');
  const accountant = signedIn('accountant@greenwood.demo');
  const finance = signedIn('finance@greenwood.demo');

  test('finance raises a small due for the ward', async () => {
    const p = parent();
    await p.go('/portal/fees');
    const wards = await api<{ data: Array<{ student: { id: string } }> }>(
      p,
      'GET',
      '/fees/my-wards',
    );
    const studentId = wards.data[0]!.student.id;
    const s = finance();
    await s.go('/institution/fees/invoices');
    await api(s, 'POST', '/fees/charges', {
      studentId,
      feeHeadCode: 'EXAM',
      amount: 150,
      dueDate: '2099-01-01',
      sourceType: 'E2E',
      sourceId: `upi-${id}`,
    });
  });

  test('parent pays via the UPI QR and submits the UTR', async () => {
    const s = parent();
    const mark = s.mark();
    await s.go('/portal/fees');
    await s.page.reload();
    await s.settle();
    const pay = s.page.getByTestId('pay-upi').first();
    await expect(pay).toBeEnabled();
    await pay.click();
    const d = dialog(s.page);
    await expect(d.getByTestId('upi-qr')).toBeVisible();
    await expect(d.getByRole('link', { name: /Open UPI app/ })).toHaveAttribute(
      'href',
      /^upi:\/\/pay\?pa=/,
    );
    await expect(d.getByTestId('upi-submit')).toBeDisabled();
    await d.getByTestId('upi-utr').locator('input').fill(utr);
    await d.getByTestId('upi-submit').click();
    await s.settle();
    await expect(s.page.getByText(/UPI payment of .* submitted/)).toBeVisible();
    await expect(s.page.getByText('Awaiting verification').first()).toBeVisible();
    await expectClean(s, mark, 'upi submit', ['NOT_FOUND']);
  });

  test('accountant verifies the UTR and the receipt is issued', async () => {
    const s = accountant();
    const mark = s.mark();
    await s.go('/institution/fees/upi');
    const row = rows(s.page).filter({ hasText: utr.toUpperCase() });
    await expect(row).toBeVisible();
    s.page.once('dialog', (x) => void x.accept());
    await row.getByRole('button', { name: /^Verify$/ }).click();
    await s.settle();
    await expect(s.page.getByText(/Verified — receipt .* issued/)).toBeVisible();
    await expectClean(s, mark, 'upi verify');
  });
});

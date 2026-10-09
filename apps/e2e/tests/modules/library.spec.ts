import { expect, test } from '@playwright/test';
import { signedIn } from '../../src/session';
import { dialog, expectClean, fill, uniq } from '../../src/ui';

/**
 * Library as the librarian: catalogue a title with copies → labels PDF → issue a copy at the
 * circulation desk to a student → return it → fines/reports load. The student then opens the OPAC.
 */
test.describe.configure({ mode: 'serial' });
const title = `E2E Physics ${uniq('LB')}`;
let barcode = '';

test.describe('Library · librarian@greenwood.demo', () => {
  const session = signedIn('librarian@greenwood.demo');

  test('catalogues a new title with two copies', async () => {
    const s = session();
    await s.go('/institution/library/catalogue');
    const mark = s.mark();
    await s.page.getByRole('button', { name: 'New title' }).click();
    const d = dialog(s.page);
    await fill(d, 'Title', title);
    await fill(d, 'Authors (separate with ;)', 'E2E Author; Second Author');
    await fill(d, 'Category', 'Science');
    await fill(d, 'Copies', '2');
    await fill(d, 'Shelf', 'S-1');
    await d.getByRole('button', { name: 'Create' }).click();
    await s.settle();
    await expect(s.page).toHaveURL(/\/library\/books\//);
    await expect(s.page.getByText(title).first()).toBeVisible();
    const copies = s.page
      .locator('.v-card')
      .filter({ hasText: /Copies \(/ })
      .locator('tbody tr');
    await expect(copies).toHaveCount(2);
    barcode = (await copies.first().locator('td').nth(1).innerText()).trim();
    expect(barcode).not.toBe('');
    await expectClean(s, mark, 'catalogue title');
  });

  test('prints spine/barcode labels as PDF', async () => {
    const s = session();
    const mark = s.mark();
    const [res] = await Promise.all([
      s.page.waitForResponse((r) => r.url().includes('/library/labels')),
      s.page.getByRole('button', { name: 'Labels PDF' }).click(),
    ]);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('pdf');
    await expectClean(s, mark, 'labels');
  });

  test('issues the copy to a student at the desk', async () => {
    const s = session();
    await s.go('/institution/library/desk');
    const mark = s.mark();
    const scan = s.page.getByLabel('Barcode / accession number', { exact: true });
    await scan.fill(barcode);
    await scan.press('Enter');
    await s.settle();
    await expect(s.page.getByText(title).first()).toBeVisible();
    const search = s.page.getByRole('combobox', {
      name: 'Search name / admission no / employee code',
    });
    await search.click();
    await search.fill('GWIS-MAIN-2026-0002');
    await s.settle();
    const option = s.page.getByRole('option', { name: /GWIS-MAIN-2026-0002/ });
    await expect(option).toHaveCount(1, { timeout: 15_000 });
    await option.click();
    await s.settle();
    await expect(s.page.getByText(/Limit \d+ books/)).toBeVisible();
    await s.page.getByRole('button', { name: 'Issue', exact: true }).last().click();
    await s.settle();
    await expect(s.page.getByText(new RegExp(`Issued “${title}”`))).toBeVisible();
    await expectClean(s, mark, 'issue');
  });

  test('returns the copy', async () => {
    const s = session();
    const mark = s.mark();
    await s.page.getByRole('button', { name: 'Return', exact: true }).first().click();
    const scan = s.page.getByLabel('Barcode / accession number', { exact: true });
    await scan.fill(barcode);
    await scan.press('Enter');
    await s.settle();
    await expect(s.page.getByText(new RegExp(`Returned “${title}”`))).toBeVisible();
    await expectClean(s, mark, 'return');
  });

  for (const tab of ['copies', 'reservations', 'members', 'fines', 'reports', 'settings']) {
    test(`library ${tab} page loads`, async () => {
      const s = session();
      const mark = s.mark();
      await s.go(`/institution/library/${tab}`);
      await expectClean(s, mark, tab);
    });
  }
});

test.describe('Library · student@greenwood.demo', () => {
  const session = signedIn('student@greenwood.demo');
  test('student finds the new title in the OPAC and opens My library', async () => {
    const s = session();
    const mark = s.mark();
    await s.go('/portal/opac');
    const search = s.page.getByLabel(/Search/).first();
    await search.fill(title);
    await search.press('Enter');
    await s.settle();
    await expect(s.page.getByText(title).first()).toBeVisible();
    await s.go('/portal/library');
    await expectClean(s, mark, 'student library', ['NOT_FOUND']);
  });
});

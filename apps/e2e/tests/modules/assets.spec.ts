import { expect, test } from '@playwright/test';
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
 * Assets (Greenwood, assets@): register an asset, print its QR label, check it out to a room,
 * check it back in, raise a maintenance ticket and print register labels. Employees see their
 * own custody list.
 */
test.describe.configure({ mode: 'serial' });
const id = uniq('AST').replace(/-/g, '');
const name = `E2E Projector ${id}`;

test.describe('Assets · assets@greenwood.demo', () => {
  const session = signedIn('assets@greenwood.demo');

  test('registers a new asset', async () => {
    const s = session();
    await s.go('/assets/register');
    const mark = s.mark();
    await s.page.getByRole('button', { name: 'New asset' }).click();
    const d = dialog(s.page);
    await pick(d, 'Institution *', 'Greenwood International School');
    await pick(d, 'Category *', 'Projectors');
    await fill(d, 'Name *', name);
    await fill(d, 'Serial no', `SN-${id}`);
    await fill(d, 'Cost (₹)', '42000');
    await saveDialog(s, 'Create');
    await s.page.waitForURL(/\/assets\/register\/[0-9a-f-]{36}/);
    await expect(s.page.getByRole('heading', { name: new RegExp(name) })).toBeVisible();
    await expectClean(s, mark, 'asset create');
  });

  test('downloads the QR label PDF', async () => {
    const s = session();
    const mark = s.mark();
    await expectDownload(s.page, () => s.page.getByRole('button', { name: 'Label' }).click());
    await expectClean(s, mark, 'asset label');
  });

  test('checks the asset out to a room and back in', async () => {
    const s = session();
    const mark = s.mark();
    await s.page.getByRole('button', { name: 'Check out' }).click();
    let d = dialog(s.page);
    await d.getByRole('button', { name: 'Room / location' }).click();
    await fill(d, 'Location', `Lab ${id}`);
    // The confirmation snackbars are transient (and the check-in one reuses the same snackbar
    // timer), so assert the custody history instead.
    await saveDialog(s, 'Check out');
    await s.page.getByRole('tab', { name: /Custody/ }).click();
    await expectRow(s.page, `Lab ${id}`);

    await s.page.getByRole('button', { name: 'Check in' }).click();
    d = dialog(s.page);
    await fill(d, 'Notes', 'Returned by E2E');
    await saveDialog(s, 'Check in');
    await expect(rows(s.page).filter({ hasText: `Lab ${id}` })).toContainText('Returned');
    await expectClean(s, mark, 'checkout/checkin');
  });

  test('raises a maintenance ticket', async () => {
    const s = session();
    const mark = s.mark();
    await s.page.getByRole('button', { name: 'Maintenance', exact: true }).click();
    const d = dialog(s.page);
    await fill(d, 'Title', `Lamp flicker ${id}`);
    await fill(d, 'Description', 'Raised by E2E');
    await saveDialog(s, 'Create');
    await s.page.getByRole('tab', { name: /Maintenance/ }).click();
    await expectRow(s.page, `Lamp flicker ${id}`);
    await s.go('/assets/maintenance');
    await expectRow(s.page, `Lamp flicker ${id}`);
    await expectClean(s, mark, 'maintenance ticket');
  });

  test('finds the asset in the register and prints labels', async () => {
    const s = session();
    await s.go('/assets/register');
    const mark = s.mark();
    await fill(s.page, 'Search tag / name / serial', id);
    await s.settle();
    await expectRow(s.page, name);
    await rows(s.page).filter({ hasText: name }).getByRole('checkbox').check();
    await expectDownload(s.page, () =>
      s.page.getByRole('button', { name: /Print labels \(1\)/ }).click(),
    );
    await expectClean(s, mark, 'register labels');
  });
});

test.describe('Assets · employee@greenwood.demo', () => {
  const session = signedIn('employee@greenwood.demo');
  test('opens My assets', async () => {
    const s = session();
    const mark = s.mark();
    await s.go('/employee/assets');
    await expect(s.page.getByRole('heading').first()).toBeVisible();
    await expectClean(s, mark, 'my assets');
  });
});

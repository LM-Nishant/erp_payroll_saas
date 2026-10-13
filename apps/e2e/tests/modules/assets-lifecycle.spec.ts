import { expect, test, type Page } from '@playwright/test';
import { BLOCKED_PATHS } from '../../src/app';
import type { AppSession } from '../../src/app';
import { signedIn } from '../../src/session';
import {
  dialog,
  expectClean,
  expectDownload,
  expectRow,
  fill,
  menu,
  pick,
  rows,
  saveDialog,
  uniq,
} from '../../src/ui';

/**
 * Asset lifecycle depth (Greenwood, assets@ = asset_manager): an own category with three assets
 * → consumables stock in / out (over-issue refused, low-stock filter + notification deep link) →
 * physical audit (verify by tag, mark missing, complete, discrepancy notification deep link) →
 * disposal approve / reject / cancel → reports. Negative: the institution admin (asset.view /
 * assign only) gets no manage, audit or disposal-decision controls; teacher / employee are kept
 * out of the asset workspace.
 */
test.describe.configure({ mode: 'serial' });
const id = uniq('AL').replace(/-/g, '');
const school = 'Greenwood International School';
const category = `E2E Audit Kit ${id}`;
const tagPrefix = `E2E${id.slice(-6)}-`;
const sku = `E2E-${id}`;
const item = `E2E Chalk box ${id}`;
const auditName = `E2E Audit ${id}`;
const assets = { found: '', missing: '', sold: '' };
const urls = { found: '', missing: '', sold: '' };
const reason = (k: string) => `E2E ${k} ${id}`;

/** Dismisses an expected error alert so later expectClean checks only see new problems. */
async function dismissAlert(page: Page, text: RegExp) {
  const alert = page.locator('.v-alert').filter({ hasText: text }).first();
  await expect(alert).toBeVisible();
  await alert.getByRole('button', { name: /close/i }).click();
  await expect(alert).toHaveCount(0);
}

async function openStock(s: AppSession) {
  await fill(s.page, 'Search', sku);
  await s.settle();
  const row = rows(s.page).filter({ hasText: sku });
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: /stock/i }).click();
  const d = dialog(s.page);
  await expect(d).toContainText(`${sku} · ${item}`);
  return d;
}

async function post(s: AppSession, d: ReturnType<typeof dialog>, type: string, qty: string) {
  await pick(d, 'Type', type);
  await fill(d, 'Quantity', qty);
  await d.getByRole('button', { name: /^post$/i }).click();
  await s.settle();
}

/** Disposal row (PENDING list by default) of the asset with `tag`. */
const disposalRow = (page: Page, tag: string) => rows(page).filter({ hasText: tag });

test.describe('Assets lifecycle · assets@greenwood.demo', () => {
  const session = signedIn('assets@greenwood.demo');

  test('creates an own asset category with a tag series', async () => {
    const s = session();
    await s.go('/assets/categories');
    const mark = s.mark();
    await s.page.getByRole('button', { name: /new category/i }).click();
    const d = dialog(s.page);
    await fill(d, 'Code', `E2E${id}`.slice(0, 32));
    await fill(d, 'Name', category);
    await fill(d, 'Tag prefix', tagPrefix);
    // The asset manager is scoped to the main campus: organization-wide categories are not theirs.
    await pick(d, 'Institution (blank = organization-wide)', school);
    await saveDialog(s);
    await expectRow(s.page, category);
    await expectClean(s, mark, 'category create');
  });

  for (const key of ['found', 'missing', 'sold'] as const) {
    test(`registers asset “${key}” in the category`, async () => {
      const s = session();
      await s.go('/assets/register');
      const mark = s.mark();
      await s.page.getByRole('button', { name: /new asset/i }).click();
      const d = dialog(s.page);
      await pick(d, 'Institution *', school);
      await pick(d, 'Category *', category);
      await fill(d, 'Name *', `E2E ${key} ${id}`);
      await fill(d, 'Cost (₹)', '1200');
      await fill(d, 'Location (building / room)', `Store ${id}`);
      await saveDialog(s, 'Create');
      await s.page.waitForURL(/\/assets\/register\/[0-9a-f-]{36}/);
      const heading = s.page.getByRole('heading', { name: new RegExp(`E2E ${key} ${id}`) });
      await expect(heading).toBeVisible();
      assets[key] = (await heading.innerText()).split(' · ')[0]!.trim();
      urls[key] = new URL(s.page.url()).pathname;
      expect(assets[key]).toContain(tagPrefix);
      await expectClean(s, mark, `asset ${key}`);
    });
  }

  test('inventory: creates a consumable and posts stock in / out', async () => {
    const s = session();
    await s.go('/assets/inventory');
    const mark = s.mark();
    await s.page.getByRole('button', { name: /new item/i }).click();
    const d = dialog(s.page);
    await pick(d, 'Institution', school);
    await fill(d, 'SKU', sku);
    await fill(d, 'Name', item);
    await fill(d, 'Category', 'Stationery');
    await fill(d, 'Unit', 'box');
    await fill(d, 'Unit cost', '40');
    await fill(d, 'Opening qty', '10');
    await fill(d, 'Reorder level', '3');
    await saveDialog(s, 'Create');

    const stock = await openStock(s);
    await expect(stock).toContainText('On hand 10 box');
    await post(s, stock, 'IN', '5');
    await expect(stock).toContainText('On hand 15 box');
    await post(s, stock, 'OUT', '13');
    await expect(stock).toContainText('On hand 2 box');
    await expect(stock.locator('tbody tr')).toHaveCount(3); // opening + in + out
    await expectClean(s, mark, 'inventory stock in/out');
  });

  test('inventory: issuing more than on hand is refused inside the stock dialog', async () => {
    const s = session();
    const mark = s.mark();
    const stock = dialog(s.page);
    await post(s, stock, 'OUT', '50');
    await expect(stock.locator('.v-alert')).toContainText(/stock|insufficient|only/i);
    await expect(stock).toContainText('On hand 2 box');
    const failed = await s.failedSince(mark);
    expect(failed.map((f) => f.status)).toEqual([409]);
    await s.page.keyboard.press('Escape');
    await expect(s.page.locator('.v-dialog.v-overlay--active')).toHaveCount(0);
  });

  test('inventory: the low-stock filter lists the item', async () => {
    const s = session();
    const mark = s.mark();
    await s.page.getByLabel('Below reorder level').check();
    await s.settle();
    await expectRow(s.page, sku);
    await fill(s.page, 'Search', '');
    await s.settle();
    // Every listed item is below its reorder level (red on-hand chip).
    await expect(rows(s.page).locator('.v-chip.text-success')).toHaveCount(0);
    await expectClean(s, mark, 'low stock filter');
  });

  test('inventory: the low-stock notification opens the filtered inventory', async () => {
    const s = session();
    const mark = s.mark();
    const link = s.page.locator('.v-list-item').filter({ hasText: `Low stock: ${item} (${sku})` });
    await expect(async () => {
      await s.go('/assets/notifications');
      await expect(link.first()).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 30_000 });
    await link.first().click();
    await s.page.waitForURL(/\/assets\/inventory\?lowStock=true/);
    await s.settle();
    await expect(s.page.getByLabel('Below reorder level')).toBeChecked();
    await expectRow(s.page, sku);
    await expectClean(s, mark, 'low stock deep link');
  });

  test('audit: starts a physical verification of the category', async () => {
    const s = session();
    await s.go('/assets/audit');
    const mark = s.mark();
    await s.page.getByRole('button', { name: /new audit/i }).click();
    const d = dialog(s.page);
    await pick(d, 'Institution', school);
    await pick(d, 'Category (optional)', category);
    await fill(d, 'Name (e.g. Annual verification 2026)', auditName);
    await saveDialog(s, 'Start');
    await expect(s.page.getByRole('heading', { name: auditName })).toBeVisible();
    await expect(rows(s.page)).toHaveCount(3);
    await expect(s.page.getByText('Pending: 3')).toBeVisible();
    await expectClean(s, mark, 'audit start');
  });

  test('audit: verifies by tag, rejects an unknown tag and marks one missing', async () => {
    const s = session();
    const mark = s.mark();
    const tag = s.page.getByLabel('Scan / type asset tag');
    await tag.fill(`${tagPrefix}NOPE`);
    await s.page.getByRole('button', { name: /^verify$/i }).click();
    await s.settle();
    await dismissAlert(s.page, /not found/i);
    expect((await s.failedSince(mark)).map((f) => f.status)).toEqual([404]);

    const mark2 = s.mark();
    await tag.fill(assets.found);
    await tag.press('Enter');
    await s.settle();
    await expect(rows(s.page).filter({ hasText: assets.found })).toContainText('Verified');
    await rows(s.page)
      .filter({ hasText: assets.missing })
      .getByRole('button', { name: /missing/i })
      .click();
    await s.settle();
    await expect(rows(s.page).filter({ hasText: assets.missing })).toContainText('Missing');
    await expect(s.page.getByText('Verified: 1')).toBeVisible();

    await pick(s.page, 'Filter by result', 'Missing');
    await s.settle();
    await expect(rows(s.page)).toHaveCount(1);
    await expect(rows(s.page).first()).toContainText(assets.missing);
    await expectClean(s, mark2, 'audit verify');
  });

  test('audit: completing marks the rest missing and closes the audit', async () => {
    const s = session();
    const mark = s.mark();
    await s.page.getByRole('button', { name: /^complete$/i }).click();
    await s.settle();
    await expect(s.page.getByRole('button', { name: /^complete$/i })).toHaveCount(0);
    await expect(s.page.getByLabel('Scan / type asset tag')).toHaveCount(0);
    await expect(s.page.getByText('Missing: 2')).toBeVisible();
    await expect(s.page.getByText('Pending: 0')).toBeVisible();
    const entry = s.page.locator('.v-list-item').filter({ hasText: auditName });
    await expect(entry).toContainText('COMPLETED');
    await expect(entry).toContainText('1/3 verified');
    await expectClean(s, mark, 'audit complete');
  });

  test('audit: the discrepancy notification opens that audit', async () => {
    const s = session();
    const mark = s.mark();
    const link = s.page
      .locator('.v-list-item')
      .filter({ hasText: `Asset audit "${auditName}": 2 discrepancies` });
    await expect(async () => {
      await s.go('/assets/notifications');
      await expect(link.first()).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 30_000 });
    await link.first().click();
    await s.page.waitForURL(/\/assets\/audit\?audit=/);
    await s.settle();
    await expect(s.page.getByRole('heading', { name: auditName })).toBeVisible();
    await expect(s.page.getByText('Missing: 2')).toBeVisible();
    await expectClean(s, mark, 'audit deep link');
  });

  async function requestDisposal(
    s: AppSession,
    key: keyof typeof assets,
    method: string,
    extra: Record<string, string> = {},
  ) {
    await s.go(urls[key]);
    await s.page.locator('button:has(.mdi-dots-vertical)').click();
    await menu(s.page).filter({ hasText: 'Dispose / write off' }).click();
    const d = dialog(s.page);
    await pick(d, 'Method', method);
    for (const [label, value] of Object.entries(extra)) await fill(d, label, value);
    await fill(d, 'Reason', reason(key));
    await saveDialog(s, 'Submit');
    await s.page.getByRole('tab', { name: /transfers & disposal/i }).click();
    await expect(rows(s.page).filter({ hasText: reason(key) })).toContainText('Pending Approval');
  }

  test('disposal: raises write-off requests from the asset page', async () => {
    const s = session();
    const mark = s.mark();
    await requestDisposal(s, 'missing', 'WRITTEN_OFF');
    await requestDisposal(s, 'sold', 'SOLD', {
      'Sale value (₹)': '300',
      'Buyer / recipient': `Scrap dealer ${id}`,
    });
    await requestDisposal(s, 'found', 'DONATED');
    await expectClean(s, mark, 'disposal requests');
  });

  test('disposal: no second request is offered while one is pending', async () => {
    const s = session();
    const mark = s.mark();
    // The API refuses a second pending disposal (409), so the asset page hides the action.
    await s.page.locator('button:has(.mdi-dots-vertical)').click();
    await expect(menu(s.page).filter({ hasText: 'Dispose / write off' })).toHaveCount(0);
    await s.page.keyboard.press('Escape');
    await expectClean(s, mark, 'pending disposal hides dispose');
  });

  test('disposal: approves one (asset written off) and rejects another', async () => {
    const s = session();
    await s.go('/assets/disposal');
    const mark = s.mark();
    s.page.on('dialog', (d) => void d.accept(`E2E decision ${id}`));
    await disposalRow(s.page, assets.missing)
      .getByRole('button', { name: /approve/i })
      .click();
    await s.settle();
    await disposalRow(s.page, assets.sold)
      .getByRole('button', { name: /reject/i })
      .click();
    await s.settle();
    await expect(disposalRow(s.page, assets.missing)).toHaveCount(0);
    await expect(disposalRow(s.page, assets.sold)).toHaveCount(0);

    await pick(s.page, 'Status', 'Approved');
    await s.settle();
    await expect(disposalRow(s.page, assets.missing)).toContainText('Approved');
    await pick(s.page, 'Status', 'Rejected');
    await s.settle();
    await expect(disposalRow(s.page, assets.sold)).toContainText('Rejected');
    await expectClean(s, mark, 'disposal decisions');
  });

  test('disposal: the approved asset is disposed and read-only', async () => {
    const s = session();
    const mark = s.mark();
    await s.go(urls.missing);
    await expect(s.page.getByText('Disposed', { exact: true }).first()).toBeVisible();
    for (const name of [/check out/i, /maintenance/i, /^edit$/i])
      await expect(s.page.getByRole('button', { name })).toHaveCount(0);
    await s.go(urls.sold);
    await expect(s.page.getByText('In Stock', { exact: true }).first()).toBeVisible();
    await expect(s.page.getByRole('button', { name: /check out/i })).toBeVisible();
    await expectClean(s, mark, 'disposed asset');
  });

  test('reports: previews the register / disposals for the category and downloads', async () => {
    const s = session();
    await s.go('/assets/reports');
    const mark = s.mark();
    await pick(s.page, 'Category', category);
    await s.page.getByRole('button', { name: /preview/i }).click();
    await s.settle();
    const table = s.page.locator('.v-card').filter({ has: s.page.locator('thead') });
    await expect(table).toContainText(assets.found);
    await expect(table).toContainText(assets.sold);
    await expect(table).not.toContainText('Projector'); // category filter applied

    await pick(s.page, 'Report', 'Disposals');
    await s.page.getByRole('button', { name: /preview/i }).click();
    await s.settle();
    await expect(table).toContainText(assets.missing);
    await expectDownload(
      s.page,
      () => s.page.getByRole('button', { name: /^csv$/i }).click(),
      /asset-disposals\.csv$/,
    );
    await expectDownload(s.page, () => s.page.getByRole('button', { name: /^pdf$/i }).click());
    await expectClean(s, mark, 'asset reports');
  });
});

test.describe('Assets lifecycle · admin@greenwood.demo (view / assign only)', () => {
  const session = signedIn('admin@greenwood.demo');

  test('asset page offers custody actions but no edit / dispose', async () => {
    const s = session();
    const mark = s.mark();
    await s.go(urls.sold);
    await expect(s.page.getByRole('heading', { name: new RegExp(assets.sold) })).toBeVisible();
    await expect(s.page.getByRole('button', { name: /check out/i })).toBeVisible();
    await expect(s.page.getByRole('button', { name: /^edit$/i })).toHaveCount(0);
    await expect(s.page.locator('button:has(.mdi-dots-vertical)')).toHaveCount(0);
    await expectClean(s, mark, 'admin asset detail');
  });

  test('sees the pending disposal without approve / reject / cancel', async () => {
    const s = session();
    const mark = s.mark();
    await s.go('/assets/disposal');
    const row = disposalRow(s.page, assets.found);
    await expect(row).toContainText('Pending Approval');
    await expect(row.getByRole('button')).toHaveCount(0);
    await expectClean(s, mark, 'admin disposals');
  });

  test('inventory is read-only and the audit page is blocked', async () => {
    const s = session();
    const mark = s.mark();
    await s.go('/assets/inventory');
    await expect(s.page.getByRole('button', { name: /new item/i })).toHaveCount(0);
    const stock = await openStock(s);
    await expect(stock.getByRole('button', { name: /^post$/i })).toHaveCount(0);
    await s.page.keyboard.press('Escape');
    await expectClean(s, mark, 'admin inventory');
    await s.go('/assets/audit');
    expect(BLOCKED_PATHS).toContain(s.pathname());
  });
});

test.describe('Assets lifecycle · assets@greenwood.demo (cleanup)', () => {
  const session = signedIn('assets@greenwood.demo');
  test('cancels the remaining pending disposal', async () => {
    const s = session();
    await s.go('/assets/disposal');
    const mark = s.mark();
    s.page.once('dialog', (c) => void c.accept());
    await disposalRow(s.page, assets.found)
      .getByRole('button', { name: /cancel request/i })
      .click();
    await s.settle();
    await expect(disposalRow(s.page, assets.found)).toHaveCount(0);
    await pick(s.page, 'Status', 'Cancelled');
    await s.settle();
    await expect(disposalRow(s.page, assets.found)).toContainText('Cancelled');
    await expectClean(s, mark, 'disposal cancel');
  });
});

for (const email of ['teacher@greenwood.demo', 'employee@greenwood.demo']) {
  test.describe(`Assets lifecycle · ${email} (no asset management)`, () => {
    const session = signedIn(email);
    test('is kept out of the asset workspace', async () => {
      const s = session();
      const leaked: string[] = [];
      for (const p of [
        '/assets/register',
        '/assets/inventory',
        '/assets/audit',
        '/assets/disposal',
        '/assets/reports',
      ]) {
        await s.go(p);
        if (!BLOCKED_PATHS.includes(s.pathname())) leaked.push(`${p} opened at ${s.pathname()}`);
      }
      expect(leaked).toEqual([]);
    });
  });
}

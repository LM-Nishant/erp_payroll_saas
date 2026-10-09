import { expect, type Download, type Locator, type Page } from '@playwright/test';
import type { AppSession } from './app';

/** Unique, repeatable-safe suffix for names created by functional flows. */
export const RUN_ID = Date.now().toString(36).slice(-6).toUpperCase();
export const uniq = (prefix: string) => `${prefix}-${RUN_ID}-${Math.floor(Math.random() * 1e4)}`;

/** The top-most open dialog card. */
export function dialog(page: Page): Locator {
  return page.locator('.v-dialog.v-overlay--active .v-overlay__content > .v-card').last();
}

/** Fills a Vuetify text field / textarea by its (exact) label. */
export async function fill(scope: Locator | Page, label: string | RegExp, value: string) {
  const field = scope.getByLabel(label, { exact: typeof label === 'string' }).first();
  await field.fill(value);
}

/** Open dropdown menu of a v-select / v-autocomplete. */
export function menu(page: Page): Locator {
  return page.locator('.v-menu.v-overlay--active .v-list-item');
}

/**
 * Picks an option of a v-select / v-autocomplete by label. `option` matches the item text
 * (substring / regex); omit it to take the first option. For autocompletes `search` is typed first.
 */
export async function pick(
  scope: Locator | Page,
  label: string | RegExp,
  option?: string | RegExp,
  search?: string,
) {
  const page = 'page' in scope ? scope.page() : scope;
  const input = scope.getByLabel(label, { exact: typeof label === 'string' }).first();
  const control = input.locator('xpath=ancestor::div[contains(@class,"v-input")][1]');
  await control.locator('.v-field').first().click();
  if (search !== undefined) await input.fill(search);
  const items = menu(page);
  const choice = option === undefined ? items.first() : items.filter({ hasText: option }).first();
  await expect(choice).toBeVisible({ timeout: 15_000 });
  await choice.click();
  // Multi-selects keep the menu open; single selects close it.
  const openMenu = page.locator('.v-menu.v-overlay--active');
  await page.waitForTimeout(250);
  if (await openMenu.count()) await page.keyboard.press('Escape');
  await expect(openMenu).toHaveCount(0);
}

/** Clicks a button in the scope and waits for the API to settle. */
export async function click(s: AppSession, scope: Locator | Page, name: string | RegExp) {
  await scope
    .getByRole('button', { name, exact: typeof name === 'string' })
    .first()
    .click();
  await s.settle();
}

/** Saves the top dialog with `button` and asserts it closed without an error alert. */
export async function saveDialog(s: AppSession, button: string | RegExp = 'Save') {
  const d = dialog(s.page);
  await d.getByRole('button', { name: button, exact: typeof button === 'string' }).click();
  await s.settle();
  const err = d.locator('.v-alert.bg-error, .v-alert.text-error');
  if (await err.count())
    throw new Error(`dialog error: ${(await err.allInnerTexts()).join(' | ')}`);
  const open = s.page.locator('.v-dialog.v-overlay--active');
  await expect(open)
    .toHaveCount(0, { timeout: 10_000 })
    .catch(async (e: unknown) => {
      // Some pages render save errors behind the modal: surface them in the failure.
      const alerts = await s.errorAlerts();
      throw alerts.length ? new Error(`dialog stayed open: ${alerts.join(' | ')}`) : e;
    });
}

/** Data rows of the first visible data table (the "no data" row excluded). */
export function rows(scope: Locator | Page): Locator {
  return scope
    .locator('.v-table:visible tbody tr')
    .filter({ hasNot: scope.locator('.v-data-table-rows-no-data, .v-data-table-rows-loading') });
}

export async function expectRows(scope: Locator | Page, min = 1) {
  await expect
    .poll(async () => rows(scope).count(), { message: 'table rows', timeout: 15_000 })
    .toBeGreaterThanOrEqual(min);
}

/** Asserts a table row containing `text` is visible. */
export async function expectRow(scope: Locator | Page, text: string | RegExp) {
  const row = rows(scope).filter({ hasText: text }).first();
  if (await row.isVisible({ timeout: 5_000 }).catch(() => false)) return;
  // Client-side tables paginate (10/page): widen the page size, then look again.
  const pager = scope.locator('.v-data-table-footer__items-per-page .v-select:visible').first();
  if (await pager.count()) {
    await pager.click();
    const page = 'page' in scope ? scope.page() : scope;
    await page.locator('.v-menu.v-overlay--active .v-list-item').last().click();
  }
  await expect(row).toBeVisible({ timeout: 15_000 });
}

/** Asserts there are no error alerts and no failed API calls since `mark`. */
export async function expectClean(
  s: AppSession,
  mark: number,
  what: string,
  allowCodes: string[] = [],
) {
  const failed = (await s.failedSince(mark)).filter((c) => !allowCodes.includes(c.code ?? ''));
  const alerts = await s.errorAlerts();
  expect(
    [
      ...failed.map((c) => `${c.status} ${c.method} ${c.path} ${c.code ?? ''} ${c.message ?? ''}`),
      ...alerts.map((a) => `alert: ${a}`),
    ],
    what,
  ).toEqual([]);
}

/** Runs `action` and returns the browser download it triggers (asserting a PDF by default). */
export async function expectDownload(
  page: Page,
  action: () => Promise<unknown>,
  ext: RegExp = /\.pdf$/i,
): Promise<Download> {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    action(),
  ]);
  expect(download.suggestedFilename()).toMatch(ext);
  expect(await download.failure()).toBeNull();
  return download;
}

/** ISO date (YYYY-MM-DD) offset by `days` from today. */
export const isoDate = (days = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * Runs `action`, which requests a signed download URL (`…/download-url`) and opens it in a new
 * tab, then fetches that URL and asserts it serves a PDF.
 */
export async function expectSignedPdf(page: Page, action: () => Promise<unknown>) {
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/download-url'), { timeout: 30_000 }),
    action(),
  ]);
  expect([200, 201], 'signed URL request').toContain(res.status());
  const { data } = (await res.json()) as { data: { url: string } };
  const file = await page.request.get(new URL(data.url, page.url()).toString());
  expect(file.status(), 'signed file download').toBe(200);
  expect(file.headers()['content-type']).toContain('pdf');
  for (const p of page.context().pages()) if (p !== page) await p.close();
}

import { expect, test } from '@playwright/test';
import { signedIn } from '../../src/session';
import {
  dialog,
  expectClean,
  expectRow,
  fill,
  isoDate,
  menu,
  pick,
  rows,
  saveDialog,
  uniq,
} from '../../src/ui';

/**
 * Transport as the transport manager: vehicle → driver → route with stops → fare slab →
 * allocate a student to a stop → end the allocation (keeps the flow repeatable).
 */
test.describe('Transport · transport@greenwood.demo', () => {
  test.describe.configure({ mode: 'serial' });
  const session = signedIn('transport@greenwood.demo');
  const id = uniq('T').replace(/-/g, '').slice(0, 10);
  const regNo = `KA01${id}`;
  const routeCode = `R${id}`;
  const driver = `E2E Driver ${id}`;
  let passenger = '';

  test('registers a vehicle', async () => {
    const s = session();
    await s.go('/institution/transport/vehicles');
    const mark = s.mark();
    await s.page.getByRole('button', { name: 'New vehicle' }).click();
    const d = dialog(s.page);
    await pick(d, 'Institution', 'Greenwood International School');
    await fill(d, 'Registration no *', regNo);
    await fill(d, 'Seating capacity *', '40');
    await fill(d, 'Insurance expiry', isoDate(300));
    await saveDialog(s);
    await expectRow(s.page, regNo);
    await expectClean(s, mark, 'vehicle');
  });

  test('adds a driver', async () => {
    const s = session();
    await s.page.getByRole('tab', { name: 'Drivers' }).click();
    await s.settle();
    const mark = s.mark();
    await s.page.getByRole('button', { name: 'New driver / staff' }).click();
    const d = dialog(s.page);
    await pick(d, 'Institution', 'Greenwood International School');
    await pick(d, 'Role', 'DRIVER');
    await fill(d, 'Name *', driver);
    await fill(d, 'Licence no', `DL-${id}`);
    await saveDialog(s);
    await expectRow(s.page, driver);
    await expectClean(s, mark, 'driver');
  });

  test('creates a route with two stops', async () => {
    const s = session();
    await s.page.getByRole('tab', { name: 'Routes & stops' }).click();
    await s.settle();
    const mark = s.mark();
    await s.page.getByRole('button', { name: 'New route' }).click();
    const d = dialog(s.page);
    await pick(d, 'Institution', 'Greenwood International School');
    await fill(d, 'Code *', routeCode);
    await fill(d, 'Name *', `E2E Route ${id}`);
    await pick(d, 'Vehicle', regNo, regNo);
    await pick(d, 'Driver', driver, driver);
    await fill(d, 'Distance (km)', '12');
    await saveDialog(s);
    await expectRow(s.page, routeCode);
    await rows(s.page)
      .filter({ hasText: routeCode })
      .getByRole('button', { name: 'Stops' })
      .click();
    await s.settle();
    const card = s.page
      .locator('.v-card')
      .filter({ hasText: `${routeCode} · E2E Route ${id} — stops` });
    for (const [name, time, km] of [
      ['E2E Stop One', '07:10', '4'],
      ['E2E Stop Two', '07:25', '9'],
    ] as const) {
      await fill(card, 'Stop name', name);
      await fill(card, 'Pickup', time);
      await fill(card, 'Km', km);
      await card.getByRole('button', { name: 'Add', exact: true }).click();
      await s.settle();
      await expect(card.locator('tbody tr').filter({ hasText: name })).toBeVisible();
    }
    await expectClean(s, mark, 'route & stops');
  });

  test('adds a distance fare slab', async () => {
    const s = session();
    const mark = s.mark();
    await s.page.getByRole('button', { name: 'New fare slab' }).click();
    const d = dialog(s.page);
    await pick(d, 'Institution', 'Greenwood International School');
    await fill(d, 'Name *', `E2E Slab ${id}`);
    await fill(d, 'From km', '0');
    await fill(d, 'To km *', '5');
    await fill(d, 'Amount *', '900');
    await saveDialog(s);
    await expectRow(s.page, `E2E Slab ${id}`);
    await expectClean(s, mark, 'fare slab');
  });

  test('allocates a student to a stop on the route', async () => {
    const s = session();
    await s.page.getByRole('tab', { name: 'Allocations' }).click();
    await s.settle();
    const mark = s.mark();
    // Students who already ride a route are listed as disabled "already allocated" options.
    await s.page.getByRole('button', { name: 'Allocate', exact: true }).click();
    const d = dialog(s.page);
    await d
      .getByLabel('Student', { exact: true })
      .locator('xpath=ancestor::div[contains(@class,"v-input")][1]')
      .locator('.v-field')
      .click();
    await expect(menu(s.page).first()).toBeVisible();
    const titles = (await menu(s.page).allInnerTexts()).map((t) => t.trim());
    const free = titles.filter((t) => /\(/.test(t) && !/already allocated/.test(t));
    expect(free.length, 'a student without an active allocation').toBeGreaterThan(0);
    const title = free[Math.floor(Math.random() * free.length)]!;
    await menu(s.page).filter({ hasText: title }).first().click();
    // The student autocomplete re-searches with the picked title and keeps its menu open.
    if (await s.page.locator('.v-menu.v-overlay--active').count())
      await s.page.keyboard.press('Escape');
    await expect(s.page.locator('.v-menu.v-overlay--active')).toHaveCount(0);
    await pick(d, 'Route', routeCode, routeCode);
    await pick(d, 'Stop', 'E2E Stop One');
    await fill(d, 'From', isoDate(0));
    await saveDialog(s, 'Allocate');
    passenger = title.replace(/\s*\(.*$/, '');
    expect(passenger, 'a student could be allocated').not.toBe('');
    await expectRow(s.page, routeCode);
    await expectClean(s, mark, 'allocation');
  });

  test('ends the allocation', async () => {
    const s = session();
    const mark = s.mark();
    const row = rows(s.page).filter({ hasText: routeCode }).filter({ hasText: 'ACTIVE' });
    await row.getByRole('button', { name: 'End' }).click();
    await s.settle();
    await expect(row).toHaveCount(0);
    await expectClean(s, mark, 'end allocation');
  });

  for (const tab of ['dashboard', 'trips', 'maintenance', 'reports']) {
    test(`transport ${tab} tab loads`, async () => {
      const s = session();
      const mark = s.mark();
      await s.go(`/institution/transport/${tab}`);
      await expectClean(s, mark, tab);
    });
  }
});

test.describe('Transport · parent@greenwood.demo', () => {
  const session = signedIn('parent@greenwood.demo');
  test('parent opens the child transport page', async () => {
    const s = session();
    const mark = s.mark();
    await s.go('/portal/transport');
    await expectClean(s, mark, 'my transport', ['NOT_FOUND']);
  });
});

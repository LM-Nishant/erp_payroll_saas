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
 * Hostel operations as the hostel manager: hostel → room → mess plan → allocate a student →
 * out-pass approve / check-out / return → complaint ticket → vacate (keeps the flow repeatable).
 */
test.describe.configure({ mode: 'serial' });
const code = uniq('H').replace(/-/g, '').slice(0, 10);
const name = `E2E Hostel ${code}`;
const plan = `E2E Veg ${code}`;
const reason = `E2E outing ${code}`;
let resident = '';
let admNo = '';

test.describe('Hostel · hostel@greenwood.demo', () => {
  const session = signedIn('hostel@greenwood.demo');

  test('creates a hostel', async () => {
    const s = session();
    await s.go('/institution/hostel/hostels');
    const mark = s.mark();
    await s.page.getByRole('button', { name: 'New hostel' }).click();
    const d = dialog(s.page);
    await pick(d, 'Institution', 'Greenwood International School');
    await fill(d, 'Code *', code);
    await fill(d, 'Name *', name);
    await pick(d, 'Type', 'MIXED');
    await saveDialog(s);
    await expectRow(s.page, code);
    await expectClean(s, mark, 'hostel create');
  });

  test('adds a double room with two beds', async () => {
    const s = session();
    const mark = s.mark();
    const rooms = s.page.locator('.v-card').filter({ hasText: 'Rooms & beds' }).first();
    await rooms.locator('.v-select .v-field').first().click();
    await menu(s.page).filter({ hasText: code }).first().click();
    await s.settle();
    await s.page.getByRole('button', { name: 'New room' }).click();
    const d = dialog(s.page);
    await fill(d, 'Room no', '101');
    await fill(d, 'Floor', '1');
    await pick(d, 'Type', 'DOUBLE');
    await fill(d, 'Beds', '2');
    await fill(d, 'Monthly rent', '4500');
    await saveDialog(s);
    await expect(rooms.getByText('Room 101')).toBeVisible();
    await expect(rooms.getByText(/0\/2/)).toBeVisible();
    await expectClean(s, mark, 'room create');
  });

  test('creates a mess plan', async () => {
    const s = session();
    const mark = s.mark();
    await s.page.getByRole('button', { name: 'New mess plan' }).click();
    const d = dialog(s.page);
    await fill(d, 'Name *', plan);
    await fill(d, 'Monthly fee *', '3000');
    await saveDialog(s);
    await expectRow(s.page, plan);
    await expectClean(s, mark, 'mess plan');
  });

  test('allocates a student to the room with the mess plan', async () => {
    const s = session();
    await s.page.getByRole('tab', { name: 'Allocations' }).click();
    await s.settle();
    const mark = s.mark();
    // Seeded students (and earlier runs) may already hold a bed: pick a student who is free.
    const busy = new Set(
      (
        await rows(s.page)
          .filter({ hasText: /\bACTIVE\b/ })
          .allInnerTexts()
      ).flatMap((t) => t.match(/[A-Z]+-[A-Z]+-\d{4}-\d+/g) ?? []),
    );
    await s.page.getByRole('button', { name: 'Allocate room' }).click();
    const d = dialog(s.page);
    await pick(d, 'Hostel', code);
    await s.settle();
    await d
      .getByLabel('Student', { exact: true })
      .locator('xpath=ancestor::div[contains(@class,"v-input")][1]')
      .locator('.v-field')
      .click();
    await expect(menu(s.page).first()).toBeVisible();
    const titles = (await menu(s.page).allInnerTexts()).map((t) => t.trim());
    const free = titles.filter((t) => !busy.has(/\(([^)]+)\)/.exec(t)?.[1] ?? ''));
    expect(free.length, 'a student without an active allocation').toBeGreaterThan(0);
    const title = free[Math.floor(Math.random() * free.length)]!;
    await menu(s.page).filter({ hasText: title }).first().click();
    // The student autocomplete re-searches with the picked title and keeps its menu open.
    if (await s.page.locator('.v-menu.v-overlay--active').count())
      await s.page.keyboard.press('Escape');
    await expect(s.page.locator('.v-menu.v-overlay--active')).toHaveCount(0);
    await pick(d, 'Room', /101/);
    await pick(d, 'Mess plan (optional)', plan);
    await fill(d, 'From', isoDate(0));
    await saveDialog(s, 'Allocate');
    resident = title.replace(/\s*\(.*$/, '');
    admNo = /\(([^)]+)\)/.exec(title)?.[1] ?? '';
    expect(resident, 'a student could be allocated').not.toBe('');
    await expectRow(s.page, resident);
    await expectClean(s, mark, 'allocation');
  });

  test('requests an out-pass for the resident', async () => {
    const s = session();
    await s.page.getByRole('tab', { name: 'Out-passes' }).click();
    await s.settle();
    const mark = s.mark();
    await s.page.getByRole('button', { name: 'New out-pass' }).click();
    const d = dialog(s.page);
    await pick(d, 'Resident student', admNo, admNo);
    await fill(d, 'From *', `${isoDate(1)}T10:00`);
    await fill(d, 'To *', `${isoDate(1)}T18:00`);
    await fill(d, 'Reason *', reason);
    await saveDialog(s);
    await expect(s.page.locator('tbody tr').filter({ hasText: reason })).toContainText('PENDING');
    await expectClean(s, mark, 'out-pass request');
  });
});

// Maker-checker: the requester may not decide their own out-pass, so the warden approves.
test.describe('Hostel · warden@greenwood.demo', () => {
  const session = signedIn('warden@greenwood.demo');
  test('approves the out-pass', async () => {
    const s = session();
    await s.go('/institution/hostel/outpasses');
    const mark = s.mark();
    const row = s.page.locator('tbody tr').filter({ hasText: reason });
    await row.getByRole('button', { name: 'Approve' }).click();
    await s.settle();
    await expect(row).toContainText('APPROVED');
    await expectClean(s, mark, 'out-pass approve');
  });
});

test.describe('Hostel · hostel@greenwood.demo (gate & tickets)', () => {
  const session = signedIn('hostel@greenwood.demo');
  test('checks the resident out and back in', async () => {
    const s = session();
    await s.go('/institution/hostel/outpasses');
    const mark = s.mark();
    const row = s.page.locator('tbody tr').filter({ hasText: reason });
    for (const [button, status] of [
      ['Check out', 'OUT'],
      ['Mark returned', 'RETURNED'],
    ] as const) {
      await row.getByRole('button', { name: button }).click();
      await s.settle();
      await expect(row).toContainText(status);
    }
    await expectClean(s, mark, 'out-pass gate');
  });

  test('complaint ticket: create → start → resolve', async () => {
    const s = session();
    await s.page.getByRole('tab', { name: 'Complaints' }).click();
    await s.settle();
    const mark = s.mark();
    const title = `E2E fan not working ${code}`;
    await s.page.getByRole('button', { name: 'New ticket' }).click();
    const d = dialog(s.page);
    await pick(d, 'Hostel', code);
    await fill(d, 'Title *', title);
    await saveDialog(s);
    const row = s.page.locator('tbody tr').filter({ hasText: title });
    await expect(row).toContainText('OPEN');
    await row.getByRole('button', { name: 'Start' }).click();
    await s.settle();
    await expect(row).toContainText('IN_PROGRESS');
    await row.getByRole('button', { name: 'Resolve' }).click();
    await s.settle();
    await expect(row).toContainText('RESOLVED');
    await expectClean(s, mark, 'complaint');
  });

  test('vacates the allocation', async () => {
    const s = session();
    await s.page.getByRole('tab', { name: 'Allocations' }).click();
    await s.settle();
    const mark = s.mark();
    const row = s.page.locator('tbody tr').filter({ hasText: admNo }).filter({ hasText: code });
    await row.getByRole('button', { name: 'Vacate' }).click();
    await s.settle();
    await expect(row.filter({ hasText: 'ACTIVE' })).toHaveCount(0);
    await expectClean(s, mark, 'vacate');
  });
});

import { expect, test, type Page } from '@playwright/test';
import type { AppSession } from '../../src/app';
import { signedIn } from '../../src/session';
import { expectClean } from '../../src/ui';

/**
 * Home dashboard highlights (upcoming holidays, leave, birthdays, work anniversaries, new joiners)
 * on the employee home and the HR dashboard. Each card must render what
 * GET /employees/highlights returned (or its empty-state text).
 */

interface Person {
  name: string;
}
interface Highlights {
  upcomingHolidays: Array<{ name: string }>;
  birthdays: Person[];
  workAnniversaries: Person[];
  newJoiners: Person[];
}

const cardTitle = (page: Page, title: string) =>
  page.locator('.v-card-title', { hasText: new RegExp(`^\\s*${title}\\s*$`) });
/** Highlights cards live in one row (the dashboard has its own "Leave" card elsewhere). */
const card = (page: Page, title: string) =>
  page
    .locator('.v-row')
    .filter({ has: cardTitle(page, 'Upcoming holidays') })
    .last()
    .locator('.v-card')
    .filter({ has: cardTitle(page, title) });

async function openWithHighlights(s: AppSession, path: string): Promise<Highlights> {
  const [res] = await Promise.all([
    s.page.waitForResponse(
      (r) => r.url().includes('/api/v1/employees/highlights') && r.request().method() === 'GET',
    ),
    s.go(path),
  ]);
  expect(res.status(), 'highlights').toBe(200);
  return ((await res.json()) as { data: Highlights }).data;
}

async function expectHighlights(s: AppSession, data: Highlights) {
  const holidays = card(s.page, 'Upcoming holidays');
  await expect(holidays).toBeVisible();
  if (data.upcomingHolidays.length) {
    await expect(holidays).toContainText(data.upcomingHolidays[0]!.name);
  } else {
    await expect(holidays).toContainText('No upcoming holidays');
  }
  await expect(card(s.page, 'Leave')).toBeVisible();
  const people: Array<[string, Person[], string]> = [
    ['Birthdays', data.birthdays, 'No birthdays in the next 30 days'],
    ['Work anniversaries', data.workAnniversaries, 'No work anniversaries in the next 30 days'],
    ['New joiners', data.newJoiners, 'No new joiners in the last 30 days'],
  ];
  for (const [title, items, empty] of people) {
    const c = card(s.page, title);
    await expect(c, title).toBeVisible();
    await expect(c, title).toContainText(items.length ? items[0]!.name : empty);
  }
}

test.describe('Home widgets · employee@greenwood.demo', () => {
  const session = signedIn('employee@greenwood.demo');

  test('employee home shows the highlights cards', async () => {
    const s = session();
    const mark = s.mark();
    const data = await openWithHighlights(s, '/employee');
    await expect(s.page.getByRole('heading', { name: /^Welcome, / })).toBeVisible();
    await expectHighlights(s, data);
    await expectClean(s, mark, 'employee home highlights');
  });
});

test.describe('Home widgets · hr@greenwood.demo', () => {
  const session = signedIn('hr@greenwood.demo');

  test('HR dashboard shows the highlights cards', async () => {
    const s = session();
    const mark = s.mark();
    const data = await openWithHighlights(s, '/hr');
    await expect(s.page.getByRole('heading', { name: 'HR dashboard' })).toBeVisible();
    // HR sees its whole institution: the seeded staff always has someone to show.
    expect(
      data.upcomingHolidays.length +
        data.birthdays.length +
        data.workAnniversaries.length +
        data.newJoiners.length,
    ).toBeGreaterThan(0);
    await expectHighlights(s, data);
    await expectClean(s, mark, 'hr dashboard highlights');
  });
});

test.describe('Home widgets · hr@acme.demo (company)', () => {
  const session = signedIn('hr@acme.demo');

  test('company HR dashboard shows the highlights cards', async () => {
    const s = session();
    const mark = s.mark();
    const data = await openWithHighlights(s, '/hr');
    await expectHighlights(s, data);
    await expectClean(s, mark, 'company hr highlights');
  });
});

test.describe('Home widgets · student@greenwood.demo (no employee record)', () => {
  const session = signedIn('student@greenwood.demo');

  test('employee home without an employee record shows no highlights', async () => {
    const s = session();
    const mark = s.mark();
    await s.go('/employee');
    await expect(s.page.getByRole('heading', { name: /^Welcome, / })).toBeVisible();
    await expect(card(s.page, 'Upcoming holidays')).toHaveCount(0);
    await expect(card(s.page, 'Birthdays')).toHaveCount(0);
    expect(s.calls.slice(mark).filter((c) => c.path.includes('/employees/highlights'))).toEqual([]);
  });
});

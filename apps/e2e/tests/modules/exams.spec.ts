import { expect, test } from '@playwright/test';
import { signedIn } from '../../src/session';
import {
  dialog,
  expectClean,
  expectDownload,
  fill,
  isoDate,
  pick,
  saveDialog,
  uniq,
} from '../../src/ui';

/**
 * Exam lifecycle across roles: the principal creates a term and schedules Grade 1-A's first
 * paper (taught by teacher@), the teacher enters + locks marks, the principal computes and
 * publishes, downloads a report card, and the student sees the published result.
 */
const term = `E2E Unit Test ${uniq('T')}`;
// The role hand-offs below depend on each other: keep the whole file on one worker, in order.
test.describe.configure({ mode: 'serial' });

test.describe('Exams · principal schedules', () => {
  test.describe.configure({ mode: 'serial' });
  const session = signedIn('principal@greenwood.demo');

  test('creates an exam term', async () => {
    const s = session();
    await s.go('/institution/exams');
    const mark = s.mark();
    await s.page.getByRole('button', { name: 'Exam term' }).click();
    const d = dialog(s.page);
    await fill(d, 'Name', term);
    await fill(d, 'Start date', isoDate(0));
    await fill(d, 'End date', isoDate(7));
    await saveDialog(s, 'Create');
    await expect(s.page.locator('tbody tr').filter({ hasText: term })).toBeVisible();
    await expectClean(s, mark, 'term create');
  });

  test('schedules the first Grade 1-A paper', async () => {
    const s = session();
    const mark = s.mark();
    await s.page.locator('tbody tr').filter({ hasText: term }).click();
    await pick(s.page, 'Class section schedule', /Grade 1.*A/);
    await s.settle();
    const paper = s.page.locator('.v-card tbody tr').first();
    await paper.locator('input[type=checkbox]').check();
    await s.page.getByRole('button', { name: 'Save schedule' }).click();
    await s.settle();
    await expect(s.page.getByText('Exam schedule saved')).toBeVisible();
    await expect(paper.locator('.v-chip')).toBeVisible();
    await expectClean(s, mark, 'schedule save');
  });
});

test.describe('Exams · teacher enters marks', () => {
  test.describe.configure({ mode: 'serial' });
  const session = signedIn('teacher@greenwood.demo');

  test('enters, saves and locks marks for the paper', async () => {
    const s = session();
    await s.go('/institution/marks-entry');
    const mark = s.mark();
    s.page.on('dialog', (d) => void d.accept());
    await pick(s.page, 'Exam term', term);
    await s.settle();
    await pick(s.page, 'Paper (section · subject)', /Grade 1.*A/);
    await s.settle();
    const inputs = s.page.locator('tbody tr td:nth-child(3) input');
    const n = await inputs.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) await inputs.nth(i).fill(String(40 + ((i * 7) % 60)));
    await s.page.getByRole('button', { name: 'Save marks' }).click();
    await s.settle();
    await expect(s.page.getByText(`Entered ${n}/${n}`)).toBeVisible();
    await s.page.getByRole('button', { name: 'Lock' }).click();
    await s.settle();
    await expect(s.page.locator('.v-chip').filter({ hasText: 'LOCKED' })).toBeVisible();
    await expectClean(s, mark, 'marks entry');
  });
});

test.describe('Exams · principal computes & publishes', () => {
  test.describe.configure({ mode: 'serial' });
  const session = signedIn('principal@greenwood.demo');

  test('computes and publishes results', async () => {
    const s = session();
    await s.go('/institution/exams');
    const mark = s.mark();
    s.page.on('dialog', (d) => void d.accept());
    await s.page.locator('tbody tr').filter({ hasText: term }).click();
    await s.page.getByRole('button', { name: 'Compute results' }).click();
    await s.settle();
    await expect(s.page.getByText(/Results computed for \d+ students/)).toBeVisible();
    await s.page.getByRole('button', { name: 'Publish' }).click();
    await s.settle();
    await expect(s.page.getByText('Results published')).toBeVisible();
    await expect(s.page.locator('tbody tr').filter({ hasText: term })).toContainText('PUBLISHED');
    await expectClean(s, mark, 'compute/publish');
  });

  test('downloads a report card PDF', async () => {
    const s = session();
    await s.go('/institution/report-cards');
    const mark = s.mark();
    await pick(s.page, 'Exam term', term);
    await pick(s.page, 'Class section', /Grade 1.*A/);
    await s.settle();
    const row = s.page.locator('tbody tr').first();
    await expect(row).toContainText(/PASS|FAIL/);
    await expectDownload(s.page, () => row.getByRole('button').last().click());
    await expectClean(s, mark, 'report card');
  });
});

test.describe('Exams · student sees the published result', () => {
  const session = signedIn('student@greenwood.demo');
  test('portal results list the term', async () => {
    const s = session();
    const mark = s.mark();
    await s.go('/portal/results');
    await expect(s.page.getByText(term).first()).toBeVisible();
    await expectClean(s, mark, 'portal results');
  });
});

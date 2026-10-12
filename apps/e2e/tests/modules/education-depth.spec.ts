import { expect, test } from '@playwright/test';
import { BLOCKED_PATHS } from '../../src/app';
import type { AppSession } from '../../src/app';
import { signedIn } from '../../src/session';
import {
  dialog,
  expectClean,
  expectDownload,
  expectRow,
  expectRows,
  fill,
  pick,
  rows,
  saveDialog,
  uniq,
} from '../../src/ui';

/**
 * Education depth beyond the basic module flows (Greenwood):
 * - student lifecycle: the registrar withdraws / graduates fresh students (enrollment history shows
 *   the class name, the status filter finds them, lifecycle buttons disappear); a teacher gets no
 *   lifecycle or guardian controls;
 * - group workspace: the group admin lists students / admissions / results / report cards across
 *   the trust's institutions and stays inside /group when drilling into a student;
 * - exams: the principal jumps from a published term to its results and adds a grading scale; a
 *   teacher sees results but no term, scale, compute or publish controls;
 * - timetable: the teacher's own timetable and the student's weekly grid show real periods.
 */
test.describe.configure({ mode: 'serial' });
const id = uniq('ED').replace(/-/g, '');
const leaver = `Leaver${id}`;
const graduate = `Graduate${id}`;
const scale = `E2E Scale ${id}`;
const AARAV = 'GWIS-MAIN-2026-0001';
const BRANCH_STUDENT = 'GWIS-BR-2026-0001';
const UNIT_TEST = /^Unit Test 1 \(PUBLISHED\)$/;

/** Creates a Grade 2-B student from the register and lands on the new profile. */
async function createStudent(s: AppSession, first: string) {
  await s.go('/institution/students');
  await s.page.getByRole('button', { name: 'New student' }).click();
  const d = dialog(s.page);
  await fill(d, 'First name', first);
  await fill(d, 'Last name', 'E2E');
  await pick(d, 'Class section', /Grade 2.*B/, 'Grade 2');
  // Roll numbers are unique per section: pick a random one so re-runs don't collide.
  await fill(d, 'Roll no', String(100 + Math.floor(Math.random() * 9000)));
  await saveDialog(s, 'Create');
  await expect(s.page).toHaveURL(/\/institution\/students\/[0-9a-f-]{36}/);
  await expect(s.page.getByRole('heading', { name: new RegExp(first) })).toBeVisible();
}

/** The seeded, published "Unit Test 1" term on the exams page. */
const unitTestRow = (s: AppSession) =>
  rows(s.page)
    .filter({ has: s.page.locator('td:first-child', { hasText: /^\s*Unit Test 1\s*$/ }) })
    .first();

/** Value of a labelled field in the profile card (rendered as "<strong>Label</strong><br>value"). */
const profileField = (s: AppSession, label: string) =>
  s.page.locator('strong', { hasText: new RegExp(`^${label}$`) }).locator('..');

test.describe('Education depth · registrar@greenwood.demo (student lifecycle)', () => {
  const session = signedIn('registrar@greenwood.demo');

  test('withdraws a student: status, history and lifecycle buttons update', async () => {
    const s = session();
    const mark = s.mark();
    await createStudent(s, leaver);
    await expect(profileField(s, 'Status')).toContainText('ACTIVE');
    // Enrollment history names the class instead of showing a raw section id.
    await s.page.getByRole('tab', { name: 'Enrollment history' }).click();
    const enrollment = s.page.locator('.v-window-item--active tbody tr').first();
    await expect(enrollment).toContainText(/Grade 2 - B/);
    await expect(enrollment).not.toContainText(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    await s.page.getByRole('tab', { name: 'Profile' }).click();
    await s.page.getByRole('button', { name: /^Withdraw$/i }).click();
    await s.settle();
    await expect(profileField(s, 'Status')).toContainText('WITHDRAWN');
    // A withdrawn student can no longer be withdrawn again or graduated.
    await expect(s.page.getByRole('button', { name: /^Withdraw$/i })).toHaveCount(0);
    await expect(s.page.getByRole('button', { name: /^Graduate$/i })).toHaveCount(0);
    await expectClean(s, mark, 'withdraw');
  });

  test('graduates another student', async () => {
    const s = session();
    const mark = s.mark();
    await createStudent(s, graduate);
    await s.page.getByRole('button', { name: /^Graduate$/i }).click();
    await s.settle();
    await expect(profileField(s, 'Status')).toContainText('GRADUATED');
    await expect(s.page.getByRole('button', { name: /^Withdraw$/i })).toHaveCount(0);
    await expectClean(s, mark, 'graduate');
  });

  test('the status filter lists withdrawn and graduated students', async () => {
    const s = session();
    await s.go('/institution/students');
    const mark = s.mark();
    for (const [status, name, other] of [
      ['WITHDRAWN', leaver, graduate],
      ['GRADUATED', graduate, leaver],
    ] as const) {
      await pick(s.page, 'Status', new RegExp(`^${status}$`));
      await fill(s.page, 'Search', id);
      await s.settle();
      const row = rows(s.page).filter({ hasText: name });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(status);
      await expect(rows(s.page).filter({ hasText: other })).toHaveCount(0);
    }
    await expectClean(s, mark, 'status filter');
  });
});

test.describe('Education depth · teacher@greenwood.demo (no lifecycle rights)', () => {
  const session = signedIn('teacher@greenwood.demo');

  test('a student profile shows no lifecycle or guardian controls', async () => {
    const s = session();
    await s.go('/institution/students');
    const mark = s.mark();
    await expect(s.page.getByRole('button', { name: 'New student' })).toHaveCount(0);
    await expectRows(s.page);
    await rows(s.page).first().click();
    await expect(s.page).toHaveURL(/\/institution\/students\/[0-9a-f-]{36}/);
    await expect(s.page.getByRole('tab', { name: 'Guardians' })).toBeVisible();
    await expect(s.page.getByRole('button', { name: /^(Withdraw|Graduate)$/i })).toHaveCount(0);
    await s.page.getByRole('tab', { name: 'Guardians' }).click();
    await expect(s.page.getByRole('button', { name: /Add guardian/i })).toHaveCount(0);
    await expectClean(s, mark, 'teacher student profile');
  });

  test('exams: no term, grading-scale, compute or publish controls', async () => {
    const s = session();
    await s.go('/institution/exams');
    const mark = s.mark();
    await expectRows(s.page);
    await expect(s.page.getByRole('button', { name: /Exam term/i })).toHaveCount(0);
    await expect(s.page.getByRole('button', { name: /Grading scale/i })).toHaveCount(0);
    await unitTestRow(s).click();
    await expect(s.page.getByRole('main').getByRole('link', { name: /^Results$/i })).toBeVisible();
    await expect(s.page.getByRole('button', { name: /Compute results/i })).toHaveCount(0);
    await expect(s.page.getByRole('button', { name: /^Publish$/i })).toHaveCount(0);
    await expect(s.page.getByRole('button', { name: /Save schedule/i })).toHaveCount(0);
    await expectClean(s, mark, 'teacher exams');
  });

  test('the teacher’s own timetable lists their periods', async () => {
    const s = session();
    await s.go('/institution/my-classes');
    const mark = s.mark();
    const card = s.page
      .locator('.v-card')
      .filter({ hasText: /students ·/ })
      .first();
    await expect(card).toBeVisible();
    await card.getByRole('link', { name: /Timetable/i }).click();
    await expect(s.page).toHaveURL(/\/institution\/timetable$/);
    await expect(s.page.getByRole('tab', { name: 'My timetable' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await s.settle();
    const grid = s.page.locator('.v-window-item--active .timetable-grid');
    await expect(grid.locator('thead th').nth(1)).toBeVisible();
    // Every lesson cell of the teacher's own grid names the teacher.
    await expect(grid.locator('tbody td').filter({ hasText: 'Priya Nair' }).first()).toBeVisible();
    await expect(
      grid
        .locator('tbody td')
        .filter({ hasText: /Grade \d - [AB]/ })
        .first(),
    ).toBeVisible();
    await expectClean(s, mark, 'my timetable');
  });
});

test.describe('Education depth · group.admin@greenwood.demo (group views)', () => {
  const session = signedIn('group.admin@greenwood.demo');

  test('group students span institutions and open inside the group workspace', async () => {
    const s = session();
    await s.go('/group/students');
    const mark = s.mark();
    for (const adm of [BRANCH_STUDENT, AARAV]) {
      await fill(s.page, 'Search', adm);
      await s.settle();
      await expectRow(s.page, adm);
    }
    await rows(s.page).filter({ hasText: AARAV }).first().click();
    await expect(s.page).toHaveURL(/\/group\/students\/[0-9a-f-]{36}$/);
    await expect(s.page.getByRole('heading', { name: /Aarav/ })).toBeVisible();
    await expect(s.page.getByText(AARAV)).toBeVisible();
    await expectClean(s, mark, 'group students');
  });

  test('group admissions list applications and link enrolled students in /group', async () => {
    const s = session();
    await s.go('/group/admissions');
    const mark = s.mark();
    await expectRows(s.page);
    await pick(s.page, 'Status', /^Enrolled$|^ENROLLED$/);
    await s.settle();
    await expectRows(s.page);
    await rows(s.page)
      .first()
      .getByRole('link', { name: /View student/i })
      .click();
    await expect(s.page).toHaveURL(/\/group\/students\/[0-9a-f-]{36}$/);
    await expect(s.page.locator('h2.text-h5')).toBeVisible();
    await expectClean(s, mark, 'group admissions');
  });

  test('group results show a published term for a class', async () => {
    const s = session();
    await s.go('/group/results');
    const mark = s.mark();
    await pick(s.page, 'Exam term', UNIT_TEST);
    await pick(s.page, 'Class section', /^Grade 1 - A$/);
    await s.settle();
    const row = rows(s.page).filter({ hasText: /Aarav/ });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('B2');
    await expect(row).toContainText(/PASS/i);
    await expectClean(s, mark, 'group results');
  });

  test('group report cards download for the class', async () => {
    const s = session();
    await s.go('/group/report-cards');
    const mark = s.mark();
    await expect(s.page.getByRole('heading', { name: 'Report cards' })).toBeVisible();
    await pick(s.page, 'Exam term', UNIT_TEST);
    await pick(s.page, 'Class section', /^Grade 1 - A$/);
    await s.settle();
    await expect(s.page.getByRole('button', { name: /All PDFs/i })).toBeVisible();
    const row = rows(s.page).filter({ hasText: /Aarav/ });
    await expectDownload(s.page, () => row.getByRole('button').last().click());
    await expectClean(s, mark, 'group report cards');
  });

  test('group student attendance opens for a class', async () => {
    const s = session();
    await s.go('/group/student-attendance');
    const mark = s.mark();
    await expect(s.page.getByRole('heading', { name: 'Student attendance' })).toBeVisible();
    await pick(s.page, 'Class section', /Grade 1 - A/);
    await s.settle();
    await expectRows(s.page);
    await expectClean(s, mark, 'group student attendance');
  });
});

test.describe('Education depth · principal@greenwood.demo (results & grading)', () => {
  const session = signedIn('principal@greenwood.demo');

  test('jumps from a published term to its results', async () => {
    const s = session();
    await s.go('/institution/exams');
    const mark = s.mark();
    await unitTestRow(s).click();
    // Already published: publishing again is not offered.
    await expect(s.page.getByRole('button', { name: /^Publish$/i })).toBeDisabled();
    await s.page
      .getByRole('main')
      .getByRole('link', { name: /^Results$/i })
      .click();
    await expect(s.page).toHaveURL(/\/institution\/results\?termId=[0-9a-f-]{36}/);
    await expect(s.page.getByRole('heading', { name: 'Results' })).toBeVisible();
    await expect(s.page.locator('.v-select').filter({ hasText: 'Exam term' })).toContainText(
      'Unit Test 1 (PUBLISHED)',
    );
    await pick(s.page, 'Class section', /^Grade 1 - A$/);
    await s.settle();
    await expectRows(s.page, 2);
    const first = rows(s.page).first();
    await expect(first.locator('td').first()).toHaveText('1');
    await expect(rows(s.page).filter({ hasText: /Aarav/ })).toContainText('B2');
    await expectClean(s, mark, 'term → results');
  });

  test('adds a non-default grading scale', async () => {
    const s = session();
    await s.go('/institution/exams');
    const mark = s.mark();
    await s.page.getByRole('button', { name: /Grading scale/i }).click();
    const d = dialog(s.page);
    await fill(d, 'Name', scale);
    // The form pre-ticks "default"; untick so the demo institution's default scale is kept.
    await d.getByLabel('Default for the institution').uncheck();
    await expect(d.getByLabel('Default for the institution')).not.toBeChecked();
    await saveDialog(s, 'Create');
    await expect(s.page.locator('.v-chip').filter({ hasText: scale })).toBeVisible();
    await expect(s.page.locator('.v-chip').filter({ hasText: scale })).not.toContainText(
      '(default)',
    );
    await expectClean(s, mark, 'grading scale');
  });
});

test.describe('Education depth · student@greenwood.demo (timetable)', () => {
  const session = signedIn('student@greenwood.demo');

  test('the weekly timetable shows periods with subjects', async () => {
    const s = session();
    await s.go('/portal/timetable');
    const mark = s.mark();
    await expect(s.page.getByRole('heading', { name: /Timetable/ })).toContainText('Aarav');
    await expect(s.page.getByText('Weekly timetable')).toBeVisible();
    const weekly = s.page.locator('.timetable-grid').last();
    await expect(weekly.locator('thead th').nth(1)).toBeVisible();
    await expect(weekly.locator('tbody th').filter({ hasText: /^Mon$/ })).toBeVisible();
    await expect(
      weekly
        .locator('tbody td')
        .filter({ hasText: /Mathematics|English|Hindi/ })
        .first(),
    ).toBeVisible();
    await expectClean(s, mark, 'student timetable');
  });

  test('staff timetable and results pages stay closed to the student', async () => {
    const s = session();
    for (const path of ['/institution/timetable', '/institution/results', '/group/results']) {
      await s.go(path);
      expect(BLOCKED_PATHS, path).toContain(s.pathname());
    }
  });
});

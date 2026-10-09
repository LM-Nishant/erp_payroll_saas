import { expect, test } from '@playwright/test';
import { signedIn } from '../../src/session';
import { dialog, expectClean, fill, pick, saveDialog, uniq } from '../../src/ui';

/** Admissions pipeline (apply → review → approve → enroll) and the student register. */
test.describe('Admissions & students · registrar@greenwood.demo', () => {
  test.describe.configure({ mode: 'serial' });
  const session = signedIn('registrar@greenwood.demo');
  const applicant = uniq('Applicant').replace(/-/g, '');
  const student = uniq('Pupil').replace(/-/g, '');

  const appRow = () => session().page.locator('tbody tr').filter({ hasText: applicant });

  test('creates an admission application', async () => {
    const s = session();
    await s.go('/institution/admissions');
    const mark = s.mark();
    await s.page.getByRole('button', { name: 'New application' }).click();
    const d = dialog(s.page);
    await pick(d, 'Program', /^Grade 3/, 'Grade 3');
    await pick(d, 'Desired class', /Grade 3.*A/, 'Grade 3');
    await fill(d, 'Applicant first name', applicant);
    await fill(d, 'Applicant last name', 'E2E');
    await fill(d, 'Guardian name', `Guardian ${applicant}`);
    await fill(d, 'Guardian phone', '9876543210');
    await saveDialog(s, 'Create');
    await pick(s.page, 'Status', 'SUBMITTED');
    await s.settle();
    await expect(appRow()).toBeVisible();
    await expectClean(s, mark, 'admission create');
  });

  test('reviews, approves and enrolls the applicant', async () => {
    const s = session();
    const mark = s.mark();
    await appRow().getByRole('button', { name: 'Review' }).click();
    await s.settle();
    await pick(s.page, 'Status', 'UNDER_REVIEW');
    await s.settle();
    await appRow().getByRole('button', { name: 'Approve' }).click();
    await s.settle();
    await pick(s.page, 'Status', 'APPROVED');
    await s.settle();
    await appRow().getByRole('button', { name: 'Enroll' }).click();
    await saveDialog(s, 'Enroll');
    await pick(s.page, 'Status', 'ENROLLED');
    await s.settle();
    await expect(appRow()).toContainText('ENROLLED');
    await expectClean(s, mark, 'admission pipeline');
  });

  test('the enrolled applicant appears in the student register', async () => {
    const s = session();
    await s.go('/institution/students');
    const mark = s.mark();
    await fill(s.page, 'Search', applicant);
    await s.settle();
    await expect(s.page.locator('tbody tr').filter({ hasText: applicant })).toBeVisible();
    await expectClean(s, mark, 'student search');
  });

  test('creates a student directly and opens the profile', async () => {
    const s = session();
    await s.go('/institution/students');
    const mark = s.mark();
    await s.page.getByRole('button', { name: 'New student' }).click();
    const d = dialog(s.page);
    await fill(d, 'First name', student);
    await fill(d, 'Last name', 'E2E');
    await pick(d, 'Class section', /Grade 2.*B/, 'Grade 2');
    // Roll numbers are unique per section: pick a random one so re-runs don't collide.
    await fill(d, 'Roll no', String(100 + Math.floor(Math.random() * 9000)));
    await saveDialog(s, 'Create');
    await expect(s.page).toHaveURL(/\/students\/[0-9a-f-]{36}/);
    await expect(s.page.getByText(student).first()).toBeVisible();
    await expectClean(s, mark, 'student create');
  });

  test('adds a guardian on the student profile', async () => {
    const s = session();
    const mark = s.mark();
    await s.page.getByRole('tab', { name: 'Guardians' }).click();
    await s.page.getByRole('button', { name: 'Add guardian' }).click();
    const d = dialog(s.page);
    await fill(d, 'Name', `Parent ${student}`);
    await fill(d, 'Phone', '9123456780');
    await saveDialog(s);
    await expect(s.page.getByText(`Parent ${student}`)).toBeVisible();
    await expectClean(s, mark, 'guardian add');
  });
});

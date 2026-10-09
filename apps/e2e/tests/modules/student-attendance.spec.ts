import { expect, test } from '@playwright/test';
import { signedIn } from '../../src/session';
import { expectClean, fill, pick } from '../../src/ui';

/** The class teacher marks daily attendance for Grade 1-A and reads it back in the register. */
test.describe('Student attendance · teacher@greenwood.demo', () => {
  test.describe.configure({ mode: 'serial' });
  const session = signedIn('teacher@greenwood.demo');
  const today = new Date().toISOString().slice(0, 10);

  test('marks the section present with one absentee and saves', async () => {
    const s = session();
    await s.go('/institution/student-attendance');
    const mark = s.mark();
    await pick(s.page, 'Class section', /Grade 1.*A/);
    await s.settle();
    await fill(s.page, 'Date', today);
    await s.settle();
    await s.page.getByRole('button', { name: 'All present' }).click();
    const first = s.page.locator('tbody tr').first();
    await first.getByRole('button', { name: 'A', exact: true }).click();
    await s.page.getByRole('button', { name: 'Save attendance' }).click();
    await s.settle();
    await expect(s.page.getByText('Attendance saved')).toBeVisible();
    await expect(s.page.getByText(/ABSENT: 1/)).toBeVisible();
    await expectClean(s, mark, 'attendance save');
  });

  test('the monthly register shows today', async () => {
    const s = session();
    const mark = s.mark();
    await s.page.getByRole('tab', { name: 'Monthly register' }).click();
    await fill(s.page, 'Month', today.slice(0, 7));
    await s.settle();
    const register = s.page.locator('.v-window-item--active tbody tr');
    await expect(register.first()).toBeVisible();
    await expect(register.first().locator('td').last()).toContainText('%');
    await expectClean(s, mark, 'register');
  });
});

/** Students see their own attendance in the portal. */
test.describe('Student attendance · student@greenwood.demo', () => {
  const session = signedIn('student@greenwood.demo');
  test('portal attendance page lists days', async () => {
    const s = session();
    const mark = s.mark();
    await s.go('/portal/attendance');
    await expect(s.page.getByText(/%/).first()).toBeVisible();
    await expectClean(s, mark, 'portal attendance');
  });
});

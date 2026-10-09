import { expect, test } from '@playwright/test';
import { signedIn } from '../../src/session';
import { expectClean, expectDownload, expectSignedPdf, rows } from '../../src/ui';

/**
 * Self-service (Greenwood): an employee sees their own profile, salary, payslips and attendance
 * (punching requires a selfie face match); a student and a parent see their own portal data.
 */
test.describe.configure({ mode: 'serial' });

test.describe('Self-service · employee@greenwood.demo', () => {
  const session = signedIn('employee@greenwood.demo');

  test('sees own profile', async () => {
    const s = session();
    await s.go('/employee/profile');
    const mark = s.mark();
    await expect(s.page.getByRole('heading', { name: 'My profile' })).toBeVisible();
    await expect(s.page.getByText('GWIS-MAIN-0021').first()).toBeVisible();
    await expectClean(s, mark, 'my profile');
  });

  test('downloads own salary statement', async () => {
    const s = session();
    await s.go('/employee/salary');
    const mark = s.mark();
    await expect(s.page.getByRole('tab', { name: 'Salary structure' })).toBeVisible();
    await expectDownload(s.page, () =>
      s.page.getByRole('button', { name: 'Download PDF' }).first().click(),
    );
    await s.page.getByRole('tab', { name: 'Annual statement' }).click();
    await s.settle();
    await expectClean(s, mark, 'my salary');
  });

  test('downloads a payslip', async () => {
    const s = session();
    await s.go('/employee/payslips');
    const mark = s.mark();
    const payslips = s.page.locator('.v-card').filter({ hasText: 'Payslips' }).first();
    await expect(rows(payslips).first()).toBeVisible();
    await expectSignedPdf(s.page, () =>
      rows(payslips).first().getByRole('button', { name: 'PDF' }).click(),
    );
    await expectClean(s, mark, 'my payslips');
  });

  test('punching asks for a selfie instead of punching directly', async () => {
    const s = session();
    await s.go('/employee/attendance');
    const mark = s.mark();
    await s.page.getByRole('button', { name: /^Punch (in|out)$/ }).click();
    await s.settle();
    const selfieDialog = s.page.locator('.v-overlay--active .v-card').filter({
      hasText: /Selfie punch (in|out)/,
    });
    const photoHint = s.page.getByText('Selfie attendance is enabled');
    await expect(selfieDialog.or(photoHint).first()).toBeVisible();
    expect(
      s.calls
        .slice(mark)
        .filter((c) => c.method === 'POST' && c.path.includes('/attendance/me/punch')),
      'no punch without a selfie',
    ).toEqual([]);
    if (await selfieDialog.count()) await s.page.keyboard.press('Escape');
  });

  test.fixme('punches in with a matching selfie', async () => {
    // Not automatable without changing demo data: face match is ON in the demo attendance
    // policies and the browser computes the face descriptor from a live camera frame (no selfie
    // is uploaded), so headless Chromium has no enrolled face to match. Toggling the shared
    // policy off would change the demo for everyone.
  });
});

test.describe('Self-service · student@greenwood.demo', () => {
  const session = signedIn('student@greenwood.demo');

  test('sees own profile, timetable, results and fees', async () => {
    const s = session();
    await s.go('/portal/profile');
    const mark = s.mark();
    await expect(s.page.getByText('Aarav Sharma').first()).toBeVisible();
    await expect(s.page.getByText('Admission no').first()).toBeVisible();
    for (const path of ['/portal/timetable', '/portal/results', '/portal/fees']) {
      await s.go(path);
      await s.settle();
    }
    await expectClean(s, mark, 'student portal');
  });
});

test.describe('Self-service · parent@greenwood.demo', () => {
  const session = signedIn('parent@greenwood.demo');

  test('sees their child and the child fees', async () => {
    const s = session();
    await s.go('/portal/wards');
    const mark = s.mark();
    await expect(s.page.getByRole('heading', { name: 'My children' })).toBeVisible();
    await expect(
      s.page.locator('.v-card').filter({ hasText: 'Aarav Sharma' }).first(),
    ).toBeVisible();
    await s.go('/portal/attendance');
    await s.settle();
    await expectClean(s, mark, 'parent portal');

    // My fees probes both the student's own record and the guardian's wards; the 404 on
    // /fees/me is the expected "not a student" miss and is absorbed by the page.
    const feesMark = s.mark();
    await s.go('/portal/fees');
    await s.settle();
    await expect(s.page.getByText('Aarav Sharma').first()).toBeVisible();
    await expectClean(s, feesMark, 'parent fees', ['NOT_FOUND']);
  });
});

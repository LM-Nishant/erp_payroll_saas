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

  test('the selfie camera runs a blink + head-turn liveness check before it can punch', async () => {
    const s = session();
    // Pretend a profile photo is enrolled (only the client-side reference lookup is stubbed;
    // the liveness challenge comes from the real API).
    const reference = Array.from({ length: 128 }, (_, i) => Math.sin(i) / 10);
    await s.page.route('**/api/v1/employees/me/face', (r) =>
      r.fulfill({ json: { data: { hasPhoto: true, descriptor: reference } } }),
    );
    try {
      await s.go('/employee/attendance');
      const mark = s.mark();
      await s.page.getByRole('button', { name: /^Punch (in|out)$/ }).click();
      const d = s.page.locator('.v-overlay--active .v-card').filter({
        hasText: /Selfie punch (in|out)/,
      });
      await expect(d).toBeVisible();
      const check = d.getByLabel('Liveness check');
      await expect(check).toBeVisible();
      await expect(check.getByText('Blink your eyes').first()).toBeVisible();
      await expect(check.getByText(/turn your head to your (left|right)/).first()).toBeVisible();
      // The fake camera shows no face: the check can't pass, so capture stays disabled.
      await expect(check.getByText(/No face detected/)).toBeVisible({ timeout: 30_000 });
      await expect(d.getByRole('button', { name: 'Capture & punch' })).toBeDisabled();
      const calls = s.calls.slice(mark).filter((c) => c.method === 'POST');
      expect(calls.filter((c) => c.path.endsWith('/attendance/me/liveness-challenge'))).toEqual([
        expect.objectContaining({ status: 201 }),
      ]);
      expect(calls.filter((c) => c.path.includes('/attendance/me/punch'))).toEqual([]);
      await d.getByRole('button', { name: 'Cancel' }).click();
      await expect(d).toBeHidden();
    } finally {
      await s.page.unroute('**/api/v1/employees/me/face');
    }
  });

  test.fixme('punches in with a matching live selfie', async () => {
    // Needs a real face on camera: the browser computes descriptors and liveness (blink, head
    // turn) from live frames, and the fake Chromium camera only shows a test pattern. The API
    // side (challenge signing, step order, expiry, per-step face match) is covered by
    // attendance-leave.int.test.ts.
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

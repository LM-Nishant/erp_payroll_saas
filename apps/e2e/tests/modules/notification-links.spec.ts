import { expect, test } from '@playwright/test';
import { signedIn } from '../../src/session';
import { rows } from '../../src/ui';

/**
 * Notification / workflow deep links. The API now emits current web paths; links already stored
 * in users' inboxes under older paths are redirected by the router. Each link must land on a real
 * page (not the catch-all redirect to `/`) and pre-select the tab / filter it points at.
 */
const FAKE_ID = '00000000-0000-4000-8000-000000000001';

test.describe('Notification links · hr@greenwood.demo', () => {
  test.describe.configure({ mode: 'serial' });
  const session = signedIn('hr@greenwood.demo');

  test('leave and attendance links open the HR pages on the right tab', async () => {
    const s = session();
    await s.go('/hr/leave/requests');
    await expect(s.page).toHaveURL(/\/hr\/leave$/);
    await expect(s.page.getByRole('tab', { name: 'Requests' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await s.go('/hr/attendance/regularizations');
    await expect(s.page).toHaveURL(/\/hr\/attendance\?tab=regularizations$/);
    await expect(s.page.getByRole('tab', { name: 'Regularizations' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('an employee link can open a specific tab', async () => {
    const s = session();
    await s.go('/hr/employees');
    await s.settle();
    await rows(s.page).first().click();
    await expect(s.page).toHaveURL(/\/hr\/employees\/[0-9a-f-]{36}$/);
    const path = new URL(s.page.url()).pathname;
    await s.go('/hr/employees');
    await s.go(`${path}?tab=movements`);
    await expect(s.page.getByRole('tab', { name: 'Movements' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('document expiry links open the documents page of the current workspace', async () => {
    const s = session();
    await s.go(`/documents?documentId=${FAKE_ID}`);
    await expect(s.page).toHaveURL(/\/hr\/documents$/);
  });
});

test.describe('Notification links · payroll@greenwood.demo', () => {
  test.describe.configure({ mode: 'serial' });
  const session = signedIn('payroll@greenwood.demo');

  test('payroll run and salary revision links open the HR payroll pages', async () => {
    const s = session();
    await s.go(`/payroll/runs/${FAKE_ID}`);
    await expect(s.page).toHaveURL(new RegExp(`/hr/payroll/runs/${FAKE_ID}$`));
    await s.go(`/payroll/revisions/${FAKE_ID}`);
    await expect(s.page).toHaveURL(/\/hr\/payroll\/salary$/);
  });
});

test.describe('Notification links · employee@greenwood.demo', () => {
  test.describe.configure({ mode: 'serial' });
  const session = signedIn('employee@greenwood.demo');

  test('self-service links open the employee workspace', async () => {
    const s = session();
    for (const [link, target] of [
      ['/my/assets', /\/employee\/assets$/],
      [`/payroll/reimbursements/${FAKE_ID}`, /\/employee\/payslips$/],
      ['/me/leave', /\/employee\/leave$/],
      ['/me/employee', /\/employee\/profile$/],
    ] as const) {
      await s.go(link);
      await expect(s.page, link).toHaveURL(target);
    }
  });
});

test.describe('Notification links · teacher@greenwood.demo', () => {
  const session = signedIn('teacher@greenwood.demo');

  test('timetable change links open My classes', async () => {
    const s = session();
    await s.go('/academics/my-classes');
    await expect(s.page).toHaveURL(/\/institution\/my-classes$/);
  });
});

test.describe('Notification links · assets@greenwood.demo', () => {
  test.describe.configure({ mode: 'serial' });
  const session = signedIn('assets@greenwood.demo');

  test('asset links open the register detail', async () => {
    const s = session();
    await s.go(`/assets/${FAKE_ID}`);
    await expect(s.page).toHaveURL(new RegExp(`/assets/register/${FAKE_ID}$`));
  });

  test('maintenance ticket links pre-fill the search', async () => {
    const s = session();
    await s.go('/assets/maintenance?search=MT-E2E');
    await expect(s.page.getByRole('textbox', { name: 'Search ticket / asset' })).toHaveValue(
      'MT-E2E',
    );
    await s.settle();
    expect(
      s.calls.some(
        (c) => c.path.startsWith('/api/v1/assets/maintenance?') && c.path.includes('search=MT-E2E'),
      ),
    ).toBe(true);
  });
});

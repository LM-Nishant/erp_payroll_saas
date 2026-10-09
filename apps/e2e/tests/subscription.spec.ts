import { expect, test, type Page } from '@playwright/test';
import { BLOCKED_PATHS } from '../src/app';
import { signedIn } from '../src/session';
import { expectClean, expectRows } from '../src/ui';

/** Subscription states surface in the UI and gate (or keep) the licensed modules. */
const banner = (page: Page) => page.locator('[data-testid=subscription-banner]').first();

test.describe('Lakeside · PAST_DUE', () => {
  test.describe.configure({ mode: 'serial' });
  const session = signedIn('owner@lakeside.demo');

  test('shows a payment-overdue warning', async () => {
    const s = session();
    await expect(banner(s.page)).toHaveAttribute('data-status', 'PAST_DUE');
    await expect(banner(s.page)).toContainText('Payment overdue');
    await s.go('/institution');
    await expect(banner(s.page)).toHaveAttribute('data-status', 'PAST_DUE');
  });

  test('licensed modules keep working', async () => {
    const s = session();
    const mark = s.mark();
    await s.go('/institution/students');
    expect(BLOCKED_PATHS).not.toContain(s.pathname());
    await expectRows(s.page);
    await expectClean(s, mark, 'students while past due');
  });
});

test.describe('Maple · TRIAL', () => {
  test.describe.configure({ mode: 'serial' });
  const session = signedIn('owner@maple.demo');

  test('shows trial information with the end date', async () => {
    const s = session();
    await expect(banner(s.page)).toHaveAttribute('data-status', 'TRIAL');
    await expect(banner(s.page)).toContainText(/trial/i);
    await expect(banner(s.page)).toContainText(/until \d{2}\/\d{2}\/\d{4}/);
  });

  test('trial modules are usable', async () => {
    const s = session();
    const mark = s.mark();
    await s.go('/hr/employees');
    expect(BLOCKED_PATHS).not.toContain(s.pathname());
    await expectClean(s, mark, 'HR on trial');
  });
});

test.describe('Oldtown · CANCELLED', () => {
  test.describe.configure({ mode: 'serial' });
  const session = signedIn('owner@oldtown.demo');

  test('shows a cancelled error banner and modules are blocked', async () => {
    const s = session();
    await expect(banner(s.page)).toHaveAttribute('data-status', 'CANCELLED');
    await expect(banner(s.page)).toContainText('Subscription cancelled');
    await s.go('/institution/students');
    expect(BLOCKED_PATHS).toContain(s.pathname());
  });
});

test.describe('Greenwood · ACTIVE', () => {
  test.describe.configure({ mode: 'serial' });
  const session = signedIn('owner@greenwood.demo');

  test('shows no subscription banner', async () => {
    const s = session();
    await s.go('/group');
    await expect(s.page.locator('[data-testid=subscription-banner]')).toHaveCount(0);
  });
});

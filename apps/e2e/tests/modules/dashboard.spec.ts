import { expect, test } from '@playwright/test';
import { signedIn } from '../../src/session';
import { expectClean } from '../../src/ui';

/**
 * Overview dashboard: date presets and custom range drive `/dashboard/overview`; each role sees
 * only the KPI cards its permissions allow; portal users get no panel.
 */
test.describe('Dashboard · admin overview', () => {
  const session = signedIn('admin@greenwood.demo');
  test('shows every KPI card and switches date ranges', async () => {
    const s = session();
    await s.go('/institution');
    const mark = s.mark();
    const panel = s.page.getByTestId('overview-panel');
    await expect(panel).toBeVisible();
    for (const kpi of ['fees', 'expenses', 'payroll', 'cashflow', 'students', 'employees']) {
      await expect(s.page.getByTestId(`kpi-${kpi}`)).toBeVisible();
    }
    for (const label of ['Yesterday', 'Tomorrow', 'This week', 'This month', 'Last month']) {
      const res = s.page.waitForResponse((r) => r.url().includes('/dashboard/overview'));
      await panel.getByText(label, { exact: true }).click();
      expect((await res).status()).toBe(200);
    }
    await expect(s.page.getByTestId('overview-trend')).toBeVisible();
    await panel.getByText('Custom', { exact: true }).click();
    await s.page.getByTestId('overview-from').locator('input').fill('2026-10-01');
    await s.page.getByTestId('overview-to').locator('input').fill('2026-10-13');
    const res = s.page.waitForResponse((r) => r.url().includes('from=2026-10-01&to=2026-10-13'));
    await s.page.getByTestId('overview-apply').click();
    expect((await res).status()).toBe(200);
    await expect(panel).toContainText('2026-10-01 → 2026-10-13');
    await expectClean(s, mark);
  });
});

test.describe('Dashboard · role scoping', () => {
  const hr = signedIn('hr@greenwood.demo');
  test('HR sees employees and payroll but no fee cards', async () => {
    const s = hr();
    await s.go('/hr');
    await expect(s.page.getByTestId('kpi-employees')).toBeVisible();
    await expect(s.page.getByTestId('kpi-payroll')).toBeVisible();
    await expect(s.page.getByTestId('kpi-fees')).toHaveCount(0);
    await expect(s.page.getByTestId('kpi-expenses')).toHaveCount(0);
  });

  const accountant = signedIn('accountant@greenwood.demo');
  test('accountant sees fees, expenses and cash flow', async () => {
    const s = accountant();
    await s.go('/institution');
    await expect(s.page.getByTestId('kpi-fees')).toBeVisible();
    await expect(s.page.getByTestId('kpi-cashflow')).toBeVisible();
    await expect(s.page.getByTestId('kpi-employees')).toHaveCount(0);
  });

  const parent = signedIn('parent@greenwood.demo');
  test('parent portal has no overview panel', async () => {
    const s = parent();
    await s.go('/portal');
    await expect(s.page.getByTestId('overview-panel')).toHaveCount(0);
  });
});

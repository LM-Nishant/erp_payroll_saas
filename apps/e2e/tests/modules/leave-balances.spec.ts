import { expect, test } from '@playwright/test';
import { BLOCKED_PATHS } from '../../src/app';
import { signedIn } from '../../src/session';
import { dialog, expectClean, fill, pick, rows, saveDialog, uniq } from '../../src/ui';

/**
 * HR › Leave › Balances & ledger (Greenwood): look up an employee's balances, post a +1 day
 * adjustment, see it in the balance and the ledger, then reverse it (−1) so the seeded balance
 * is unchanged. An employee-only user cannot open the HR leave register.
 */

const EMPLOYEE_CODE = 'GWIS-MAIN-0021'; // employee@greenwood.demo
const id = uniq('LB');

// Later blocks depend on earlier ones (data and locks), so the whole file runs in order.
test.describe.configure({ mode: 'serial' });

test.describe('Leave balances · hr@greenwood.demo', () => {
  test.describe.configure({ mode: 'serial' });
  const session = signedIn('hr@greenwood.demo');

  test('adjusts a leave balance and reverses it', async () => {
    const s = session();
    await s.go('/hr/leave');
    const mark = s.mark();
    await s.page.getByRole('tab', { name: /Balances/ }).click();
    await expect(s.page.getByRole('button', { name: /^show$/i })).toBeDisabled();
    await pick(s.page, 'Employee', EMPLOYEE_CODE, EMPLOYEE_CODE);
    await s.page.getByRole('button', { name: /^show$/i }).click();
    await s.settle();

    const balanceRows = s.page.locator('.v-table').first().locator('tbody tr');
    await expect(balanceRows.first()).toBeVisible();
    const first = (await balanceRows.first().locator('td').first().innerText()).trim();
    const typeName = first.split(' — ').slice(1).join(' — ');
    const row = balanceRows.filter({ hasText: first });
    const balance = async () => Number((await row.locator('td').nth(3).innerText()).trim());
    const before = await balance();
    const ledger = s.page.locator('.v-table').nth(1).locator('tbody tr');

    const adjust = async (days: string, reason: string) => {
      await s.page.getByRole('button', { name: /^adjust$/i }).click();
      const d = dialog(s.page);
      await expect(d).toContainText('Adjust balance');
      await pick(d, 'Leave type *', typeName);
      await fill(d, 'Days (±)', days);
      await fill(d, 'Reason *', 'ab');
      await expect(d.getByRole('button', { name: /^save$/i })).toBeDisabled();
      await fill(d, 'Reason *', reason);
      await saveDialog(s);
      await expect(ledger.filter({ hasText: reason })).toContainText(days);
    };

    await adjust('1', `E2E credit ${id}`);
    await expect.poll(balance).toBe(before + 1);
    await adjust('-1', `E2E reverse ${id}`);
    await expect.poll(balance).toBe(before);
    expect(await rows(s.page).filter({ hasText: id }).count()).toBeGreaterThanOrEqual(2);
    await expectClean(s, mark, 'leave adjustment');
  });
});

test.describe('Leave balances · employee@greenwood.demo', () => {
  const session = signedIn('employee@greenwood.demo');

  test('cannot open the HR leave register', async () => {
    const s = session();
    await s.go('/hr/leave');
    expect(BLOCKED_PATHS).toContain(s.pathname());
    await expect(s.page.getByRole('button', { name: /^adjust$/i })).toHaveCount(0);
  });
});

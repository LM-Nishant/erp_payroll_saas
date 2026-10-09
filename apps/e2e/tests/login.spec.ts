import { expect, test } from '@playwright/test';
import { AppSession } from '../src/app';
import { user } from '../src/manifest';

/** Negative login cases (every manifest user's positive login is covered by users.spec.ts). */
test.describe('login form', () => {
  test.describe.configure({ mode: 'serial' });
  let s: AppSession;
  test.beforeAll(async ({ browser }) => {
    s = await AppSession.open(browser);
  });
  test.afterAll(async () => {
    await s?.close();
  });

  test('a wrong password is rejected with an error and no session', async () => {
    const res = await s.login({ email: 'teacher@greenwood.demo' }, 'not-the-password');
    expect(res.status()).toBe(401);
    await expect(s.page.locator('.v-alert.text-error, .v-alert.bg-error')).toBeVisible();
    await expect(s.page).toHaveURL(/\/login/);
  });

  test('an unknown email is rejected the same way', async () => {
    const res = await s.login({ email: 'nobody@greenwood.demo' });
    expect(res.status()).toBe(401);
    await expect(s.page.locator('.v-alert.text-error, .v-alert.bg-error')).toBeVisible();
  });

  test('the correct demo password then signs in and sign-out returns to login', async () => {
    await s.signIn(user('teacher@greenwood.demo'));
    await s.page.getByRole('button', { name: 'Sign out' }).click();
    await expect(s.page).toHaveURL(/\/login/);
  });

  test('protected pages redirect to login when signed out', async () => {
    await s.page.goto('/hr/employees');
    await expect(s.page).toHaveURL(/\/login/);
  });
});

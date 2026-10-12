import { expect, test, type Browser } from '@playwright/test';
import { AppSession } from '../../src/app';
import { hasDatabase, mintUserToken } from '../../src/db';
import { signedIn } from '../../src/session';
import { dialog, expectClean, fill, pick, RUN_ID, rows, saveDialog } from '../../src/ui';

/**
 * Password self-service and administration (Greenwood), all through the UI:
 *  - owner@ adds a user with an initial password and another one by invitation;
 *  - the user changes their own password from the account menu (wrong current password refused,
 *    old password stops working);
 *  - owner@ sends a password reset link from the Users page;
 *  - the reset link page enforces the password policy, sets the password once and rejects reuse;
 *  - "Forgot password?" on the login form confirms without revealing whether the account exists;
 *  - the invited user activates the account from the invitation link and signs in.
 * Reset / invite tokens only leave the server by e-mail, so the link steps mint a token row in
 * the dev database (src/db.ts) exactly like the API does.
 */
test.describe.configure({ mode: 'serial' });
const tag = `${RUN_ID.toLowerCase()}${Math.floor(Math.random() * 1e4)}`;
const INITIAL = 'Welcome-2026-Demo!';
const CHANGED = 'Changed-2026-Pass!';
const RESET = 'Reset-2026-Pass!';
const INVITED = 'Invited-2026-Pass!';
const staff = { name: `E2E Pw ${tag}`, email: `e2e.pw.${tag}@greenwood.demo` };
const invitee = { name: `E2E Invitee ${tag}`, email: `e2e.invite.${tag}@greenwood.demo` };

async function withSession<T>(browser: Browser, fn: (s: AppSession) => Promise<T>): Promise<T> {
  const s = await AppSession.open(browser);
  try {
    return await fn(s);
  } finally {
    await s.close();
  }
}

async function signInWith(s: AppSession, u: { email: string; name: string }, password: string) {
  expect((await s.login(u, password)).status(), `login ${u.email}`).toBe(200);
  await expect(s.page.getByText(`Signed in as ${u.name}`)).toBeVisible();
}

async function loginStatus(browser: Browser, email: string, password: string) {
  return withSession(browser, async (s) => (await s.login({ email }, password)).status());
}

test.describe('Passwords · owner@greenwood.demo and the affected users', () => {
  const session = signedIn('owner@greenwood.demo');
  const row = (email: string) => rows(session().page).filter({ hasText: email });

  async function addUser(u: { name: string; email: string }, password?: string) {
    const s = session();
    await s.go('/group/users');
    const mark = s.mark();
    await s.page.getByRole('button', { name: 'Add user' }).click();
    const d = dialog(s.page);
    await fill(d, 'Full name', u.name);
    await fill(d, 'Email (login)', u.email);
    if (password) await fill(d, 'Initial password (optional)', password);
    await pick(d, 'Role', /^Librarian/, 'Librarian');
    await pick(d, 'Applies to', /^Institution$/);
    await pick(d, 'Institution', 'Greenwood International School');
    await saveDialog(s);
    await fill(s.page, 'Search', u.email);
    await s.settle();
    await expect(row(u.email)).toHaveCount(1);
    await expectClean(s, mark, `create ${u.email}`);
  }

  test('adds a user with an initial password', async () => {
    await addUser(staff, INITIAL);
    await expect(row(staff.email)).toContainText('ACTIVE');
  });

  test('the user changes their own password from the account menu', async ({ browser }) => {
    await withSession(browser, async (u) => {
      await signInWith(u, staff, INITIAL);
      const openDialog = async () => {
        await u.go('/employee');
        await u.page.getByLabel('Account menu').click();
        await u.page.getByRole('listitem').filter({ hasText: 'Change password' }).click();
        return dialog(u.page);
      };

      let d = await openDialog();
      await fill(d, 'Current password', 'Not-The-Password-1');
      await fill(d, 'New password', 'short');
      await expect(d).toContainText('at least 12 characters');
      await expect(d.getByRole('button', { name: 'Change password' })).toBeDisabled();
      await fill(d, 'New password', CHANGED);
      await fill(d, 'Confirm new password', CHANGED);
      await d.getByRole('button', { name: 'Change password' }).click();
      await expect(d).toContainText('Current password is incorrect');

      await fill(d, 'Current password', INITIAL);
      const mark = u.mark();
      await d.getByRole('button', { name: 'Change password' }).click();
      await expect(d).toContainText('Password changed');
      await expectClean(u, mark, 'change password');
      await d.getByRole('button', { name: 'Close' }).click();

      // Still signed in on this device.
      d = await openDialog();
      await d.getByRole('button', { name: 'Cancel' }).click();
    });
    expect(await loginStatus(browser, staff.email, INITIAL), 'old password').toBe(401);
    expect(await loginStatus(browser, staff.email, CHANGED), 'new password').toBe(200);
  });

  test('owner sends a password reset link from the Users page', async () => {
    const s = session();
    const mark = s.mark();
    s.page.once('dialog', (d) => void d.accept());
    await row(staff.email).getByRole('button', { name: 'Reset password' }).click();
    await s.settle();
    await expect(s.page.locator('.v-alert').filter({ hasText: 'reset link sent' })).toContainText(
      staff.email,
    );
    expect(
      s.calls.some(
        (c) =>
          c.method === 'POST' && /\/users\/[^/]+\/password-reset$/.test(c.path) && c.status === 201,
      ),
    ).toBe(true);
    await expectClean(s, mark, 'send reset link');
  });

  test('the reset link sets a new password once', async ({ browser }) => {
    test.skip(!hasDatabase(), 'needs the dev database to mint a reset token');
    const token = await mintUserToken(staff.email, 'PASSWORD_RESET');
    await withSession(browser, async (u) => {
      const { page } = u;
      await page.goto(`/reset-password?token=${encodeURIComponent(token)}`);
      await expect(page.getByText('Set a new password')).toBeVisible();
      await fill(page, 'New password', 'alllowercase');
      await expect(page.getByText('Password must contain 3 of')).toBeVisible();
      await fill(page, 'New password', RESET);
      await fill(page, 'Confirm password', `${RESET}x`);
      await expect(page.getByText('Passwords do not match')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Reset password' })).toBeDisabled();
      await fill(page, 'Confirm password', RESET);
      await page.getByRole('button', { name: 'Reset password' }).click();
      await expect(page.getByText('Your password has been changed')).toBeVisible();
      await page.getByRole('link', { name: 'Go to sign in' }).click();
      await expect(page).toHaveURL(/\/login/);

      // The link is single-use.
      await page.goto(`/reset-password?token=${encodeURIComponent(token)}`);
      await fill(page, 'New password', `${RESET}2`);
      await fill(page, 'Confirm password', `${RESET}2`);
      await page.getByRole('button', { name: 'Reset password' }).click();
      await expect(page.getByText('This link is invalid or has expired')).toBeVisible();
    });
    expect(await loginStatus(browser, staff.email, CHANGED), 'pre-reset password').toBe(401);
    expect(await loginStatus(browser, staff.email, RESET), 'reset password').toBe(200);
  });

  test('"Forgot password?" confirms the same way for known and unknown e-mails', async ({
    browser,
  }) => {
    await withSession(browser, async (u) => {
      const { page } = u;
      for (const email of [staff.email, `nobody.${tag}@greenwood.demo`]) {
        await page.goto('/login');
        await page.getByLabel('Email').fill(email);
        await page.getByRole('link', { name: 'Forgot password?' }).click();
        await expect(page).toHaveURL(/\/forgot-password/);
        await expect(page.getByLabel('Email')).toHaveValue(email);
        const res = page.waitForResponse((r) => r.url().includes('/auth/password/forgot'));
        await page.getByRole('button', { name: 'Send reset link' }).click();
        expect((await res).status()).toBe(204);
        await expect(page.getByText(`If an account exists for ${email}`)).toBeVisible();
      }
    });
  });

  test('adds a user by invitation, who activates the account from the link', async ({
    browser,
  }) => {
    test.skip(!hasDatabase(), 'needs the dev database to mint an invite token');
    await addUser(invitee);
    await expect(row(invitee.email)).toContainText('INVITED');
    const token = await mintUserToken(invitee.email, 'INVITE');
    await withSession(browser, async (u) => {
      const { page } = u;
      await page.goto(`/accept-invite?token=${encodeURIComponent(token)}`);
      await expect(page.getByText('Accept invitation')).toBeVisible();
      await fill(page, 'Your name (optional)', `${invitee.name} Jr`);
      await fill(page, 'New password', INVITED);
      await fill(page, 'Confirm password', INVITED);
      await page.getByRole('button', { name: 'Activate account' }).click();
      await expect(page.getByText('Your account is ready')).toBeVisible();
      await signInWith(u, { email: invitee.email, name: `${invitee.name} Jr` }, INVITED);
    });
    const s = session();
    await s.page.reload();
    await s.settle();
    await fill(s.page, 'Search', invitee.email);
    await s.settle();
    await expect(row(invitee.email)).toContainText('ACTIVE');
    await expect(row(invitee.email)).toContainText(`${invitee.name} Jr`);
  });

  test('deactivates the test users', async () => {
    const s = session();
    for (const email of [staff.email, invitee.email]) {
      await fill(s.page, 'Search', email);
      await s.settle();
      if ((await row(email).count()) === 0) continue;
      s.page.once('dialog', (d) => void d.accept());
      await row(email).getByRole('button', { name: 'Deactivate' }).click();
      await s.settle();
      await expect(row(email)).toContainText('DISABLED');
    }
  });
});

import { expect, test, type Browser } from '@playwright/test';
import { AppSession } from '../../src/app';
import { signedIn } from '../../src/session';
import { dialog, expectClean, fill, pick, RUN_ID, rows, saveDialog } from '../../src/ui';

/**
 * Users & roles and branding (Greenwood):
 *  - owner@ adds a user with an institution-scoped role and an initial password, the new user
 *    signs in through the login form, the owner changes the role and finally deactivates the
 *    account, after which sign-in is refused;
 *  - admin@ (institution admin) updates the institution's branding and restores it.
 */
test.describe.configure({ mode: 'serial' });
const tag = `${RUN_ID.toLowerCase()}${Math.floor(Math.random() * 1e4)}`;
// The demo seed bypasses the password policy; real user creation enforces it.
const NEW_PASSWORD = 'Welcome-2026-Demo!';
const newUser = { name: `E2E Staff ${tag}`, email: `e2e.staff.${tag}@greenwood.demo` };

test.describe('Users & roles · owner@greenwood.demo', () => {
  const session = signedIn('owner@greenwood.demo');
  const row = () => rows(session().page).filter({ hasText: newUser.email });

  async function signInAs(browser: Browser) {
    const other = await AppSession.open(browser);
    try {
      const res = await other.login({ email: newUser.email }, NEW_PASSWORD);
      return { status: res.status(), other };
    } catch (e) {
      await other.close();
      throw e;
    }
  }

  test('adds a user with an institution-scoped role', async () => {
    const s = session();
    await s.go('/group/users');
    const mark = s.mark();
    await s.page.getByRole('button', { name: 'Add user' }).click();
    const d = dialog(s.page);
    await fill(d, 'Full name', newUser.name);
    await fill(d, 'Email (login)', newUser.email);
    await fill(d, 'Initial password (optional)', NEW_PASSWORD);
    await pick(d, 'Role', /^Librarian/, 'Librarian');
    await pick(d, 'Applies to', /^Institution$/);
    await pick(d, 'Institution', 'Greenwood International School');
    await saveDialog(s);
    await fill(s.page, 'Search', newUser.email);
    await s.settle();
    await expect(row()).toHaveCount(1);
    await expect(row()).toContainText('Librarian');
    await expect(row()).toContainText('ACTIVE');
    await expectClean(s, mark, 'user create');
  });

  test('the new user signs in with the initial password', async ({ browser }) => {
    const { status, other } = await signInAs(browser);
    try {
      expect(status).toBe(200);
      await expect(other.page.getByText(`Signed in as ${newUser.name}`)).toBeVisible();
    } finally {
      await other.close();
    }
  });

  test('changes the role assignment', async () => {
    const s = session();
    const mark = s.mark();
    await row().getByRole('button', { name: 'Roles' }).click();
    const d = dialog(s.page);
    await expect(d).toContainText(`Roles — ${newUser.name}`);
    await pick(d, 'Role', /^Transport Manager/, 'Transport');
    await saveDialog(s);
    await expect(row()).toContainText('Transport Manager');
    await expect(row()).not.toContainText('Librarian');
    await expectClean(s, mark, 'role change');
  });

  test('deactivates the user, who can no longer sign in', async ({ browser }) => {
    const s = session();
    const mark = s.mark();
    s.page.once('dialog', (d) => void d.accept());
    await row().getByRole('button', { name: 'Deactivate' }).click();
    await s.settle();
    await expect(row()).toContainText('DISABLED');
    await expect(row().getByRole('button', { name: 'Reactivate' })).toBeVisible();
    await expectClean(s, mark, 'deactivate');

    const { status, other } = await signInAs(browser);
    try {
      expect(status, 'disabled account login').not.toBe(200);
      await expect(other.page).toHaveURL(/\/login/);
    } finally {
      await other.close();
    }
  });
});

test.describe('Branding · admin@greenwood.demo', () => {
  const session = signedIn('admin@greenwood.demo');
  const footer = `E2E footer ${tag}`;
  let original = '';

  test('updates the institution footer and shows it in the preview', async () => {
    const s = session();
    await s.go('/institution/branding');
    const mark = s.mark();
    await expect(s.page.getByLabel('Level')).toBeVisible();
    await expect(s.page.locator('.v-select').filter({ hasText: 'Level' })).toContainText(
      'Institution: Greenwood',
    );
    const field = s.page.getByLabel('Footer text', { exact: true });
    original = await field.inputValue();
    await field.fill(footer);
    await s.page.getByRole('button', { name: 'Save', exact: true }).click();
    await s.settle();
    await expect(s.page.getByText('Branding saved')).toBeVisible();
    await expect(s.page.getByText(footer).last()).toBeVisible();
    await expectClean(s, mark, 'branding save');
  });

  test('restores the original footer', async () => {
    const s = session();
    const mark = s.mark();
    await s.page.getByLabel('Footer text', { exact: true }).fill(original);
    await s.page.getByRole('button', { name: 'Save', exact: true }).click();
    await s.settle();
    await expect(s.page.getByText('Branding saved')).toBeVisible();
    await expect(s.page.getByText(footer)).toHaveCount(0);
    await expectClean(s, mark, 'branding restore');
  });
});

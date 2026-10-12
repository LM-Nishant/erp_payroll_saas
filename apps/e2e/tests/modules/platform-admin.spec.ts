import { expect, test } from '@playwright/test';
import { org } from '../../src/manifest';
import { signedIn } from '../../src/session';
import { dialog, expectClean, fill, pick, RUN_ID, rows, saveDialog } from '../../src/ui';

/**
 * Platform organization administration not covered by platform.spec: the organization "Edit"
 * dialog (rename + switch EDUCATION ↔ COMPANY, audited reason), the platform notifications page,
 * and support@erp.local seeing an organization's detail page without any manage controls.
 * The scratch organization is archived again at the end.
 */
test.describe.configure({ mode: 'serial' });
const tag = `${RUN_ID.toLowerCase()}${Math.floor(Math.random() * 1e4)}`;
const orgName = `E2E Org Edit ${tag}`;
const renamed = `E2E Company ${tag}`;
const greenwood = org('greenwood');
let orgPath = '';

test.describe('Platform organization edit · superadmin@erp.local', () => {
  const session = signedIn('superadmin@erp.local');
  const overview = () => session().page.locator('.v-card').filter({ hasText: 'Slug:' });

  test('creates a scratch education organization', async () => {
    const s = session();
    await s.go('/platform/organizations');
    const mark = s.mark();
    await s.page.getByRole('button', { name: 'New organization' }).click();
    const d = dialog(s.page);
    await fill(d, 'Organization name', orgName);
    await pick(d, 'Plan', /^Starter/);
    await fill(d, 'Owner name', `Owner ${tag}`);
    await fill(d, 'Owner e-mail', `owner.${tag}@e2e-org-edit.test`);
    await saveDialog(s, 'Create');
    await expect(s.page.getByText(`Created ${orgName}.`)).toBeVisible();
    await fill(s.page, 'Search', orgName);
    await s.settle();
    await rows(s.page).filter({ hasText: orgName }).click();
    await s.page.waitForURL(/\/platform\/organizations\/[0-9a-f-]{36}$/);
    await s.settle();
    await expect(s.page.getByRole('heading', { name: orgName })).toBeVisible();
    await expect(overview()).toContainText('Type: Education');
    orgPath = s.pathname();
    await expectClean(s, mark, 'organization create');
  });

  test('a too-short audit reason is refused and nothing changes', async () => {
    const s = session();
    const mark = s.mark();
    await s.page.getByRole('button', { name: /^edit$/i }).click();
    const d = dialog(s.page);
    await expect(d).toContainText('Edit organization');
    await expect(d.getByLabel('Name', { exact: true })).toHaveValue(orgName);
    await fill(d, 'Name', renamed);
    await fill(d, 'Reason', 'short');
    await expect(d.getByText('At least 10 characters')).toBeVisible();
    await d.getByRole('button', { name: 'Save' }).click();
    await s.settle();
    expect((await s.failedSince(mark)).map((c) => `${c.status} ${c.code}`)).toEqual([
      '400 VALIDATION_ERROR',
    ]);
    await expect(s.page.locator('.v-alert').filter({ hasText: /validation/i })).toBeVisible();
    await d.getByRole('button', { name: 'Cancel' }).click();
    await expect(s.page.getByRole('heading', { name: orgName })).toBeVisible();
  });

  test('renames the organization and switches it to a company', async () => {
    const s = session();
    // Fresh page (drops the previous test's error alert).
    await s.go('/platform/organizations');
    await s.go(orgPath);
    const mark = s.mark();
    await s.page.getByRole('button', { name: /^edit$/i }).click();
    const d = dialog(s.page);
    await expect(d.getByLabel('Name', { exact: true })).toHaveValue(orgName);
    await fill(d, 'Name', renamed);
    await pick(d, 'Organization type', 'Company (HRMS & payroll)');
    await fill(d, 'Reason', 'E2E: customer is an HR-only company');
    await saveDialog(s);
    await expect(s.page.getByText('Organization updated')).toBeVisible();
    await expect(s.page.getByRole('heading', { name: renamed })).toBeVisible();
    await expect(overview()).toContainText('Type: Company');

    // The list reflects the change too.
    await s.go('/platform/organizations');
    await fill(s.page, 'Search', renamed);
    await s.settle();
    await expect(rows(s.page).filter({ hasText: renamed })).toHaveCount(1);
    await rows(s.page).filter({ hasText: renamed }).click();
    await s.page.waitForURL(/\/platform\/organizations\/[0-9a-f-]{36}$/);
    await s.settle();
    await expect(overview()).toContainText('Type: Company');
    await expectClean(s, mark, 'organization edit');
  });

  test('archives the scratch organization', async () => {
    const s = session();
    const mark = s.mark();
    await s.page.getByRole('button', { name: 'Archive' }).click();
    const d = dialog(s.page);
    await fill(d, 'Reason', 'E2E cleanup of the edit-test organization');
    await saveDialog(s, 'Confirm');
    await expect(s.page.locator('.v-chip').filter({ hasText: /^ARCHIVED$/ })).toBeVisible();
    await expectClean(s, mark, 'archive');
  });

  test('opens the platform notifications page', async () => {
    const s = session();
    const mark = s.mark();
    await s.go('/platform/notifications');
    expect(s.pathname()).toBe('/platform/notifications');
    await expect(s.page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
    // Platform staff belong to no organization, so there is nothing tenant-scoped to list.
    await expect(s.page.locator('.v-main .v-alert')).toContainText(/no organization membership/i);
    await expect(s.page.getByRole('button', { name: /mark all/i })).toHaveCount(0);
    await expectClean(s, mark, 'platform notifications');
  });
});

test.describe('Platform organization detail · support@erp.local (read-only)', () => {
  const session = signedIn('support@erp.local');

  test('sees Greenwood without edit, status, owner or billing actions', async () => {
    const s = session();
    await s.go(`/platform/organizations/${greenwood.id}`);
    const mark = s.mark();
    await expect(s.page.getByRole('heading', { name: greenwood.name })).toBeVisible();
    await expect(s.page.locator('.v-card').filter({ hasText: 'Slug:' })).toContainText(
      'Type: Education',
    );
    for (const name of [/^edit$/i, /^suspend$/i, /^archive$/i, /invite owner/i, /new invoice/i]) {
      await expect(s.page.getByRole('button', { name }), String(name)).toHaveCount(0);
    }
    await expectClean(s, mark, 'support org detail');
  });

  test('opens the platform notifications page', async () => {
    const s = session();
    const mark = s.mark();
    await s.go('/platform/notifications');
    expect(s.pathname()).toBe('/platform/notifications');
    await expect(s.page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
    // Platform staff belong to no organization, so there is nothing tenant-scoped to list.
    await expect(s.page.locator('.v-main .v-alert')).toContainText(/no organization membership/i);
    await expect(s.page.getByRole('button', { name: /mark all/i })).toHaveCount(0);
    await expectClean(s, mark, 'support notifications');
  });
});

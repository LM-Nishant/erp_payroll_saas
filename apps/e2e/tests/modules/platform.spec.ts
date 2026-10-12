import { expect, test } from '@playwright/test';
import { signedIn } from '../../src/session';
import {
  dialog,
  expectClean,
  expectDownload,
  expectRow,
  fill,
  pick,
  RUN_ID,
  rows,
  saveDialog,
} from '../../src/ui';

/**
 * Platform administration (superadmin@erp.local): onboard a new organization on the Starter plan,
 * add a module add-on, raise an invoice, download its PDF, record the payment, create an
 * (inactive) plan, browse invoices / billing settings and finally archive the organization.
 */
test.describe.configure({ mode: 'serial' });
const tag = `${RUN_ID.toLowerCase()}${Math.floor(Math.random() * 1e4)}`;
const orgName = `E2E Academy ${tag}`;
const planKey = `e2e_plan_${tag}`;

test.describe('Platform · superadmin@erp.local', () => {
  const session = signedIn('superadmin@erp.local');
  const invoices = () =>
    session().page.locator('.v-card').filter({ hasText: 'New invoice' }).locator('tbody tr');

  test('creates an organization with a first owner', async () => {
    const s = session();
    await s.go('/platform/organizations');
    const mark = s.mark();
    await s.page.getByRole('button', { name: 'New organization' }).click();
    const d = dialog(s.page);
    await fill(d, 'Organization name', orgName);
    await expect(d.getByLabel('Slug (login identifier)')).toHaveValue(`e2e-academy-${tag}`);
    await pick(d, 'Plan', /^Starter/);
    await fill(d, 'Owner name', `Owner ${tag}`);
    await fill(d, 'Owner e-mail', `owner.${tag}@e2e-academy.test`);
    await saveDialog(s, 'Create');
    await expect(s.page.getByText(`Created ${orgName}.`)).toBeVisible();
    await fill(s.page, 'Search', orgName);
    await s.settle();
    await rows(s.page).filter({ hasText: orgName }).click();
    await s.page.waitForURL(/\/platform\/organizations\/[0-9a-f-]{36}$/);
    await s.settle();
    await expect(s.page.getByRole('heading', { name: orgName })).toBeVisible();
    await expect(s.page.getByText(`owner.${tag}@e2e-academy.test`)).toBeVisible();
    await expect(s.page.getByText('Trial ends')).toBeVisible();
    await expectClean(s, mark, 'organization create');
  });

  test('licenses the hostel module as an add-on', async () => {
    const s = session();
    const mark = s.mark();
    await s.page.getByRole('button', { name: 'Configure' }).click();
    const d = dialog(s.page);
    await pick(d, 'Add-on modules (on top of the plan)', /^hostel —/);
    await fill(d, 'Reason', 'E2E: customer bought the hostel add-on');
    await saveDialog(s);
    const sub = s.page.locator('.v-card').filter({ hasText: 'Licensed modules' });
    await expect(sub.locator('.v-chip').filter({ hasText: /^hostel$/ })).toBeVisible();
    await expect(sub.locator('.v-chip').filter({ hasText: /^education$/ })).toBeVisible();
    await expectClean(s, mark, 'subscription add-on');
  });

  test('raises an invoice, downloads it and records the payment', async () => {
    const s = session();
    const mark = s.mark();
    await s.page.getByRole('button', { name: 'New invoice' }).click();
    const d = dialog(s.page);
    await fill(d, 'Description', 'Starter plan + hostel add-on');
    await fill(d, 'Unit price', '4999');
    await fill(d, 'Reason (audit)', 'E2E monthly subscription invoice');
    await saveDialog(s, 'Create invoice');
    await expect(s.page.getByText(/Invoice .+ created/)).toBeVisible();
    await expect(invoices()).toHaveCount(1);
    await expect(invoices().first()).toContainText('Open');

    await expectDownload(s.page, () => invoices().first().getByTitle('Download PDF').click());

    await invoices().first().getByRole('button', { name: 'Mark paid' }).click();
    const p = dialog(s.page);
    await expect(p).toContainText('Mark invoice paid');
    await fill(p, 'Payment reference / UTR', `UTR${tag}`.toUpperCase());
    await fill(p, 'Reason (audit)', 'E2E payment received by bank transfer');
    await saveDialog(s);
    await expect(invoices().first()).toContainText('Paid');
    await expectClean(s, mark, 'invoice');
  });

  test('archives the organization', async () => {
    const s = session();
    const mark = s.mark();
    await s.page.getByRole('button', { name: 'Archive' }).click();
    const d = dialog(s.page);
    await expect(d).toContainText('Set status to ARCHIVED');
    await fill(d, 'Reason', 'E2E cleanup of the test organization');
    await saveDialog(s, 'Confirm');
    await expect(s.page.locator('.v-chip').filter({ hasText: /^ARCHIVED$/ })).toBeVisible();
    await expectClean(s, mark, 'archive');
  });

  test('creates an inactive plan', async () => {
    const s = session();
    await s.go('/platform/plans');
    const mark = s.mark();
    await s.page.getByRole('button', { name: 'New plan' }).click();
    const d = dialog(s.page);
    await fill(d, 'Name', `E2E plan ${tag}`);
    await fill(d, 'Key', planKey);
    await fill(d, 'Price', '1999');
    await pick(d, 'Modules', /^Academic structure/);
    await pick(d, 'Status', /^INACTIVE$/);
    await saveDialog(s);
    await expectRow(s.page, planKey);
    const row = rows(s.page).filter({ hasText: planKey });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('INACTIVE');
    await expectClean(s, mark, 'plan create');
  });

  test('lists invoices across organizations and opens billing settings', async () => {
    const s = session();
    await s.go('/platform/invoices');
    const mark = s.mark();
    await pick(s.page, 'Status', /^Paid$/);
    await s.settle();
    await expect(rows(s.page).filter({ hasText: orgName })).toContainText('Paid');
    await s.go('/platform/billing-settings');
    await expect(s.page.getByRole('heading').first()).toBeVisible();
    await expectClean(s, mark, 'invoices & billing settings');
  });
});

test.describe('Platform · support@erp.local', () => {
  const session = signedIn('support@erp.local');
  test('browses organizations read-only', async () => {
    const s = session();
    await s.go('/platform/organizations');
    const mark = s.mark();
    // Archived "E2E Academy" orgs from earlier runs can push Greenwood off the first page.
    await fill(s.page, 'Search', 'Greenwood');
    await s.settle();
    await expect(rows(s.page).filter({ hasText: 'Greenwood' }).first()).toBeVisible();
    await expect(s.page.getByRole('button', { name: 'New organization' })).toHaveCount(0);
    await expectClean(s, mark, 'support org list');
  });
});

import { expect, test } from '@playwright/test';
import { signedIn } from '../../src/session';
import { dialog, expectClean, expectRow, fill, pick, RUN_ID, rows, saveDialog } from '../../src/ui';

/**
 * Communication (Greenwood, owner@ — organization-wide communication.manage): create an e-mail template,
 * preview it with sample variables, publish a second version and open the message log.
 * Templates are organization-level settings (the page sends no scope), so the organization owner
 * is the actor; group-scoped admins get 403 SCOPE_DENIED (known UI gap: the button still shows).
 */
test.describe.configure({ mode: 'serial' });
const key = `e2e.notice_${RUN_ID.toLowerCase()}_${Math.floor(Math.random() * 1e4)}`;
const name = `E2E notice ${key}`;

test.describe('Communication · owner@greenwood.demo', () => {
  const session = signedIn('owner@greenwood.demo');
  const row = () => rows(session().page).filter({ hasText: key });

  test('creates an e-mail template', async () => {
    const s = session();
    await s.go('/group/communication');
    const mark = s.mark();
    await s.page.getByRole('tab', { name: 'Templates' }).click();
    await s.page.getByRole('button', { name: 'New template' }).click();
    const d = dialog(s.page);
    await fill(d, 'Key (e.g. auth.invite)', key);
    await pick(d, 'Channel', /^email$/);
    await fill(d, 'Name', name);
    await fill(d, 'Subject', 'Notice for {{name}}');
    await fill(d, 'Text body ({{variable}})', 'Dear {{name}}, school reopens on Monday.');
    await saveDialog(s, 'Create');
    await expectRow(s.page, key);
    await expect(row()).toHaveCount(1);
    await expect(row()).toContainText('email');
    await expectClean(s, mark, 'template create');
  });

  test('previews the template with sample variables', async () => {
    const s = session();
    const mark = s.mark();
    await row().click();
    const d = dialog(s.page);
    await expect(d).toContainText(`${key} — new version`);
    await fill(d, 'Sample variables (JSON)', '{"name":"Asha"}');
    await d.getByRole('button', { name: 'Preview current version' }).click();
    await s.settle();
    await expect(d).toContainText('Notice for Asha');
    await expect(d).toContainText('Dear Asha, school reopens on Monday.');
    await expectClean(s, mark, 'template preview');
  });

  test('publishes a new version', async () => {
    const s = session();
    const mark = s.mark();
    const d = dialog(s.page);
    await fill(d, 'Text body ({{variable}})', 'Dear {{name}}, school reopens on Tuesday.');
    await saveDialog(s, 'Publish version');
    await expect(row()).toContainText('2');
    await expectClean(s, mark, 'template version');
  });

  test('opens providers and the message log', async () => {
    const s = session();
    const mark = s.mark();
    await s.page.getByRole('tab', { name: 'Providers' }).click();
    await expect(s.page.getByRole('button', { name: 'Add provider' })).toBeVisible();
    await s.page.getByRole('tab', { name: 'Message log' }).click();
    await expect(
      s.page
        .getByRole('columnheader', { name: 'Recipient' })
        .or(s.page.getByRole('columnheader', { name: 'To' })),
    ).toBeVisible();
    await expectClean(s, mark, 'message log');
  });

  test.fixme('composes and sends an announcement to a class', async () => {
    // Product gap: the API has /communication/campaigns, but the app has no announcement /
    // broadcast composer (Communication only manages providers, templates and the delivery log;
    // only Transport sends ad-hoc notices from its own page).
  });
});

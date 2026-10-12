import { expect, test, type Browser } from '@playwright/test';
import { AppSession, BLOCKED_PATHS } from '../../src/app';
import { org, user } from '../../src/manifest';
import { signedIn } from '../../src/session';
import { dialog, expectClean, expectRow, fill, pick, RUN_ID, rows, saveDialog } from '../../src/ui';

/**
 * Organization / group administration through the UI:
 *  - Greenwood owner creates + edits an institution and manages its branches (principal: read-only);
 *  - Brightway owner switches the library module off for the whole organization, a principal
 *    loses the menu and the route, then the owner restores it ("Inherit");
 *  - subscription: platform raises an invoice, the Greenwood owner pays it via UPI (QR + UTR),
 *    platform voids it again; a group admin cannot open the subscription;
 *  - secrets / API clients / webhooks are created masked and removed again (group admin and
 *    principal are read-only / blocked);
 *  - AI settings save + restore, AI usage; group branding save + restore (IT admin read-only);
 *  - a scoped admin cannot assign a role above its own scope.
 * Everything that changes demo data is restored (afterAll fallbacks use the API).
 */
test.describe.configure({ mode: 'serial' });
const tag = `${RUN_ID.toLowerCase()}${Math.floor(Math.random() * 1e4)}`;
const TAG = tag.toUpperCase();

/** Calls the API with the page's own access token (cleanup fallbacks only). */
async function api(s: AppSession, method: string, path: string, body?: unknown) {
  return s.page.evaluate(
    async ([m, p, b]) => {
      const el = document.querySelector('#app') as
        | (Element & {
            __vue_app__?: {
              config: {
                globalProperties: {
                  $pinia: { state: { value: { auth: { accessToken: string | null } } } };
                };
              };
            };
          })
        | null;
      const token = el?.__vue_app__?.config.globalProperties.$pinia.state.value.auth.accessToken;
      const res = await fetch(p, {
        method: m,
        headers: {
          Authorization: `Bearer ${token ?? ''}`,
          ...(b === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: b === undefined ? undefined : JSON.stringify(b),
      });
      return { status: res.status, json: (await res.json().catch(() => null)) as unknown };
    },
    [method, path, body] as const,
  );
}

async function signInFresh(browser: Browser, email: string) {
  const s = await AppSession.open(browser);
  await s.signIn(user(email));
  return s;
}

/**
 * Registers an afterAll cleanup in a fresh session: signedIn()'s own afterAll closes the
 * describe's page before later afterAll hooks run.
 */
function cleanupAs(email: string, fn: (s: AppSession) => Promise<void>) {
  test.afterAll(async ({ browser }) => {
    const s = await signInFresh(browser, email);
    try {
      await fn(s);
    } finally {
      await s.close();
    }
  });
}

async function closeErrorAlert(s: AppSession) {
  const alert = s.page
    .locator('.v-main .v-alert')
    .filter({ has: s.page.locator('.v-alert__close') });
  await alert.first().getByRole('button', { name: /close/i }).click();
  expect(await s.errorAlerts()).toEqual([]);
}

const drawerTitles = async (s: AppSession) => (await s.drawerItems()).map((i) => i.title);

/* ------------------------------ institutions & branches ------------------------------ */

test.describe('Institutions & branches · owner@greenwood.demo', () => {
  const session = signedIn('owner@greenwood.demo');
  // Sorts after the demo institutions, so pages that default to the first one are unaffected.
  const name = `Zz E2E Institute ${tag}`;
  const renamed = `Zz E2E Institute ${tag} (renamed)`;
  const code = `E2E${TAG}`.slice(0, 20);
  const branchCode = `BR${TAG}`.slice(0, 20);
  const row = () => rows(session().page).filter({ hasText: code });

  cleanupAs('owner@greenwood.demo', async (s) => {
    const list = (await api(s, 'GET', `/api/v1/institutions?pageSize=100&search=${code}`)).json as {
      data?: Array<{ id: string; code: string }>;
    } | null;
    for (const inst of list?.data?.filter((i) => i.code === code) ?? []) {
      const campuses = (
        await api(s, 'GET', `/api/v1/campuses?pageSize=100&institutionId=${inst.id}`)
      ).json as { data?: Array<{ id: string }> } | null;
      for (const c of campuses?.data ?? []) await api(s, 'DELETE', `/api/v1/campuses/${c.id}`);
      await api(s, 'DELETE', `/api/v1/institutions/${inst.id}`);
    }
  });

  test('creates an institution and sees it listed', async () => {
    const s = session();
    await s.go('/group/institutions');
    const mark = s.mark();
    await s.page.getByRole('button', { name: /new institution/i }).click();
    const d = dialog(s.page);
    await expect(d).toContainText('New institution');
    await fill(d, 'Name *', name);
    await fill(d, 'Code * (used as employee code prefix)', code);
    await fill(d, 'Email', `office.${tag}@e2e-institute.test`);
    await saveDialog(s);
    await expectRow(s.page, code);
    await expect(row()).toContainText(name);
    await expectClean(s, mark, 'institution create');
  });

  test('a duplicate institution code is refused in the dialog', async () => {
    const s = session();
    const mark = s.mark();
    await s.page.getByRole('button', { name: /new institution/i }).click();
    const d = dialog(s.page);
    await fill(d, 'Name *', `${name} duplicate`);
    await fill(d, 'Code * (used as employee code prefix)', code);
    await d.getByRole('button', { name: 'Save' }).click();
    await s.settle();
    const failed = await s.failedSince(mark);
    expect(failed.map((c) => c.status)).toEqual([409]);
    await expect(s.page.locator('.v-dialog.v-overlay--active')).toHaveCount(1);
    await d.getByRole('button', { name: 'Cancel' }).click();
    await closeErrorAlert(s);
    await expect(rows(s.page).filter({ hasText: `${name} duplicate` })).toHaveCount(0);
  });

  test('edits the institution', async () => {
    const s = session();
    const mark = s.mark();
    await row().getByRole('button').first().click();
    const d = dialog(s.page);
    await expect(d).toContainText('Edit institution');
    await expect(d.getByLabel('Name *', { exact: true })).toHaveValue(name);
    await fill(d, 'Name *', renamed);
    await fill(d, 'Phone', '+91 80 4000 1234');
    await saveDialog(s);
    await expect(row()).toContainText(renamed);
    await expectClean(s, mark, 'institution edit');
  });

  test('adds, edits and deletes a branch of the new institution', async () => {
    const s = session();
    await s.go('/institution/branches');
    const mark = s.mark();
    await pick(s.page, 'Institution', renamed, 'Zz E2E');
    await s.settle();
    await expect(s.page.locator('.v-main .v-autocomplete').first()).toContainText(renamed);
    // A new institution has no branches yet: only Vuetify's own "no data" row is shown.
    await expect(s.page.locator('.v-table:visible tbody tr.v-data-table-rows-no-data')).toHaveCount(
      1,
    );
    await s.page.getByRole('button', { name: /new branch/i }).click();
    let d = dialog(s.page);
    await fill(d, 'Code * (e.g. NOIDA)', branchCode);
    await fill(d, 'Name * (e.g. Noida Branch)', `E2E Branch ${tag}`);
    await d.getByLabel('Main branch').check();
    await saveDialog(s);
    const branch = rows(s.page).filter({ hasText: branchCode });
    await expect(branch).toContainText(`E2E Branch ${tag}`);
    await expect(branch).toContainText('Main');
    await expect(branch).toContainText('ACTIVE');

    await branch.locator('button').first().click();
    d = dialog(s.page);
    await expect(d).toContainText('Edit branch');
    await fill(d, 'Name * (e.g. Noida Branch)', `E2E Branch ${tag} edited`);
    await pick(d, 'Status', /^INACTIVE$/);
    await saveDialog(s);
    await expect(branch).toContainText(`E2E Branch ${tag} edited`);
    await expect(branch).toContainText('INACTIVE');

    s.page.once('dialog', (c) => void c.accept());
    await branch.locator('button').last().click();
    await s.settle();
    await expect(branch).toHaveCount(0);
    await expectClean(s, mark, 'branch CRUD');
  });
});

test.describe('Institutions & branches read-only · principal@greenwood.demo', () => {
  const session = signedIn('principal@greenwood.demo');

  test('sees institutions and branches without any create / edit controls', async () => {
    const s = session();
    await s.go('/group/institutions');
    const mark = s.mark();
    await expectRow(s.page, 'Greenwood International School');
    await expect(s.page.getByRole('button', { name: /new institution/i })).toHaveCount(0);
    await expect(rows(s.page).first().locator('button')).toHaveCount(0);
    await s.go('/institution/branches');
    expect(BLOCKED_PATHS).not.toContain(s.pathname());
    await expect(s.page.getByRole('button', { name: /new branch/i })).toHaveCount(0);
    await expect(rows(s.page).locator('button')).toHaveCount(0);
    await expectClean(s, mark, 'read-only institutions');
  });
});

/* -------------------------------------- modules -------------------------------------- */

test.describe('Modules · owner@brightway.demo switches library off for the organization', () => {
  const session = signedIn('owner@brightway.demo');
  const libraryRow = () =>
    session()
      .page.locator('tbody tr')
      .filter({ has: session().page.locator('strong', { hasText: /^library$/ }) });

  cleanupAs('owner@brightway.demo', async (s) => {
    const res = (await api(s, 'GET', '/api/v1/features')).json as {
      data?: { overrides: Array<{ id: string; featureKey: string; scopeType: string }> };
    } | null;
    for (const o of res?.data?.overrides ?? []) {
      if (o.featureKey === 'library' && o.scopeType === 'ORGANIZATION') {
        await api(s, 'DELETE', `/api/v1/features/overrides/${o.id}`);
      }
    }
  });

  test('turns the library module off at organization level', async () => {
    const s = session();
    await s.go('/group/modules');
    const mark = s.mark();
    await expect(s.page.getByLabel('Level')).toBeVisible();
    await expect(libraryRow().locator('input[type=checkbox]')).toBeChecked();
    expect(await drawerTitles(s)).toContain('Library');
    await libraryRow().locator('input[type=checkbox]').click();
    await s.settle();
    await expect(libraryRow().locator('input[type=checkbox]')).not.toBeChecked();
    await expect(libraryRow()).toContainText('ORGANIZATION');
    await expect(libraryRow().getByRole('button', { name: /inherit/i })).toBeVisible();
    // /me is reloaded: the menu disappears right away for the owner too.
    await expect.poll(async () => drawerTitles(s)).not.toContain('Library');
    await s.go('/group/library');
    expect(s.pathname()).toBe('/module-disabled');
    await expectClean(s, mark, 'module off');
  });

  test('a principal loses the library menu and route', async ({ browser }) => {
    const p = await signInFresh(browser, 'north.principal@brightway.demo');
    try {
      await p.go('/institution');
      expect(await drawerTitles(p)).not.toContain('Library');
      await p.go('/institution/library');
      expect(p.pathname()).toBe('/module-disabled');
    } finally {
      await p.close();
    }
  });

  test('"Inherit" turns it back on and the menu returns', async ({ browser }) => {
    const s = session();
    await s.go('/group/modules');
    const mark = s.mark();
    await libraryRow()
      .getByRole('button', { name: /inherit/i })
      .click();
    await s.settle();
    await expect(libraryRow().locator('input[type=checkbox]')).toBeChecked();
    await expect(libraryRow()).not.toContainText('ORGANIZATION');
    await expect(libraryRow().getByRole('button', { name: /inherit/i })).toHaveCount(0);
    await expect.poll(async () => drawerTitles(s)).toContain('Library');
    await expectClean(s, mark, 'module restore');

    const p = await signInFresh(browser, 'north.principal@brightway.demo');
    try {
      await p.go('/institution/library');
      expect(p.pathname()).toBe('/institution/library');
      expect(await drawerTitles(p)).toContain('Library');
    } finally {
      await p.close();
    }
  });
});

test.describe('Modules read-only · group.admin@ vs principal@greenwood.demo', () => {
  test('a principal cannot toggle modules', async ({ browser }) => {
    const s = await signInFresh(browser, 'principal@greenwood.demo');
    try {
      await s.go('/group/modules');
      if (!BLOCKED_PATHS.includes(s.pathname())) {
        const switches = s.page.locator('tbody input[type=checkbox]');
        await expect(switches.first()).toBeVisible();
        const n = await switches.count();
        for (let i = 0; i < n; i++) await expect(switches.nth(i)).toBeDisabled();
        await expect(s.page.getByRole('button', { name: /inherit/i })).toHaveCount(0);
      }
    } finally {
      await s.close();
    }
  });
});

/* ------------------------------------ subscription ----------------------------------- */

const greenwood = org('greenwood');
const invoiceDescription = `E2E UPI test invoice ${tag}`;
const utr = `${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}`;
let invoiceNumber = '';

test.describe('Subscription invoice · superadmin@erp.local raises it', () => {
  const session = signedIn('superadmin@erp.local');

  test('creates an open invoice for Greenwood', async () => {
    const s = session();
    await s.go(`/platform/organizations/${greenwood.id}`);
    const mark = s.mark();
    await s.page.getByRole('button', { name: 'New invoice' }).click();
    const d = dialog(s.page);
    await fill(d, 'Description', invoiceDescription);
    await fill(d, 'Unit price', '1');
    await fill(d, 'Reason (audit)', 'E2E invoice for the UPI pay flow');
    await saveDialog(s, 'Create invoice');
    const notice = s.page.getByText(/Invoice .+ created/);
    await expect(notice).toBeVisible();
    invoiceNumber = (/Invoice (\S+) created/.exec(await notice.innerText()) ?? [])[1] ?? '';
    expect(invoiceNumber).not.toBe('');
    await expectClean(s, mark, 'invoice create');
  });
});

test.describe('Subscription · owner@greenwood.demo', () => {
  const session = signedIn('owner@greenwood.demo');
  const invoice = () => rows(session().page).filter({ hasText: invoiceNumber });

  test('shows the plan, status, usage and the open invoice', async () => {
    const s = session();
    await s.go('/group/subscription');
    const mark = s.mark();
    const plan = s.page.locator('.v-main .v-card').first();
    await expect(plan).toContainText(/enterprise/i);
    await expect(plan.locator('.v-chip').filter({ hasText: 'ACTIVE' })).toBeVisible();
    await expect(plan.locator('.v-chip').filter({ hasText: /^hostel$/ })).toBeVisible();
    await expect(s.page.locator('.v-card').filter({ hasText: 'Usage & limits' })).toContainText(
      'Institutions',
    );
    await expectRow(s.page, invoiceNumber);
    await expect(invoice()).toContainText('Open');
    await expectClean(s, mark, 'subscription page');
  });

  test('opens the UPI pay dialog and refuses an invalid UTR', async () => {
    const s = session();
    const mark = s.mark();
    await invoice()
      .getByRole('button', { name: /pay via upi/i })
      .click();
    await s.settle();
    const d = dialog(s.page);
    await expect(d).toContainText(`Pay ${invoiceNumber}`);
    await expect(d.getByRole('img', { name: 'UPI QR code' })).toBeVisible();
    await expect(d).toContainText(/Pay to \S+@\S+/);
    await fill(d, 'UPI transaction ID (UTR)', 'x!');
    await expect(d.getByText('Enter the UPI transaction reference (UTR)')).toBeVisible();
    await d.getByRole('button', { name: /i have paid/i }).click();
    await s.settle();
    expect((await s.failedSince(mark)).map((c) => c.status)).toEqual([400]);
    await expect(d.locator('.v-alert')).toBeVisible();
    await expect(s.page.locator('.v-dialog.v-overlay--active')).toHaveCount(1);
  });

  test('submits the UTR, which awaits platform verification', async () => {
    const s = session();
    const mark = s.mark();
    const d = dialog(s.page);
    await fill(d, 'UPI transaction ID (UTR)', utr);
    await saveDialog(s, /i have paid/i);
    await expect(
      s.page.getByText('Payment submitted. It will be marked paid once verified.'),
    ).toBeVisible();
    await expect(invoice()).toContainText(`UTR ${utr} — awaiting verification`);
    await expect(invoice().getByRole('button', { name: /pay via upi/i })).toHaveCount(0);
    await expectClean(s, mark, 'UPI payment submit');
  });
});

test.describe('Subscription · group.admin@greenwood.demo (no billing)', () => {
  const session = signedIn('group.admin@greenwood.demo');
  test('cannot open the subscription page', async () => {
    const s = session();
    await s.go('/group');
    expect(await drawerTitles(s)).not.toContain('Subscription');
    await s.go('/group/subscription');
    expect(s.pathname()).toBe('/forbidden');
  });
});

test.describe('Subscription invoice · superadmin@erp.local voids it', () => {
  const session = signedIn('superadmin@erp.local');

  test('sees the submitted UTR and voids the test invoice', async () => {
    const s = session();
    await s.go(`/platform/organizations/${greenwood.id}`);
    const mark = s.mark();
    const invoice = s.page
      .locator('.v-card')
      .filter({ hasText: 'New invoice' })
      .locator('tbody tr')
      .filter({ hasText: invoiceNumber });
    await expect(invoice).toContainText(`UTR ${utr}`);
    await invoice.getByRole('button', { name: /^void$/i }).click();
    const d = dialog(s.page);
    await expect(d).toContainText('Void invoice');
    await fill(d, 'Reason (audit)', 'E2E cleanup of the UPI test invoice');
    await saveDialog(s);
    await expect(invoice.locator('.v-chip')).toHaveText('Void');
    await expectClean(s, mark, 'invoice void');
  });
});

/* ------------------------------ secrets & integrations ------------------------------ */

test.describe('Secrets & integrations · owner@greenwood.demo', () => {
  const session = signedIn('owner@greenwood.demo');
  const secretName = `e2e-${tag}`;
  const secretValue = `sk-e2e-${tag}-WXYZ`;
  const clientName = `E2E client ${tag}`;
  const hookName = `E2E hook ${tag}`;
  const secretRow = () => rows(session().page).filter({ hasText: secretName });

  cleanupAs('owner@greenwood.demo', async (s) => {
    const secrets = (await api(s, 'GET', '/api/v1/secrets?pageSize=100')).json as {
      data?: Array<{ id: string; name: string }>;
    } | null;
    for (const x of secrets?.data?.filter((i) => i.name === secretName) ?? [])
      await api(s, 'DELETE', `/api/v1/secrets/${x.id}`);
    const clients = (await api(s, 'GET', '/api/v1/integrations/api-clients?pageSize=100')).json as {
      data?: Array<{ id: string; name: string; status: string }>;
    } | null;
    for (const c of clients?.data?.filter((i) => i.name === clientName && i.status === 'ACTIVE') ??
      [])
      await api(s, 'POST', `/api/v1/integrations/api-clients/${c.id}/revoke`);
    const hooks = (await api(s, 'GET', '/api/v1/integrations/webhooks?pageSize=100')).json as {
      data?: Array<{ id: string; name: string }>;
    } | null;
    for (const h of hooks?.data?.filter((i) => i.name === hookName) ?? [])
      await api(s, 'DELETE', `/api/v1/integrations/webhooks/${h.id}`);
  });

  test('an invalid secret kind is refused', async () => {
    const s = session();
    await s.go('/group/secrets');
    const mark = s.mark();
    await s.page.getByRole('button', { name: /add secret/i }).click();
    const d = dialog(s.page);
    await fill(d, 'Kind (e.g. smtp, sms, ai.openai)', 'Bad Kind');
    await fill(d, 'Name', secretName);
    await fill(d, 'Secret value', secretValue);
    await d.getByRole('button', { name: 'Save' }).click();
    await s.settle();
    expect((await s.failedSince(mark)).map((c) => c.status)).toEqual([400]);
    expect((await s.errorAlerts()).join(' ')).toMatch(/validation failed|lower-case/i);
    await d.getByRole('button', { name: 'Cancel' }).click();
    await closeErrorAlert(s);
    await expect(secretRow()).toHaveCount(0);
  });

  test('adds a secret whose value is only ever shown masked', async () => {
    const s = session();
    await s.go('/group/secrets');
    const mark = s.mark();
    await s.page.getByRole('button', { name: /add secret/i }).click();
    const d = dialog(s.page);
    await expect(d.getByLabel('Secret value', { exact: true })).toHaveAttribute('type', 'password');
    await fill(d, 'Kind (e.g. smtp, sms, ai.openai)', 'e2e.test');
    await fill(d, 'Name', secretName);
    await fill(d, 'Description', 'E2E masking check');
    await fill(d, 'Secret value', secretValue);
    await saveDialog(s);
    await expectRow(s.page, secretName);
    await expect(secretRow()).toContainText('••••••••WXYZ');
    await expect(secretRow()).toContainText(/fp [0-9a-f]{8}/);
    await expect(s.page.getByText(secretValue)).toHaveCount(0);
    expect(await s.page.content()).not.toContain(secretValue);
    await expectClean(s, mark, 'secret create');
  });

  test('rotates and deletes the secret', async () => {
    const s = session();
    const mark = s.mark();
    await secretRow().getByRole('button', { name: 'Rotate' }).click();
    const d = dialog(s.page);
    await expect(d).toContainText(`Rotate e2e.test/${secretName}`);
    await fill(d, 'Secret value', `sk-e2e-${tag}-ROT2`);
    await saveDialog(s);
    await expect(secretRow()).toContainText('••••••••ROT2');
    s.page.once('dialog', (c) => void c.accept());
    await secretRow().getByRole('button', { name: 'Delete' }).click();
    await s.settle();
    await expect(secretRow()).toHaveCount(0);
    await expectClean(s, mark, 'secret rotate + delete');
  });

  test('creates an API client, shows its secret once and revokes it', async () => {
    const s = session();
    await s.go('/group/integrations');
    const mark = s.mark();
    await s.page.getByRole('button', { name: /new api client/i }).click();
    const d = dialog(s.page);
    await fill(d, 'Name', clientName);
    await saveDialog(s, 'Create');
    const shown = s.page.locator('.v-alert').filter({ hasText: 'copy it now' });
    await expect(shown).toBeVisible();
    await expect(shown.locator('code')).not.toBeEmpty();
    const client = rows(s.page).filter({ hasText: clientName });
    await expect(client).toContainText('ACTIVE');
    await expect(client).toContainText('user.view');
    s.page.once('dialog', (c) => void c.accept());
    await client.getByRole('button', { name: 'Revoke' }).click();
    await s.settle();
    await expect(client).toContainText('REVOKED');
    await expect(client.getByRole('button', { name: 'Revoke' })).toHaveCount(0);
    await expectClean(s, mark, 'api client');
  });

  test('creates, pauses and deletes a webhook', async () => {
    const s = session();
    const mark = s.mark();
    await s.page.getByRole('tab', { name: 'Webhooks' }).click();
    await s.page.getByRole('button', { name: /new webhook/i }).click();
    const d = dialog(s.page);
    await fill(d, 'Name', hookName);
    await fill(d, 'HTTPS URL', 'https://example.com/e2e-webhook');
    await pick(d, 'Events');
    await saveDialog(s, 'Create');
    await expect(s.page.locator('.v-alert').filter({ hasText: 'signing secret' })).toBeVisible();
    const hook = rows(s.page).filter({ hasText: hookName });
    await expect(hook).toContainText('https://example.com/e2e-webhook');
    const active = hook.locator('input[type=checkbox]');
    await expect(active).toBeChecked();
    await active.click();
    await s.settle();
    await expect(active).not.toBeChecked();
    s.page.once('dialog', (c) => void c.accept());
    await hook.getByRole('button', { name: 'Delete' }).click();
    await s.settle();
    await expect(hook).toHaveCount(0);
    await expectClean(s, mark, 'webhook');
  });
});

test.describe('Secrets & integrations read-only · group.admin@greenwood.demo', () => {
  const session = signedIn('group.admin@greenwood.demo');

  test('sees secrets and API clients without manage controls', async () => {
    const s = session();
    await s.go('/group/secrets');
    const mark = s.mark();
    expect(s.pathname()).toBe('/group/secrets');
    await expect(s.page.getByRole('button', { name: /add secret/i })).toHaveCount(0);
    await expect(s.page.getByRole('button', { name: 'Delete' })).toHaveCount(0);
    await expect(s.page.getByRole('button', { name: 'Rotate' })).toHaveCount(0);
    await s.go('/group/integrations');
    await expect(s.page.getByRole('button', { name: /new api client/i })).toHaveCount(0);
    await expect(s.page.getByRole('button', { name: 'Revoke' })).toHaveCount(0);
    await expectClean(s, mark, 'read-only secrets', ['FORBIDDEN', 'SCOPE_DENIED']);
  });
});

test.describe('Secrets & integrations blocked · principal@greenwood.demo', () => {
  const session = signedIn('principal@greenwood.demo');

  test('is sent to /forbidden', async () => {
    const s = session();
    for (const path of ['/group/secrets', '/group/integrations', '/group/ai/settings']) {
      await s.go(path);
      expect(s.pathname(), path).toBe('/forbidden');
    }
  });
});

/* ------------------------------------ AI & branding ---------------------------------- */

test.describe('AI settings & group branding · owner@greenwood.demo', () => {
  const session = signedIn('owner@greenwood.demo');
  let maxTokens = '';
  let website = '';
  const groupLevel = /^Group: /;

  cleanupAs('owner@greenwood.demo', async (s) => {
    if (maxTokens) {
      const cur = (await api(s, 'GET', '/api/v1/ai/settings')).json as {
        data?: Record<string, unknown>;
      } | null;
      if (cur?.data && String(cur.data.maxTokensPerRequest) !== maxTokens) {
        await s.go('/group/ai/settings');
        await s.page.getByLabel('Max tokens per request').fill(maxTokens);
        await s.page.getByRole('button', { name: 'Save', exact: true }).click();
        await s.settle();
      }
    }
  });

  test('saves AI settings and restores them', async () => {
    const s = session();
    await s.go('/group/ai/settings');
    const mark = s.mark();
    const field = s.page.getByLabel('Max tokens per request');
    await expect(field).toBeEnabled();
    maxTokens = await field.inputValue();
    expect(Number(maxTokens)).toBeGreaterThan(0);
    const changed = String(Number(maxTokens) + 1);
    await field.fill(changed);
    await s.page.getByRole('button', { name: 'Save', exact: true }).click();
    await s.settle();
    await expect(s.page.getByText('Settings saved.')).toBeVisible();
    await expect(s.page.getByText(/Last updated/)).toBeVisible();
    await s.go('/group/ai/usage');
    await s.go('/group/ai/settings');
    await expect(s.page.getByLabel('Max tokens per request')).toHaveValue(changed);
    await s.page.getByLabel('Max tokens per request').fill(maxTokens);
    await s.page.getByRole('button', { name: 'Save', exact: true }).click();
    await s.settle();
    await expect(s.page.getByText('Settings saved.')).toBeVisible();
    await expect(s.page.getByLabel('Max tokens per request')).toHaveValue(maxTokens);
    await expectClean(s, mark, 'ai settings');
  });

  test('shows AI usage', async () => {
    const s = session();
    await s.go('/group/ai/usage');
    const mark = s.mark();
    await expect(s.page.getByRole('heading', { name: 'AI usage' })).toBeVisible();
    await expect(s.page.locator('.v-card').filter({ hasText: 'By feature' })).toBeVisible();
    await expectClean(s, mark, 'ai usage');
  });

  test('saves group-level branding and restores it', async () => {
    const s = session();
    await s.go('/group/branding');
    const mark = s.mark();
    await pick(s.page, 'Level', groupLevel);
    await s.settle();
    const field = s.page.getByLabel('Website', { exact: true });
    website = await field.inputValue();
    const changed = `https://e2e-${tag}.example.com`;
    await field.fill(changed);
    await s.page.getByRole('button', { name: 'Save', exact: true }).click();
    await s.settle();
    await expect(s.page.getByText('Branding saved')).toBeVisible();
    // Re-open the level: the saved value is loaded from the server.
    await pick(s.page, 'Level', 'Organization defaults');
    await s.settle();
    await expect(s.page.getByLabel('Website', { exact: true })).not.toHaveValue(changed);
    await pick(s.page, 'Level', groupLevel);
    await s.settle();
    await expect(s.page.getByLabel('Website', { exact: true })).toHaveValue(changed);

    await s.page.getByLabel('Website', { exact: true }).fill(website);
    await s.page.getByRole('button', { name: 'Save', exact: true }).click();
    await s.settle();
    await expect(s.page.getByText('Branding saved')).toBeVisible();
    await expect(s.page.getByLabel('Website', { exact: true })).toHaveValue(website);
    await expectClean(s, mark, 'group branding');
  });
});

test.describe('Group branding read-only · it@greenwood.demo', () => {
  const session = signedIn('it@greenwood.demo');

  test('sees the branding fields read-only and no Save', async () => {
    const s = session();
    await s.go('/group/branding');
    const mark = s.mark();
    expect(s.pathname()).toBe('/group/branding');
    await expect(s.page.getByLabel('Footer text', { exact: true })).toHaveAttribute('readonly', '');
    await expect(s.page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
    await expectClean(s, mark, 'read-only branding');
  });
});

/* -------------------------------------- users ---------------------------------------- */

test.describe('Users · admin@greenwood.demo (institution admin) cannot escalate', () => {
  const session = signedIn('admin@greenwood.demo');
  const email = `e2e.escalate.${tag}@greenwood.demo`;

  async function tryCreate(role: RegExp, roleSearch: string, scope: RegExp, inst?: string) {
    const s = session();
    const mark = s.mark();
    await s.page.getByRole('button', { name: /add user/i }).click();
    const d = dialog(s.page);
    await fill(d, 'Full name', `E2E Escalation ${tag}`);
    await fill(d, 'Email (login)', email);
    await fill(d, 'Initial password (optional)', 'Welcome-2026-Demo!');
    await pick(d, 'Role', role, roleSearch);
    await pick(d, 'Applies to', scope);
    if (inst) {
      // An admin scoped to a single institution gets it pre-selected; otherwise pick it.
      const chip = d.locator('.v-chip').filter({ hasText: inst });
      if ((await chip.count()) === 0) await pick(d, 'Institution', inst);
      await expect(chip).toHaveCount(1);
    }
    await d.getByRole('button', { name: 'Save' }).click();
    await s.settle();
    const failed = await s.failedSince(mark);
    expect(failed.map((c) => c.status)).toEqual([403]);
    await expect(d.locator('.v-alert')).toBeVisible();
    await d.getByRole('button', { name: 'Cancel' }).click();
    return failed[0];
  }

  test('cannot grant a role for the whole organization', async () => {
    const s = session();
    await s.go('/institution/users');
    await tryCreate(/^Librarian/, 'Librarian', /^Whole organization$/);
  });

  test('cannot grant a role above its own permissions in its own institution', async () => {
    const failed = await tryCreate(
      /^Group Owner/,
      'Group Owner',
      /^Institution$/,
      'Greenwood International School',
    );
    expect(failed?.code).toBe('ESCALATION_DENIED');
  });

  test('no user was created', async () => {
    const s = session();
    await fill(s.page, 'Search', email);
    await s.settle();
    await expect(rows(s.page).filter({ hasText: email })).toHaveCount(0);
  });

  test.fixme("an admin resets another user's password", async () => {
    // Product gap: the API has POST /users/:id/password-reset but the Users page has no action.
  });

  test.fixme('a user changes their own password', async () => {
    // Product gap: the API has POST /auth/password/change but there is no profile/password UI.
  });
});

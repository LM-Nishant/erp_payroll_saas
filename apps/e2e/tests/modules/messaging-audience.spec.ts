import { expect, test, type Locator } from '@playwright/test';
import { BLOCKED_PATHS, type AppSession } from '../../src/app';
import { signedIn } from '../../src/session';
import { dialog, expectClean, fill, pick, RUN_ID, rows } from '../../src/ui';

/**
 * Audience messaging + per-institution senders + student fees / hostel / transport, through the UI.
 *  - principal@ configures institution-scoped email / SMS / WhatsApp senders (log type), sends a
 *    test through each, edits one; then sends announcements to the whole institution, a
 *    department and a class section on every channel and finds the institution provider in the
 *    message log; opens a student's Fees / Hostel / Transport tabs and messages the guardians
 *    from the profile and a class section from Classes & sections.
 *  - hod@ may announce only inside their department (whole institution → SCOPE_DENIED).
 *  - student@, parent@, librarian@ and teacher@ get neither Announcements nor provider settings.
 * Everything goes through `log` providers: nothing is really sent.
 */
test.describe.configure({ mode: 'serial' });

const CHANNELS = [
  { key: 'email', label: 'Email', to: 'office@greenwood.demo' },
  { key: 'sms', label: 'SMS', to: '+919800000001' },
  { key: 'whatsapp', label: 'WhatsApp', to: '+919800000002' },
] as const;
const INSTITUTION = 'Greenwood International School';
/** Seeded demo student with invoices, payments, hostel and transport history (+ guardian phones). */
const STUDENT = { admissionNo: 'GWIS-MAIN-2026-0006', name: 'Ira Mehta' };
const senderName = (ch: string) => `E2E ${ch} sender ${RUN_ID}`;

const compose = (s: AppSession) => s.page.getByTestId('compose');

async function previewAndSend(s: AppSession, name: string, body: string, min = 1) {
  const c = compose(s);
  await fill(c, 'Campaign name', name);
  await fill(c, 'Message', body);
  await c.getByTestId('preview-audience').click();
  await s.settle();
  const total = s.page.getByTestId('preview-total');
  await expect(total).toBeVisible();
  expect(Number(await total.innerText()), `${name} recipients`).toBeGreaterThanOrEqual(min);
  await c.getByTestId('send-broadcast').click();
  await s.settle();
  await expect(s.page.locator('.v-alert').filter({ hasText: `"${name}"` })).toBeVisible();
  await expect(campaignRow(s, name)).toBeVisible();
}

const campaignRow = (s: AppSession, name: string): Locator =>
  s.page.getByTestId('campaigns').locator('tbody tr').filter({ hasText: name });

async function openStudent(s: AppSession) {
  await s.go('/institution/students');
  await fill(s.page, 'Search', STUDENT.admissionNo);
  await s.settle();
  await rows(s.page).filter({ hasText: STUDENT.admissionNo }).first().click();
  await s.settle();
  await expect(s.page.getByRole('heading', { name: STUDENT.name })).toBeVisible();
}

async function chooseChannel(s: AppSession, label: string) {
  await compose(s).getByTestId('channel').getByRole('button', { name: label, exact: true }).click();
}

test.describe('Messaging · principal@greenwood.demo', () => {
  const session = signedIn('principal@greenwood.demo');

  test('configures institution-scoped email, SMS and WhatsApp senders and sends a test', async () => {
    const s = session();
    await s.go('/institution/communication');
    const mark = s.mark();
    for (const ch of CHANNELS) {
      await s.page.getByTestId('add-provider').click();
      const d = dialog(s.page);
      await pick(d, 'Used by', 'Institution (own sender)');
      await pick(d, 'Institution', INSTITUTION);
      await pick(d, 'Channel', new RegExp(`^${ch.key}$`));
      await pick(d, 'Provider', /Log only/);
      await fill(d, 'Name', senderName(ch.key));
      await fill(d, 'Priority (lower first)', '900');
      await fill(d, 'Sender shown in the log (email / number / sender ID)', ch.to);
      await d.getByTestId('save-provider').click();
      await s.settle();
      await expect(s.page.locator('.v-dialog.v-overlay--active')).toHaveCount(0);

      const row = rows(s.page).filter({ hasText: senderName(ch.key) });
      await expect(row).toContainText('INSTITUTION');
      await expect(row).toContainText(INSTITUTION);
      await row.getByRole('button', { name: 'Send test' }).click();
      const t = dialog(s.page);
      await fill(t, ch.key === 'email' ? 'Email address' : 'Phone (E.164)', ch.to);
      await t.getByTestId('send-test').click();
      await s.settle();
      await expect(t.getByTestId('test-result')).toContainText(/SENT|DELIVERED/);
      await t.getByRole('button', { name: 'Close' }).click();
    }

    // Edit: the per-type form is pre-filled, credentials stay write-only.
    const row = rows(s.page).filter({ hasText: senderName('sms') });
    await row.locator('[title="Edit"]').click();
    const d = dialog(s.page);
    const sender = d.getByLabel('Sender shown in the log (email / number / sender ID)');
    await expect(sender).toHaveValue('+919800000001');
    await sender.fill('GRNE2E');
    await d.getByTestId('save-provider').click();
    await s.settle();
    await expect(s.page.locator('.v-dialog.v-overlay--active')).toHaveCount(0);
    await expectClean(s, mark, 'institution senders');
  });

  test('announces to the whole institution, a department and a class section on every channel', async () => {
    test.setTimeout(240_000);
    const s = session();
    await s.go('/institution/announcements');
    const mark = s.mark();
    await pick(compose(s), 'Institution', INSTITUTION);
    for (const ch of CHANNELS) {
      await chooseChannel(s, ch.label);

      await pick(compose(s), 'Send to', 'Whole institution');
      await pick(compose(s), 'Recipients', 'Parents / guardians');
      await previewAndSend(
        s,
        `E2E ${ch.key} institution ${RUN_ID}`,
        'Dear {{name}}, PTM on Saturday.',
      );

      await pick(compose(s), 'Send to', 'Department(s)');
      await pick(compose(s), 'Department(s)', /^Academics$/);
      await previewAndSend(
        s,
        `E2E ${ch.key} department ${RUN_ID}`,
        'Dear {{name}}, the Academics department notice for {{studentName}}.',
      );

      await pick(compose(s), 'Send to', 'Class section(s)');
      await pick(compose(s), 'Class section(s)', /^Grade 1 - A$/);
      await previewAndSend(
        s,
        `E2E ${ch.key} section ${RUN_ID}`,
        'Dear {{name}}, Grade 1 - A picnic on Friday.',
      );
    }
    // The page polls while campaigns are queued / sending.
    for (const ch of CHANNELS) {
      for (const what of ['institution', 'department', 'section']) {
        await expect(campaignRow(s, `E2E ${ch.key} ${what} ${RUN_ID}`)).toContainText('COMPLETED', {
          timeout: 60_000,
        });
      }
    }
    await expectClean(s, mark, 'announcements');
  });

  test('the message log shows the institution sender', async () => {
    const s = session();
    await s.go('/institution/communication');
    const mark = s.mark();
    await s.page.getByRole('tab', { name: 'Message log' }).click();
    await s.settle();
    for (const ch of CHANNELS) {
      await pick(s.page, 'Channel filter', new RegExp(`^${ch.key}$`));
      await s.settle();
      const row = rows(s.page)
        .filter({ hasText: `Greenwood ${ch.key} (log only)` })
        .first();
      await expect(row).toBeVisible();
      await expect(row).toContainText('INSTITUTION');
    }
    await expectClean(s, mark, 'message log');
  });

  test("messages one student's guardians from the profile", async () => {
    const s = session();
    const mark = s.mark();
    await openStudent(s);
    // Principal: fees yes; hostel / transport belong to their own managers.
    await expect(s.page.getByRole('tab', { name: 'Fees' })).toBeVisible();
    await expect(s.page.getByRole('tab', { name: 'Hostel' })).toHaveCount(0);
    await s.page.getByTestId('message-student').click();
    await s.settle();
    await expect(s.page).toHaveURL(/\/institution\/announcements\?.*type=students/);
    await expect(compose(s)).toContainText(STUDENT.name);
    await chooseChannel(s, 'SMS');
    await previewAndSend(
      s,
      `E2E guardians of ${STUDENT.name} ${RUN_ID}`,
      'Dear {{name}}, please meet the class teacher.',
    );
    await expectClean(s, mark, 'message from profile');
  });

  test('messages a class section from Classes & sections', async () => {
    const s = session();
    await s.go('/institution/classes');
    const mark = s.mark();
    await s.page.getByTestId('message-class-GW-G1').click();
    await s.page
      .locator('.v-menu.v-overlay--active .v-list-item')
      .filter({ hasText: /Section (Grade 1 - )?A\b/ })
      .click();
    await s.settle();
    await expect(s.page).toHaveURL(/\/institution\/announcements\?.*type=class_section/);
    await chooseChannel(s, 'WhatsApp');
    await previewAndSend(
      s,
      `E2E class section WhatsApp ${RUN_ID}`,
      'Dear {{name}}, homework is online.',
    );
    await expectClean(s, mark, 'message from classes');
  });

  test('removes the E2E senders', async () => {
    const s = session();
    s.page.on('dialog', (d) => void d.accept());
    await s.go('/institution/communication');
    for (const ch of CHANNELS) {
      const row = rows(s.page).filter({ hasText: senderName(ch.key) });
      await row.locator('[title="Delete"]').click();
      await s.settle();
      await expect(row).toHaveCount(0);
    }
  });
});

test.describe('Student profile · admin@greenwood.demo', () => {
  const session = signedIn('admin@greenwood.demo');

  test('shows fees, hostel and transport with links to act', async () => {
    const s = session();
    const mark = s.mark();
    await openStudent(s);

    await s.page.getByRole('tab', { name: 'Fees' }).click();
    await s.settle();
    const fees = s.page.getByTestId('student-fees');
    await expect(fees.getByTestId('fees-due')).toBeVisible();
    await expect(fees.locator('tbody tr').first()).not.toContainText('No invoices yet');
    await expect(fees.locator('[title="Download receipt"]').first()).toBeVisible();

    await s.page.getByRole('tab', { name: 'Hostel' }).click();
    await s.settle();
    const hostel = s.page.getByTestId('student-hostel');
    await expect(hostel).toContainText('Room');
    await expect(hostel.locator('tbody tr').first()).not.toContainText('No hostel history');

    await s.page.getByRole('tab', { name: 'Transport' }).click();
    await s.settle();
    const transport = s.page.getByTestId('student-transport');
    await expect(transport).toContainText('Vehicle');
    await expect(transport.locator('tbody tr').first()).not.toContainText('No transport history');
    await transport
      .getByRole('link', { name: /Manage allocations|Transport allocations/ })
      .first()
      .click();
    await expect(s.page).toHaveURL(/\/institution\/transport\/allocations$/);
    await s.settle();
    await expectClean(s, mark, 'student fees / hostel / transport');
  });
});

test.describe('Messaging scope · hod@greenwood.demo', () => {
  const session = signedIn('hod@greenwood.demo');

  test('may announce to their department but not the whole institution', async () => {
    const s = session();
    await s.go('/institution/announcements');
    expect(BLOCKED_PATHS).not.toContain(s.pathname());
    await pick(compose(s), 'Send to', 'Whole institution');
    await fill(compose(s), 'Message', 'Dear {{name}}, department meeting.');
    await compose(s).getByTestId('preview-audience').click();
    await s.settle();
    await expect(s.page.locator('.v-alert').filter({ hasText: /inside your scope/ })).toBeVisible();
    // …but their own department is fine.
    await pick(compose(s), 'Send to', 'Department(s)');
    await pick(compose(s), 'Department(s)', /^Academics$/);
    await compose(s).getByTestId('preview-audience').click();
    await s.settle();
    await expect(s.page.getByTestId('preview-total')).toBeVisible();
    // Provider settings stay with the principal / admins.
    await s.go('/institution/communication');
    expect(BLOCKED_PATHS).toContain(s.pathname());
  });
});

for (const email of [
  'student@greenwood.demo',
  'parent@greenwood.demo',
  'librarian@greenwood.demo',
  'teacher@greenwood.demo',
]) {
  test.describe(`Messaging denied · ${email}`, () => {
    const session = signedIn(email);

    test('has no Announcements / provider settings and is blocked by URL', async () => {
      const s = session();
      for (const path of ['/institution/announcements', '/institution/communication']) {
        await s.go(path);
        expect(BLOCKED_PATHS, path).toContain(s.pathname());
        await expect(s.page.locator(`a[href="${path}"]`)).toHaveCount(0);
      }
    });
  });
}

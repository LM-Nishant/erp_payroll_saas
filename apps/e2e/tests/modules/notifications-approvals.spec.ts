import { expect, test, type Locator } from '@playwright/test';
import { signedIn } from '../../src/session';
import { dialog, expectClean, expectRow, fill, RUN_ID, rows, saveDialog } from '../../src/ui';

/**
 * Notifications and the approvals inbox (Greenwood), driven by a real workflow:
 *  - librarian@ requests a profile change (workflow `employee_profile_change`, approvers: any
 *    HR manager / group HR);
 *  - group.hr@ gets an "Approval needed" notification, marks it read, follows its link straight
 *    into the request, comments on it and marks everything read;
 *  - hr@ sees the same request in the HR inbox and rejects it;
 *  - transport@ (no approval rights) has nothing actionable, not even through the direct link;
 *  - librarian@ sees the outcome under "My requests" and the rejection notification.
 */
test.describe.configure({ mode: 'serial' });
const tag = `${RUN_ID.toLowerCase()}${Math.floor(Math.random() * 1e4)}`;
const REQUEST = /Profile change: .*\(GWIS-MAIN-0018\)/;
const reason = `E2E profile change ${tag}`;
const comment = `E2E comment ${tag}`;
const phone = `98${String(Date.now()).slice(-8)}`;
let instanceId = '';

const notification = (scope: Locator, title: RegExp) =>
  scope.locator('.v-list-item').filter({ hasText: title }).first();

test.describe('Profile change request · librarian@greenwood.demo', () => {
  const session = signedIn('librarian@greenwood.demo');

  test('cancels a leftover pending request from an aborted run', async () => {
    const s = session();
    await s.go('/employee/approvals');
    await s.page.getByRole('tab', { name: 'My requests' }).click();
    const pending = rows(s.page).filter({ hasText: REQUEST }).filter({ hasText: 'PENDING' });
    while (await pending.count()) {
      await pending.first().click();
      s.page.once('dialog', (c) => void c.accept());
      await dialog(s.page)
        .getByRole('button', { name: /withdraw request/i })
        .click();
      await s.settle();
      await expect(
        dialog(s.page).locator('.v-chip').filter({ hasText: 'CANCELLED' }).first(),
      ).toBeVisible();
      await dialog(s.page)
        .getByRole('button', { name: /^close$/i })
        .click();
      await s.settle();
    }
  });

  test('submits a profile change from My profile', async () => {
    const s = session();
    await s.go('/employee/profile');
    const mark = s.mark();
    await s.page.getByRole('button', { name: /request changes/i }).click();
    const d = dialog(s.page);
    await expect(d).toContainText('Request profile changes');
    await fill(d, 'Personal phone', phone);
    await fill(d, 'Reason', reason);
    await saveDialog(s, /submit/i);
    await expect(s.page.getByText('Change request submitted.')).toBeVisible();
    await expect(s.page.locator('.v-card').filter({ hasText: 'My change requests' })).toContainText(
      /Personal\s*phone/i,
    );
    // One pending request at a time: the button gives way to a notice and a withdraw link.
    await expect(s.page.getByText('A change request is awaiting approval')).toBeVisible();
    await expect(s.page.getByRole('button', { name: /request changes/i })).toHaveCount(0);
    await expect(s.page.getByRole('link', { name: /view \/ withdraw/i })).toHaveCount(1);
    await expectClean(s, mark, 'profile change request');
  });

  test('the requester has nothing to approve on their own request', async () => {
    const s = session();
    await s.go('/employee/approvals');
    const mark = s.mark();
    await expect(rows(s.page).filter({ hasText: REQUEST })).toHaveCount(0);
    await s.page.getByRole('tab', { name: 'My requests' }).click();
    await rows(s.page).filter({ hasText: REQUEST }).filter({ hasText: 'PENDING' }).first().click();
    await s.settle();
    const d = dialog(s.page);
    await expect(d.locator('.v-card-title')).toContainText(REQUEST);
    await expect(d.getByRole('button', { name: /^approve$/i })).toHaveCount(0);
    await expect(d.getByRole('button', { name: /^reject$/i })).toHaveCount(0);
    // The requester withdraws; "Cancel request (admin)" is only for other managers.
    await expect(d.getByRole('button', { name: /withdraw request/i })).toBeVisible();
    await d.getByRole('button', { name: /^close$/i }).click();
    await expectClean(s, mark, 'my requests');
  });
});

test.describe('Approval notification · group.hr@greenwood.demo', () => {
  const session = signedIn('group.hr@greenwood.demo');
  const list = () => session().page.locator('.v-main .v-card').first();

  test('lists the approval notification as unread and marks it read', async () => {
    const s = session();
    await s.go('/group/notifications');
    const mark = s.mark();
    const item = notification(list(), /Approval needed: Profile change: .*GWIS-MAIN-0018/);
    await expect(item).toBeVisible();
    await expect(item).toHaveClass(/font-weight-bold/);
    await expect(item).toContainText('waiting for your decision');
    await item.getByRole('button', { name: 'Mark read' }).click();
    await s.settle();
    expect(s.pathname()).toBe('/group/notifications');
    await expect(item).not.toHaveClass(/font-weight-bold/);
    await expect(item.getByRole('button', { name: 'Mark read' })).toHaveCount(0);
    await expectClean(s, mark, 'mark read');
  });

  test('the notification link opens the request in the group approvals inbox', async () => {
    const s = session();
    const mark = s.mark();
    await notification(list(), /Approval needed: Profile change: .*GWIS-MAIN-0018/).click();
    await s.settle();
    await expect(s.page).toHaveURL(/\/group\/approvals\?open=[0-9a-f-]{36}$/);
    instanceId = new URL(s.page.url()).searchParams.get('open') ?? '';
    const d = dialog(s.page);
    await expect(d.locator('.v-card-title')).toContainText(REQUEST);
    await expect(d.locator('.v-chip').filter({ hasText: 'PENDING' }).first()).toBeVisible();
    await expect(d.getByRole('button', { name: /^approve$/i })).toBeVisible();
    await expectClean(s, mark, 'notification link');
  });

  test('comments on the request without deciding it', async () => {
    const s = session();
    const mark = s.mark();
    const d = dialog(s.page);
    const send = d.getByRole('button', { name: /^comment$/i });
    await expect(send).toBeDisabled();
    await fill(d, 'Comment', comment);
    await send.click();
    await s.settle();
    await expect(d).toContainText(`“${comment}”`);
    await expect(d.locator('.v-chip').filter({ hasText: 'PENDING' }).first()).toBeVisible();
    await d.getByRole('button', { name: /^close$/i }).click();
    await expectRow(s.page, REQUEST);
    await expectClean(s, mark, 'comment');
  });

  test('marks all notifications read', async () => {
    const s = session();
    await s.go('/group/notifications');
    const mark = s.mark();
    await s.page.getByRole('button', { name: /mark all read/i }).click();
    await s.settle();
    await expect(list().locator('.v-list-item.font-weight-bold')).toHaveCount(0);
    await s.page.getByLabel('Unread only').check();
    await s.settle();
    await expect(list().getByText('No notifications')).toBeVisible();
    await s.page.getByLabel('Unread only').uncheck();
    await s.settle();
    await expect(list().locator('.v-list-item').first()).toBeVisible();
    await expectClean(s, mark, 'mark all read');
  });
});

test.describe('HR inbox · hr@greenwood.demo', () => {
  const session = signedIn('hr@greenwood.demo');

  test('the request is pending in the HR approvals inbox', async () => {
    const s = session();
    await s.go('/hr/approvals');
    const mark = s.mark();
    await expect(s.page.getByRole('tab', { name: /Pending my approval \(\d+\)/ })).toBeVisible();
    await expectRow(s.page, REQUEST);
    await rows(s.page).filter({ hasText: REQUEST }).first().click();
    await s.settle();
    const d = dialog(s.page);
    await expect(d).toContainText(`“${comment}”`);
    await expect(d).toContainText('employee_profile_change');
    await expectClean(s, mark, 'hr inbox');
  });

  test('rejects it with a reason', async () => {
    const s = session();
    const mark = s.mark();
    const d = dialog(s.page);
    await fill(d, 'Comment', `Rejected by E2E ${tag}`);
    await d.getByRole('button', { name: /^reject$/i }).click();
    await s.settle();
    await expect(d.locator('.v-chip').filter({ hasText: 'REJECTED' }).first()).toBeVisible();
    await expect(d.getByRole('button', { name: /^approve$/i })).toHaveCount(0);
    await d.getByRole('button', { name: /^close$/i }).click();
    await expect(
      rows(s.page).filter({ hasText: REQUEST }).filter({ hasText: 'PENDING' }),
    ).toHaveCount(0);
    await expectClean(s, mark, 'reject');
  });
});

test.describe('No approval rights · transport@greenwood.demo', () => {
  const session = signedIn('transport@greenwood.demo');

  test('sees nothing actionable, even through the direct approval link', async () => {
    const s = session();
    expect(instanceId, 'instance id captured from the notification link').not.toBe('');
    await s.go('/employee/approvals');
    await expect(rows(s.page).filter({ hasText: REQUEST })).toHaveCount(0);
    const mark = s.mark();
    await s.go(`/approvals/${instanceId}`);
    await expect(s.page).toHaveURL(/\/employee\/approvals\?open=/);
    const failed = await s.failedSince(mark);
    expect(failed.map((c) => `${c.method} ${c.path.split('?')[0]}`)).toEqual([
      `GET /api/v1/workflows/instances/${instanceId}`,
    ]);
    expect([403, 404]).toContain(failed[0]?.status);
    await expect(s.page.locator('.v-alert.bg-error, .v-alert.text-error').first()).toBeVisible();
    await expect(s.page.locator('.v-dialog.v-overlay--active')).toHaveCount(0);
    await expect(s.page.getByRole('button', { name: /^approve$/i })).toHaveCount(0);
  });
});

test.describe('Outcome · librarian@greenwood.demo', () => {
  const session = signedIn('librarian@greenwood.demo');

  test('my request shows the rejection with its history', async () => {
    const s = session();
    await s.go('/employee/approvals');
    const mark = s.mark();
    await s.page.getByRole('tab', { name: 'My requests' }).click();
    await s.settle();
    await rows(s.page).filter({ hasText: REQUEST }).filter({ hasText: 'REJECTED' }).first().click();
    await s.settle();
    const d = dialog(s.page);
    await expect(d).toContainText(`Rejected by E2E ${tag}`);
    await expect(d.getByRole('button', { name: /cancel request/i })).toHaveCount(0);
    await d.getByRole('button', { name: /^close$/i }).click();
    await expectClean(s, mark, 'my request outcome');
  });

  test('gets the rejection notification, whose link opens My profile', async () => {
    const s = session();
    await s.go('/employee/notifications');
    const mark = s.mark();
    const list = s.page.locator('.v-main .v-card').first();
    const item = notification(list, /Your profile change was rejected/);
    await expect(item).toBeVisible();
    await expect(item).toContainText(`Rejected by E2E ${tag}`);
    await expect(item).toHaveClass(/font-weight-bold/);
    await item.getByRole('button', { name: 'Mark read' }).click();
    await s.settle();
    await expect(item).not.toHaveClass(/font-weight-bold/);
    await item.click();
    await s.settle();
    await expect(s.page).toHaveURL(/\/employee\/profile$/);
    await expect(s.page.getByRole('heading', { name: 'My profile' })).toBeVisible();
    await expectClean(s, mark, 'rejection notification');
  });
});

test.describe('Approvals inboxes per workspace', () => {
  for (const [email, path] of [
    ['admin@greenwood.demo', '/institution/approvals'],
    ['owner@greenwood.demo', '/group/approvals'],
    ['assets@greenwood.demo', '/assets/approvals'],
  ] as const) {
    test.describe(email, () => {
      const session = signedIn(email);
      test(`${path} and its notifications page load`, async () => {
        const s = session();
        await s.go(path);
        const mark = s.mark();
        expect(s.pathname()).toBe(path);
        await expect(
          s.page.getByRole('tab', { name: /Pending my approval \(\d+\)/ }),
        ).toBeVisible();
        await s.page.getByRole('tab', { name: 'My requests' }).click();
        await s.settle();
        await s.go(path.replace('approvals', 'notifications'));
        await expect(s.page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
        await expect(s.page.getByText('Delivery preferences')).toBeVisible();
        await expectClean(s, mark, `${path} + notifications`);
      });
    });
  }
});

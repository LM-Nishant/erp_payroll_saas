import { expect, test, type Locator } from '@playwright/test';
import { signedIn } from '../../src/session';
import { dialog, expectClean, fill, pick, saveDialog, uniq } from '../../src/ui';

/**
 * Admission row actions as the principal: each status only offers the moves the API accepts,
 * a mistaken rejection can be reopened and enrolled, and non-enrolled applications can be deleted.
 */
test.describe('Admission actions · principal@greenwood.demo', () => {
  test.describe.configure({ mode: 'serial' });
  const session = signedIn('principal@greenwood.demo');
  const reopened = uniq('Reopen').replace(/-/g, '');
  const removed = uniq('Remove').replace(/-/g, '');

  const row = (name: string) => session().page.locator('tbody tr').filter({ hasText: name });

  async function show(status: string) {
    const s = session();
    await pick(s.page, 'Status', new RegExp(`^${status}$`));
    await s.settle();
  }

  async function expectButtons(r: Locator, expected: string[]) {
    await expect(r).toBeVisible();
    const names = (await r.getByRole('button').allInnerTexts())
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean);
    expect(names).toEqual(expected.map((n) => n.toUpperCase()));
  }

  async function create(name: string) {
    const s = session();
    await s.page.getByRole('button', { name: 'New application' }).click();
    const d = dialog(s.page);
    await pick(d, 'Program', /^Grade 4/, 'Grade 4');
    await fill(d, 'Applicant first name', name);
    await fill(d, 'Applicant last name', 'E2E');
    await fill(d, 'Guardian name', `Guardian ${name}`);
    await saveDialog(s, 'Create');
  }

  async function reject(name: string, reason: string) {
    const s = session();
    await row(name).getByRole('button', { name: 'Reject' }).click();
    const d = dialog(s.page);
    await expect(d).toContainText('can be reopened later');
    await fill(d, 'Reason (optional)', reason);
    await saveDialog(s, 'Reject');
  }

  test('a new application offers review, waitlist, approve, reject and delete', async () => {
    const s = session();
    await s.go('/institution/admissions');
    const mark = s.mark();
    await create(reopened);
    await create(removed);
    await show('SUBMITTED');
    await expectButtons(row(reopened), ['Review', 'Waitlist', 'Approve', 'Reject']);
    await expect(row(reopened).getByRole('button', { name: /Delete/ })).toBeVisible();
    await expectClean(s, mark, 'admission create');
  });

  test('a rejected application can only be reopened or deleted', async () => {
    const s = session();
    const mark = s.mark();
    await reject(reopened, 'Rejected by mistake');
    await show('REJECTED');
    await expect(row(reopened)).toContainText('REJECTED');
    await expect(row(reopened)).toContainText('Rejected by mistake');
    await expectButtons(row(reopened), ['Reopen']);
    await expect(row(reopened).getByRole('button', { name: /Delete/ })).toBeVisible();
    await expectClean(s, mark, 'admission reject');
  });

  test('reopening a mistaken rejection allows approval and enrollment', async () => {
    const s = session();
    const mark = s.mark();
    await row(reopened).getByRole('button', { name: 'Reopen' }).click();
    const d = dialog(s.page);
    await fill(d, 'Reason (optional)', 'Rejected by mistake');
    await saveDialog(s, 'Reopen');
    await show('UNDER_REVIEW');
    await expectButtons(row(reopened), ['Waitlist', 'Approve', 'Reject']);
    await row(reopened).getByRole('button', { name: 'Approve' }).click();
    await s.settle();
    await show('APPROVED');
    await expectButtons(row(reopened), ['Enroll', 'Reject']);

    await row(reopened).getByRole('button', { name: 'Enroll' }).click();
    const e = dialog(s.page);
    // No class was chosen on the application: Enroll stays disabled until one is picked.
    await expect(e.getByRole('button', { name: 'Enroll', exact: true })).toBeDisabled();
    await pick(e, 'Class section', /Grade 4/);
    await saveDialog(s, 'Enroll');
    await show('ENROLLED');
    await expect(row(reopened)).toContainText('ENROLLED');
    await expect(row(reopened).getByRole('button', { name: /Delete/ })).toHaveCount(0);
    await expectClean(s, mark, 'reopen → approve → enroll');
  });

  test('the enrolled applicant links to the new student profile', async () => {
    const s = session();
    const mark = s.mark();
    await row(reopened).getByRole('link', { name: 'View student' }).click();
    await expect(s.page).toHaveURL(/\/institution\/students\/[0-9a-f-]{36}/);
    await s.settle();
    await expect(s.page.getByText(reopened).first()).toBeVisible();
    await expectClean(s, mark, 'view enrolled student');
  });

  test('a rejected application can be deleted', async () => {
    const s = session();
    await s.go('/institution/admissions');
    const mark = s.mark();
    await show('SUBMITTED');
    await reject(removed, 'Duplicate application');
    await show('REJECTED');
    await row(removed)
      .getByRole('button', { name: /Delete/ })
      .click();
    const d = dialog(s.page);
    await expect(d).toContainText(removed);
    await saveDialog(s, 'Delete');
    await expect(row(removed)).toHaveCount(0);
    await expectClean(s, mark, 'admission delete');
  });
});

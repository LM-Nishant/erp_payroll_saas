import { expect, test } from '@playwright/test';
import { signedIn } from '../../src/session';
import { dialog, expectClean, fill, pick, saveDialog, uniq } from '../../src/ui';

/**
 * Academics as the principal: class + sections (bulk), an extra section, a subject, the
 * subject-teacher allocation and a timetable cell — each verified in the UI afterwards.
 */
test.describe('Academics · principal@greenwood.demo', () => {
  test.describe.configure({ mode: 'serial' });
  const session = signedIn('principal@greenwood.demo');
  const cls = `E2E Class ${uniq('C')}`;
  const subject = `E2E Science ${uniq('S')}`;
  const room = uniq('R');

  test('creates a class with sections A and B', async () => {
    const s = session();
    await s.go('/institution/classes');
    const mark = s.mark();
    await s.page.getByRole('button', { name: /Add classes & sections/ }).click();
    const d = dialog(s.page);
    await fill(d, 'Classes (one per line)', cls);
    await fill(d, 'Sections in every class', 'A, B');
    await fill(d, 'Seats per section', '30');
    await saveDialog(s, 'Create');
    const row = s.page.locator('tbody tr').filter({ hasText: cls });
    await expect(row).toBeVisible();
    await expect(row.locator('.v-chip')).toHaveCount(2);
    await expectClean(s, mark, 'bulk class create');
  });

  test('adds section C to the class', async () => {
    const s = session();
    const mark = s.mark();
    const row = s.page.locator('tbody tr').filter({ hasText: cls });
    await row.getByRole('button', { name: 'Add section' }).click();
    const d = dialog(s.page);
    await fill(d, 'Section name', `${cls} C`);
    await fill(d, 'Seats', '25');
    await saveDialog(s);
    await expect(row.locator('.v-chip')).toHaveCount(3);
    await expect(row.getByText(`${cls} C`)).toBeVisible();
    await expectClean(s, mark, 'add section');
  });

  test('creates a subject for the class', async () => {
    const s = session();
    await s.go('/institution/subjects');
    const mark = s.mark();
    await s.page.getByRole('button', { name: 'New subject' }).click();
    const d = dialog(s.page);
    await pick(d, 'Program', cls, cls);
    await fill(d, 'Code', uniq('SC').replace(/-/g, '').slice(0, 10));
    await fill(d, 'Name', subject);
    await fill(d, 'Max marks', '100');
    await fill(d, 'Pass marks', '35');
    await saveDialog(s);
    await fill(s.page, 'Search', subject);
    await s.settle();
    await expect(s.page.locator('tbody tr').filter({ hasText: subject })).toBeVisible();
    await expectClean(s, mark, 'subject create');
  });

  test('allocates a teacher to the subject in section A', async () => {
    const s = session();
    await s.go('/institution/subject-allocations');
    const mark = s.mark();
    await pick(s.page, 'Class section', new RegExp(`${cls}.*A|A.*${cls}`), cls);
    await s.settle();
    await pick(s.page, 'Subject', subject);
    await pick(s.page, 'Teacher', /Teacher|Kumar|Sharma|./);
    await s.page.getByRole('button', { name: 'Allocate' }).click();
    await s.settle();
    await expect(s.page.locator('tbody tr').filter({ hasText: subject })).toBeVisible();
    await expectClean(s, mark, 'allocation');
  });

  test('sets a timetable cell for section A', async () => {
    const s = session();
    await s.go('/institution/timetable');
    const mark = s.mark();
    await pick(s.page, 'Class section', new RegExp(`${cls}.*A|A.*${cls}`), cls);
    await s.settle();
    await s.page.getByRole('button', { name: 'Edit' }).click();
    await s.page.locator('.timetable-grid td.cursor-pointer').first().click();
    const d = dialog(s.page);
    await pick(d, 'Subject', subject);
    await fill(d, 'Room', room);
    await d.getByRole('button', { name: 'Apply' }).click();
    await s.page.getByRole('button', { name: 'Save', exact: true }).click();
    await s.settle();
    // A clash with the teacher's other periods is a warning the principal may override.
    const anyway = s.page.getByRole('button', { name: 'Save anyway' });
    if (await anyway.isVisible()) {
      await anyway.click();
      await s.settle();
    }
    await expect(s.page.locator('.timetable-grid').getByText(room)).toBeVisible();
    await expectClean(s, mark, 'timetable save', ['TIMETABLE_CLASH']);
  });
});

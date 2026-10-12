import { expect, test, type Locator, type Page } from '@playwright/test';
import { signedIn } from '../../src/session';
import {
  dialog,
  expectClean,
  expectDownload,
  fill,
  isoDate,
  pick,
  saveDialog,
  uniq,
} from '../../src/ui';

const OLD_TC = {
  name: 'previous-tc.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4\n% previous school TC (e2e)\n%%EOF\n'),
};

/** Fills the previous-school form in the top dialog and saves it (the dialog may be nested). */
async function addPreviousSchool(
  page: Page,
  scope: Locator,
  r: { school: string; board: string; lastClass: string; year: string; marks: string; tc: string },
  upload = false,
) {
  const openBefore = await page.locator('.v-dialog.v-overlay--active').count();
  await scope.getByRole('button', { name: 'Add previous school' }).click();
  const d = dialog(page);
  await expect(d).toContainText('previous school', { ignoreCase: true });
  await fill(d, 'School name', r.school);
  await fill(d, 'Board', r.board);
  await fill(d, 'Last class', r.lastClass);
  await fill(d, 'Year', r.year);
  await fill(d, 'Marks %', r.marks);
  await fill(d, 'Old TC no.', r.tc);
  await fill(d, 'TC date', '2026-03-31');
  if (upload) await d.locator('input[type=file]').setInputFiles(OLD_TC);
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.v-dialog.v-overlay--active')).toHaveCount(openBefore);
}

/**
 * Previous-school records, transfer certificates (TC) and character certificates (CC):
 * the registrar records previous schools on an admission and on the student, issues / downloads
 * a TC and a CC, is blocked by pending fee dues, cancels and reissues; the student and parent
 * download their own certificate from the portal.
 */
test.describe('Previous schools & certificates · registrar@greenwood.demo', () => {
  test.describe.configure({ mode: 'serial' });
  const session = signedIn('registrar@greenwood.demo');
  const applicant = uniq('Tc').replace(/-/g, '');
  const firstSchool = `St. Mary Convent ${applicant}`;
  const secondSchool = `Little Flowers ${applicant}`;
  let tcNo = '';

  const appRow = (name: string) => session().page.locator('tbody tr').filter({ hasText: name });
  const certRows = () => session().page.getByTestId('certificates-table').locator('tbody tr');

  async function show(status: string) {
    const s = session();
    await pick(s.page, 'Status', new RegExp(`^${status}$`));
    await s.settle();
  }

  test('records a previous school (with the old TC upload) on a new admission', async () => {
    const s = session();
    await s.go('/institution/admissions');
    const mark = s.mark();
    await s.page.getByRole('button', { name: 'New application' }).click();
    const d = dialog(s.page);
    await pick(d, 'Program', /^Grade 4/, 'Grade 4');
    await fill(d, 'Applicant first name', applicant);
    await fill(d, 'Applicant last name', 'E2E');
    await fill(d, 'Guardian name', `Guardian ${applicant}`);
    await saveDialog(s, 'Create');

    await show('SUBMITTED');
    await appRow(applicant)
      .getByRole('button', { name: /^Previous school of/ })
      .click();
    const outer = dialog(s.page);
    await expect(outer).toContainText(applicant);
    await addPreviousSchool(
      s.page,
      outer,
      {
        school: firstSchool,
        board: 'CBSE',
        lastClass: 'Grade 3',
        year: '2025-26',
        marks: '88.5',
        tc: 'SMC/TC/2026/117',
      },
      true,
    );
    await s.settle();
    const table = outer.getByTestId('previous-schools-table');
    await expect(table).toContainText(firstSchool);
    await expect(table).toContainText('SMC/TC/2026/117');
    await expect(table).toContainText('88.5');
    await outer.getByRole('button', { name: 'Close' }).click();
    await expect(s.page.locator('.v-dialog.v-overlay--active')).toHaveCount(0);
    await expectClean(s, mark, 'admission previous school');
  });

  test('enrolling carries the record to the student, where another can be added', async () => {
    const s = session();
    const mark = s.mark();
    await appRow(applicant).getByRole('button', { name: 'Approve' }).click();
    await s.settle();
    await show('APPROVED');
    await appRow(applicant).getByRole('button', { name: 'Enroll' }).click();
    await pick(dialog(s.page), 'Class section', /Grade 4/);
    await saveDialog(s, 'Enroll');
    await show('ENROLLED');
    const href = await appRow(applicant)
      .getByRole('link', { name: 'View student' })
      .getAttribute('href');
    expect(href).toBeTruthy();
    await s.go(href!);
    await expect(s.page).toHaveURL(/\/institution\/students\/[0-9a-f-]{36}/);
    await s.settle();

    await s.page.getByRole('tab', { name: 'Previous schools' }).click();
    const table = s.page.getByTestId('previous-schools-table');
    await expect(table).toContainText(firstSchool);
    await addPreviousSchool(s.page, s.page.locator('.v-window-item--active'), {
      school: secondSchool,
      board: 'State Board',
      lastClass: 'Grade 2',
      year: '2024-25',
      marks: '79',
      tc: 'LF/TC/2025/042',
    });
    await s.settle();
    await expect(table).toContainText(secondSchool);
    // the uploaded TC of the admission record is downloadable from the student
    await expectDownload(s.page, () =>
      table
        .locator('tr', { hasText: firstSchool })
        .getByRole('button', { name: OLD_TC.name })
        .first()
        .click(),
    );
    await expectClean(s, mark, 'student previous schools');
  });

  test('issues a transfer certificate and a character certificate and downloads both PDFs', async () => {
    const s = session();
    const mark = s.mark();
    await s.page.getByRole('tab', { name: 'Certificates' }).click();
    await s.settle();

    await s.page.getByRole('button', { name: 'Issue TC' }).click();
    let d = dialog(s.page);
    await expect(d).toContainText('Issue transfer certificate');
    await fill(d, 'Date of leaving', isoDate());
    await fill(d, 'Reason for leaving', 'Family relocation');
    await fill(d, 'Conduct', 'Good');
    await saveDialog(s, 'Issue');
    const tc = certRows().filter({ hasText: 'TC' }).filter({ hasText: 'ISSUED' });
    await expect(tc).toHaveCount(1);
    tcNo = ((await tc.locator('strong').first().innerText()) ?? '').trim();
    expect(tcNo).toMatch(/^GWIS-MAIN\/TC\/\d{4}\/\d{4}$/);
    await expect(s.page.getByRole('button', { name: 'Issue TC' })).toBeDisabled();
    await expectDownload(s.page, () => tc.getByRole('button', { name: 'PDF' }).click());

    await s.page.getByRole('button', { name: 'Issue character certificate' }).click();
    d = dialog(s.page);
    await fill(d, 'Conduct', 'Very good');
    await fill(d, 'Remarks', 'Regular and disciplined');
    await saveDialog(s, 'Issue');
    const cc = certRows().filter({ hasText: 'Character' }).filter({ hasText: 'ISSUED' });
    await expect(cc).toHaveCount(1);
    await expect(cc).toContainText('Very good');
    await expectDownload(s.page, () => cc.getByRole('button', { name: 'PDF' }).click());
    // a TC withdraws the student
    await s.page.getByRole('tab', { name: 'Profile' }).click();
    await expect(s.page.getByText('WITHDRAWN').first()).toBeVisible();
    await expectClean(s, mark, 'issue TC + CC');
  });

  test('cancels the character certificate and reissues the TC under a new number', async () => {
    const s = session();
    const mark = s.mark();
    await s.page.getByRole('tab', { name: 'Certificates' }).click();
    const cc = certRows().filter({ hasText: 'Character' }).filter({ hasText: 'ISSUED' });
    await cc.getByRole('button', { name: 'Cancel' }).click();
    let d = dialog(s.page);
    await fill(d, 'Reason', 'Issued with wrong remarks');
    await saveDialog(s, 'Cancel certificate');
    await expect(
      certRows().filter({ hasText: 'Character' }).filter({ hasText: 'CANCELLED' }),
    ).toHaveCount(1);

    await certRows().filter({ hasText: tcNo }).getByRole('button', { name: 'Reissue' }).click();
    d = dialog(s.page);
    await expect(d).toContainText(`Reissue ${tcNo}`);
    await fill(d, 'Reason', 'Leaving reason corrected');
    await fill(d, 'Reason for leaving', 'Family relocation to Dubai');
    await saveDialog(s, 'Reissue');
    const old = certRows().filter({ hasNotText: 'Replaces' }).filter({ hasText: tcNo });
    await expect(old).toContainText('CANCELLED');
    await expect(old.getByRole('button', { name: 'Reissue' })).toHaveCount(0);
    const fresh = certRows().filter({ hasText: `Replaces ${tcNo}` });
    await expect(fresh).toContainText('ISSUED');
    await expect(fresh.locator('strong')).not.toHaveText(tcNo);
    await expectDownload(s.page, () => fresh.getByRole('button', { name: 'PDF' }).click());
    await expectClean(s, mark, 'cancel + reissue');
  });

  test('a transfer certificate is blocked while fee dues are pending', async () => {
    const s = session();
    await s.go('/institution/students');
    await fill(s.page, 'Search', 'GWIS-MAIN-2026-0001');
    await s.settle();
    await s.page.locator('tbody tr').filter({ hasText: 'GWIS-MAIN-2026-0001' }).first().click();
    await expect(s.page).toHaveURL(/\/institution\/students\/[0-9a-f-]{36}/);
    await s.settle();
    const mark = s.mark();
    await s.page.getByRole('tab', { name: 'Certificates' }).click();
    await s.settle();
    await s.page.getByRole('button', { name: 'Issue TC' }).click();
    const d = dialog(s.page);
    await expect(d).toContainText(/Fee dues of .* are pending/);
    // the registrar cannot waive dues (principal-level permission)
    await expect(d.getByLabel('Waive pending fee dues for this TC')).toHaveCount(0);
    await fill(d, 'Date of leaving', isoDate());
    await fill(d, 'Conduct', 'Good');
    await d.getByRole('button', { name: 'Issue', exact: true }).click();
    await s.settle();
    await expect(d.locator('.v-alert.bg-error, .v-alert.text-error')).toContainText(/dues/i);
    await d.getByRole('button', { name: 'Close' }).click();
    await expect(s.page.locator('.v-dialog.v-overlay--active')).toHaveCount(0);
    await expect(s.page.getByText(/clear or waive them/)).toBeHidden();
    await expect(certRows().filter({ hasText: 'TC' }).filter({ hasText: 'ISSUED' })).toHaveCount(0);
    await expectClean(s, mark, 'TC blocked by dues', ['FEE_DUES_PENDING']);
  });
});

for (const email of ['student@greenwood.demo', 'parent@greenwood.demo']) {
  test.describe(`My certificates · ${email}`, () => {
    test.describe.configure({ mode: 'serial' });
    const session = signedIn(email);

    test('downloads their own character certificate from the portal', async () => {
      const s = session();
      await s.go('/portal/certificates');
      const mark = s.mark();
      const card = s.page
        .getByTestId('certificate-card')
        .filter({ hasText: /GWIS-MAIN\/CC\// })
        .first();
      await expect(card).toBeVisible();
      await expect(card).toContainText('GWIS-MAIN-2026-0001');
      await expectDownload(s.page, () =>
        card.getByRole('button', { name: 'Download PDF' }).click(),
      );
      await expectClean(s, mark, 'portal certificate download');
    });
  });
}

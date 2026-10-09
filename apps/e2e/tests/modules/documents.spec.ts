import { expect, test } from '@playwright/test';
import { signedIn } from '../../src/session';
import { dialog, expectClean, expectSignedPdf, fill, pick, rows, uniq } from '../../src/ui';

/**
 * Documents (Greenwood, registrar@ — uploads and deletes): upload a PDF for the institution,
 * download it through a signed URL, add a second version, then delete it. Employees only see their own documents.
 */
test.describe.configure({ mode: 'serial' });
const title = `E2E circular ${uniq('DOC')}`;

const pdf = (text: string) => ({
  name: `${text.replace(/\W+/g, '-')}.pdf`,
  mimeType: 'application/pdf',
  buffer: Buffer.from(
    `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n% ${text}\ntrailer<</Root 1 0 R>>\n%%EOF\n`,
  ),
});

test.describe('Documents · registrar@greenwood.demo', () => {
  const session = signedIn('registrar@greenwood.demo');
  const row = () => rows(session().page).filter({ hasText: title });

  test('uploads a PDF for the institution', async () => {
    const s = session();
    await s.go('/institution/documents');
    const mark = s.mark();
    await s.page.getByRole('button', { name: 'Upload' }).click();
    const d = dialog(s.page);
    await d.locator('input[type=file]').setInputFiles(pdf(title));
    await fill(d, 'Title (defaults to file name)', title);
    await pick(d, 'Belongs to', /^Institution: Greenwood/);
    await d.getByRole('button', { name: 'Upload', exact: true }).click();
    await s.settle();
    await expect(d).toBeHidden();
    await expect(row()).toHaveCount(1);
    await expect(row()).toContainText('v1');
    await expectClean(s, mark, 'document upload');
  });

  test('downloads it through a signed URL', async () => {
    const s = session();
    const mark = s.mark();
    await expectSignedPdf(s.page, () => row().getByTitle('Download').click());
    await expectClean(s, mark, 'document download');
  });

  test('uploads a new version', async () => {
    const s = session();
    const mark = s.mark();
    await row().getByTitle('Versions').click();
    const d = dialog(s.page);
    await expect(d).toContainText(`Versions — ${title}`);
    await d.locator('input[type=file]').setInputFiles(pdf(`${title} v2`));
    await d.getByRole('button', { name: 'Upload', exact: true }).click();
    await s.settle();
    await expect(d.locator('tbody tr')).toHaveCount(2);
    await expect(d.locator('tbody tr').filter({ hasText: 'current' })).toContainText('v2');
    await s.page.keyboard.press('Escape');
    await expect(row()).toContainText('v2');
    await expectClean(s, mark, 'document version');
  });

  test('deletes the document', async () => {
    const s = session();
    const mark = s.mark();
    s.page.once('dialog', (d) => void d.accept());
    await row().getByTitle('Delete').click();
    await s.settle();
    await expect(row()).toHaveCount(0);
    await expectClean(s, mark, 'document delete');
  });
});

test.describe('Documents · employee@greenwood.demo', () => {
  const session = signedIn('employee@greenwood.demo');
  test('lists documents without upload rights', async () => {
    const s = session();
    const mark = s.mark();
    await s.go('/employee/documents');
    await expect(s.page.getByRole('heading', { name: 'Documents' })).toBeVisible();
    await expect(s.page.getByRole('button', { name: 'Upload' })).toHaveCount(0);
    await expectClean(s, mark, 'documents list');
  });
});

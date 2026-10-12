import { deflateSync } from 'node:zlib';
import { expect, test, type Locator } from '@playwright/test';
import { BLOCKED_PATHS } from '../../src/app';
import { signedIn } from '../../src/session';
import {
  dialog,
  expectClean,
  expectRow,
  fill,
  isoDate,
  menu,
  pick,
  rows,
  saveDialog,
  uniq,
} from '../../src/ui';

/**
 * Acme Technologies — a COMPANY organization (HRMS + payroll, no education):
 *  - owner@ sees company terminology (Head office / Company / Companies / branches / Branches),
 *    no education menus or pages, cannot create companies, and sets up a branch, a department,
 *    an employee type (company categories only) and a designation tied to the department;
 *  - hr@ creates an employee in that branch + department and uploads a profile photo for it
 *    (a face-less test image: saved with the "no clear face" warning);
 *  - employee@ sees its own photo card (its real, face-registered photo is left untouched).
 */

const COMPANY = 'Acme Technologies';
const code = (prefix: string) => uniq(prefix).replace(/-/g, '').slice(0, 10);
const branch = { code: code('BR'), name: '' };
branch.name = `E2E Branch ${branch.code}`;
const dept = { code: code('D'), name: '' };
dept.name = `E2E Dept ${dept.code}`;

/** Solid grey 64×64 PNG — a valid image with no face in it. */
function blankPng(size = 64): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const raw = Buffer.alloc((size * 3 + 1) * size, 0x99);
  for (let y = 0; y < size; y++) raw[y * (size * 3 + 1)] = 0; // filter: none
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The v-input wrapping the field labelled `label`. */
const fieldOf = (scope: Locator, label: string) =>
  scope
    .getByLabel(label, { exact: true })
    .first()
    .locator('xpath=ancestor::div[contains(@class,"v-input")][1]');

// Later blocks depend on earlier ones (data and locks), so the whole file runs in order.
test.describe.configure({ mode: 'serial' });

test.describe('Company org · owner@acme.demo', () => {
  test.describe.configure({ mode: 'serial' });
  const session = signedIn('owner@acme.demo');

  test('shell uses company terminology', async () => {
    const s = session();
    await s.go('/');
    await expect(s.page.getByRole('heading', { name: 'HRMS & Payroll' })).toBeVisible();
    const cards = s.page.locator('.v-card .v-card-title');
    await expect(cards).toHaveText(['Head office', 'Company', 'HR', 'Employee']);
    await expect(cards.filter({ hasText: /^(Institution|Group|Students?)$/ })).toHaveCount(0);

    await s.go('/group');
    const group = (await s.drawerItems()).map((i) => i.title);
    expect(group).toContain('Companies / branches');
    expect(group).not.toContain('Institutions');
    await s.go('/institution');
    const inst = (await s.drawerItems()).map((i) => i.title);
    expect(inst).toContain('Branches');
    await expect(s.page.getByRole('heading', { name: 'Company', exact: true })).toBeVisible();
  });

  test('has no education menus and education pages are blocked', async () => {
    const s = session();
    for (const layout of ['/group', '/institution']) {
      await s.go(layout);
      const titles = (await s.drawerItems()).map((i) => i.title);
      for (const edu of ['Students', 'Admissions', 'Classes', 'Timetable', 'Exams', 'Fees']) {
        expect(titles, `${layout} menu`).not.toContain(edu);
      }
    }
    for (const path of ['/group/students', '/institution/students']) {
      await s.go(path);
      expect(BLOCKED_PATHS, path).toContain(s.pathname());
    }
  });

  test('lists the company but cannot create companies / branches', async () => {
    const s = session();
    await s.go('/group/institutions');
    const mark = s.mark();
    await expect(s.page.getByRole('heading', { name: 'Companies / branches' })).toBeVisible();
    const row = rows(s.page).filter({ hasText: COMPANY });
    await expect(row).toContainText('ACME');
    await expect(row.locator('td').nth(2)).toHaveText('Company');
    await expect(s.page.getByRole('button', { name: /new company \/ branch/i })).toHaveCount(0);
    await expectClean(s, mark, 'companies list');
  });

  test('creates a branch', async () => {
    const s = session();
    await s.go('/institution/branches');
    const mark = s.mark();
    await expect(s.page.getByRole('heading', { name: 'Branches' })).toBeVisible();
    await pick(s.page, 'Company', COMPANY);
    await s.settle();
    await s.page.getByRole('button', { name: /new branch/i }).click();
    const d = dialog(s.page);
    await fill(d, 'Code * (e.g. NOIDA)', branch.code);
    await fill(d, 'Name * (e.g. Noida Branch)', branch.name);
    await fill(d, 'Address', 'E2E Tech Park, Sector 62');
    await saveDialog(s);
    await expectRow(s.page, branch.name);
    await expectClean(s, mark, 'branch create');
  });

  test('creates a department', async () => {
    const s = session();
    await s.go('/institution/departments');
    const mark = s.mark();
    await s.page.getByRole('button', { name: /new department/i }).click();
    const d = dialog(s.page);
    await fill(d, 'Code * (e.g. IT)', dept.code);
    await fill(d, 'Name * (e.g. Information Technology)', dept.name);
    await saveDialog(s);
    await expectRow(s.page, dept.name);
    await expectClean(s, mark, 'department create');
  });

  test('creates an employee type with company categories only', async () => {
    const s = session();
    await s.go('/hr/employee-types');
    const mark = s.mark();
    const typeCode = code('T');
    await s.page.getByRole('button', { name: /new employee type/i }).click();
    const d = dialog(s.page);
    await fill(d, 'Code * (e.g. PERM)', typeCode);
    await fill(d, 'Name * (e.g. Permanent)', `E2E Type ${typeCode}`);
    await fieldOf(d, 'Category *').locator('.v-field').click();
    await expect(menu(s.page)).toHaveText(['Full Time', 'Part Time', 'Contract', 'Intern']);
    await menu(s.page).filter({ hasText: 'Contract' }).click();
    await saveDialog(s);
    await expectRow(s.page, typeCode);
    await expect(rows(s.page).filter({ hasText: typeCode })).toContainText('Contract');
    await expectClean(s, mark, 'employee type create');
  });

  test('creates a designation for the new department', async () => {
    const s = session();
    await s.go('/hr/designations');
    const mark = s.mark();
    const desCode = code('DS');
    await s.page.getByRole('button', { name: /new designation/i }).click();
    const d = dialog(s.page);
    await fill(d, 'Code *', desCode);
    await fill(d, 'Name *', `E2E Designation ${desCode}`);
    await pick(d, 'Company (empty = organization-wide)', COMPANY);
    await s.settle();
    await pick(d, 'Department (empty = all departments)', dept.name);
    await fieldOf(d, 'Category').locator('.v-field').click();
    await expect(menu(s.page)).toHaveText(['Full Time', 'Part Time', 'Contract', 'Intern']);
    await menu(s.page).filter({ hasText: 'Full Time' }).click();
    await saveDialog(s);
    await expectRow(s.page, desCode);
    const row = rows(s.page).filter({ hasText: desCode });
    await expect(row).toContainText(COMPANY);
    await expect(row).toContainText(dept.name);
    await expect(row).toContainText('Full Time');
    await expectClean(s, mark, 'designation create');
  });
});

test.describe('Company org · hr@acme.demo', () => {
  test.describe.configure({ mode: 'serial' });
  const session = signedIn('hr@acme.demo');
  const last = uniq('Emp');

  test('creates an employee in the new branch and department', async () => {
    const s = session();
    await s.go('/hr/employees');
    const mark = s.mark();
    await s.page.getByRole('button', { name: /new employee/i }).click();
    const d = dialog(s.page);
    await fill(d, 'First name *', 'Branchy');
    await fill(d, 'Last name', last);
    await pick(d, 'Company *', COMPANY);
    await s.settle();
    await pick(d, 'Branch', branch.name);
    await pick(d, 'Department', dept.name);
    await fill(d, 'Date of joining', isoDate(0));
    await saveDialog(s);
    await expect(s.page.getByRole('heading', { name: `Branchy ${last}` })).toBeVisible();
    await expect(s.page.getByText(COMPANY).first()).toBeVisible();

    // The branch is kept on the record (the edit dialog shows it again).
    await s.page
      .getByRole('button', { name: /^edit$/i })
      .first()
      .click();
    const e = dialog(s.page);
    await expect(fieldOf(e, 'Branch')).toContainText(branch.name);
    await expect(fieldOf(e, 'Department')).toContainText(dept.name);
    await e.getByRole('button', { name: /^cancel$/i }).click();
    await expectClean(s, mark, 'company employee create');
  });

  test('uploads a profile photo without a face and gets the warning', async () => {
    const s = session();
    const mark = s.mark();
    await expect(s.page.getByRole('heading', { name: `Branchy ${last}` })).toBeVisible();
    await expect(s.page.getByRole('button', { name: /upload photo/i })).toBeVisible();
    await s.page.locator('input[type=file][accept*="image"]').setInputFiles({
      name: 'blank.png',
      mimeType: 'image/png',
      buffer: blankPng(),
    });
    await expect(s.page.getByText(/Photo saved, but no clear face was detected/)).toBeVisible({
      timeout: 60_000,
    });
    await s.settle();
    await expect(s.page.getByRole('button', { name: /change photo/i })).toBeVisible();
    await expectClean(s, mark, 'photo upload');
  });
});

test.describe('Company org · employee@acme.demo', () => {
  const session = signedIn('employee@acme.demo');

  test('sees its own profile photo card', async () => {
    const s = session();
    await s.go('/employee/profile');
    const mark = s.mark();
    await expect(s.page.getByRole('button', { name: /change photo/i })).toBeVisible();
    await expect(s.page.getByText('JPG/PNG, max 5 MB, face clearly visible')).toBeVisible();
    await s.go('/hr/employees');
    expect(BLOCKED_PATHS).toContain(s.pathname());
    await expectClean(s, mark, 'own photo card');
  });
});

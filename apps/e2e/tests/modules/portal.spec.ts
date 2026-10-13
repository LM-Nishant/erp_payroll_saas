import { expect, test } from '@playwright/test';
import { BLOCKED_PATHS, type AppSession } from '../../src/app';
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
 * Self-service portal depth for the Greenwood student (Aarav, GWIS-MAIN-2026-0001) and parent:
 * - library: reserve a title that is out on loan from the OPAC, follow it in My library, cancel it;
 *   a student's damage fine is posted to fees (no desk waiver); a staff member's is waived;
 * - hostel: the hostel manager allocates Aarav; the student applies for out-passes (an invalid
 *   window is rejected), cancels one, raises a complaint; the warden approves; the parent sees the
 *   room; the manager resolves the complaint and vacates the bed again;
 * - documents: student and parent see Aarav's documents (and no one else's) without upload rights.
 */
test.describe.configure({ mode: 'serial' });
const id = uniq('PT').replace(/-/g, '');
const AARAV = 'GWIS-MAIN-2026-0001';
const book = `E2E Reserve ${id}`;
let barcode = '';
const STAFF = 'GWIS-MAIN-0007';
const staffBook = `E2E Staff Copy ${id}`;
let staffBarcode = '';
const code = id.slice(-10);
const hostel = `E2E Portal Hostel ${code}`;
const outing = `E2E outing ${code}`;
const visit = `E2E visit ${code}`;
const complaint = `E2E tap leaking ${code}`;
// Approved out-passes persist after the bed is vacated and block overlapping windows: give every run its own day.
const passDay = 2 + (Math.floor(Date.now() / 60_000) % 3650);

/** Catalogues a one-copy title and issues that copy at the desk; returns its barcode. */
async function catalogueAndIssue(
  s: AppSession,
  title: string,
  member: string,
  memberType: 'Student' | 'Staff',
) {
  await s.go('/institution/library/catalogue');
  await s.page.getByRole('button', { name: 'New title' }).click();
  const d = dialog(s.page);
  await fill(d, 'Title', title);
  await fill(d, 'Authors (separate with ;)', 'E2E Author');
  await fill(d, 'Copies', '1');
  await d.getByRole('button', { name: 'Create' }).click();
  await s.settle();
  await expect(s.page).toHaveURL(/\/library\/books\//);
  const copies = s.page
    .locator('.v-card')
    .filter({ hasText: /Copies \(/ })
    .locator('tbody tr');
  await expect(copies).toHaveCount(1);
  const copy = (await copies.first().locator('td').nth(1).innerText()).trim();
  expect(copy).not.toBe('');

  await s.go('/institution/library/desk');
  const scan = s.page.getByLabel('Barcode / accession number', { exact: true });
  await scan.fill(copy);
  await scan.press('Enter');
  await s.settle();
  await s.page.getByRole('button', { name: memberType, exact: true }).click();
  const search = s.page.getByRole('combobox', {
    name: 'Search name / admission no / employee code',
  });
  await search.click();
  await search.fill(member);
  await s.settle();
  const option = s.page.getByRole('option', { name: new RegExp(member) });
  await expect(option).toHaveCount(1, { timeout: 15_000 });
  await option.click();
  await s.settle();
  await s.page.getByRole('button', { name: 'Issue', exact: true }).last().click();
  await s.settle();
  await expect(s.page.getByText(new RegExp(`Issued “${title}”`))).toBeVisible();
  return copy;
}

/** Returns E2E copies an aborted earlier run left on loan to the member, freeing their quota. */
async function returnLeftoverLoans(s: AppSession, member: string, memberType: 'Student' | 'Staff') {
  await s.go('/institution/library/desk');
  await s.page.getByRole('button', { name: 'Issue', exact: true }).first().click();
  await s.page.getByRole('button', { name: memberType, exact: true }).click();
  const search = s.page.getByRole('combobox', {
    name: 'Search name / admission no / employee code',
  });
  await search.click();
  await search.fill(member);
  await s.settle();
  const option = s.page.getByRole('option', { name: new RegExp(member) });
  await expect(option).toHaveCount(1, { timeout: 15_000 });
  await option.click();
  await s.settle();
  const leftovers = s.page.locator('tbody tr').filter({ hasText: /^E2E (Reserve|Staff Copy) / });
  const barcodes: string[] = [];
  for (const row of await leftovers.all()) {
    barcodes.push((await row.locator('td').nth(1).innerText()).trim());
  }
  for (const code of barcodes) {
    await s.page.getByRole('button', { name: 'Return', exact: true }).first().click();
    const scan = s.page.getByLabel('Barcode / accession number', { exact: true });
    await scan.fill(code);
    await scan.press('Enter');
    await s.settle();
    await expect(s.page.getByText(/Returned “/)).toBeVisible();
  }
  // The desk remembers its mode; leave it in Issue mode for the next step.
  await s.page.getByRole('button', { name: 'Issue', exact: true }).first().click();
}

/** Returns a copy at the desk as DAMAGED with a 150 charge. */
async function returnDamaged(s: AppSession, copy: string, title: string) {
  await s.go('/institution/library/desk');
  await s.page.getByRole('button', { name: 'Return', exact: true }).first().click();
  await pick(s.page, 'Condition', 'DAMAGED');
  await fill(s.page, 'Damage / replacement charge', '150');
  const scan = s.page.getByLabel('Barcode / accession number', { exact: true });
  await scan.fill(copy);
  await scan.press('Enter');
  await s.settle();
  await expect(s.page.getByText(new RegExp(`Returned “${title}”`))).toBeVisible();
  await expect(s.page.getByText(/Fine ₹\s?150(\.00)?/)).toBeVisible();
}

test.describe('Portal · librarian@greenwood.demo lends out single copies', () => {
  const session = signedIn('librarian@greenwood.demo');

  test('catalogues one-copy titles and issues them to a student and a staff member', async () => {
    const s = session();
    await returnLeftoverLoans(s, 'GWIS-MAIN-2026-0002', 'Student');
    await returnLeftoverLoans(s, STAFF, 'Staff');
    const mark = s.mark();
    barcode = await catalogueAndIssue(s, book, 'GWIS-MAIN-2026-0002', 'Student');
    staffBarcode = await catalogueAndIssue(s, staffBook, STAFF, 'Staff');
    await expectClean(s, mark, 'issue single copies');
  });
});

test.describe('Portal · student@greenwood.demo reserves from the OPAC', () => {
  const session = signedIn('student@greenwood.demo');

  test('reserves a title that is out on loan; a second reservation is refused', async () => {
    const s = session();
    await s.go('/portal/opac');
    const search = s.page.getByLabel('Search by title, author, ISBN, subject or tag');
    await search.fill(book);
    await search.press('Enter');
    await s.settle();
    const card = s.page.locator('.v-card').filter({ hasText: book });
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('All copies on loan');
    let mark = s.mark();
    await card.getByRole('button', { name: /Reserve/i }).click();
    await s.settle();
    await expect(s.page.getByText(new RegExp(`Reserved “${book}”`))).toBeVisible();
    await expectClean(s, mark, 'reserve');
    mark = s.mark();
    await card.getByRole('button', { name: /Reserve/i }).click();
    await s.settle();
    const refused = s.page.locator('.v-alert').filter({ hasText: /already/i });
    await expect(refused).toBeVisible();
    await refused.getByRole('button', { name: /close/i }).click();
    await expectClean(s, mark, 'duplicate reserve', ['CONFLICT']);
  });

  test('My library shows the reservation in the queue', async () => {
    const s = session();
    await s.go('/portal/library');
    const mark = s.mark();
    const row = s.page.locator('tbody tr').filter({ hasText: book });
    await expect(row).toContainText('WAITING');
    await expect(row).toContainText(/Position #1 in queue/);
    await expectClean(s, mark, 'my reservations', ['NOT_FOUND']);
  });

  test('library staff pages stay closed to the student', async () => {
    const s = session();
    for (const path of ['/institution/library/fines', '/institution/library/desk']) {
      await s.go(path);
      expect(BLOCKED_PATHS, path).toContain(s.pathname());
    }
  });
});

test.describe('Portal · librarian@greenwood.demo damaged returns & fine waiver', () => {
  const session = signedIn('librarian@greenwood.demo');

  test('a student’s damage fine is posted to the fee account, not settled at the desk', async () => {
    const s = session();
    const mark = s.mark();
    await returnDamaged(s, barcode, book);
    await expect(s.page.getByText(/Fine .* — POSTED/)).toBeVisible();
    // A damaged copy leaves circulation, so it is not held for the waiting reservation.
    await expect(s.page.getByText(/Hold this copy for/)).toHaveCount(0);
    await s.go('/institution/library/fines');
    await s.page.getByRole('button', { name: 'Fines', exact: true }).click();
    await pick(s.page, 'Status', 'POSTED');
    await s.settle();
    const row = rows(s.page).filter({ hasText: book });
    await expect(row).toContainText('POSTED');
    await expect(row.getByRole('button', { name: /^(Waive|Collect)$/i })).toHaveCount(0);
    await expectClean(s, mark, 'student damaged return');
  });

  test('a staff member’s damage fine stays pending and is waived with a reason', async () => {
    const s = session();
    const mark = s.mark();
    await returnDamaged(s, staffBarcode, staffBook);
    await expect(s.page.getByText(/Fine .* — PENDING/)).toBeVisible();
    await s.go('/institution/library/fines');
    await s.page.getByRole('button', { name: 'Fines', exact: true }).click();
    await s.settle();
    const row = rows(s.page).filter({ hasText: staffBook });
    await expect(row).toContainText('PENDING');
    s.page.once('dialog', (x) => void x.accept('E2E goodwill waiver'));
    await row.getByRole('button', { name: /^Waive$/i }).click();
    await s.settle();
    // The default "PENDING" filter drops the waived fine; it shows up under WAIVED.
    await expect(row).toHaveCount(0);
    await pick(s.page, 'Status', 'WAIVED');
    await s.settle();
    await expect(rows(s.page).filter({ hasText: staffBook })).toContainText('WAIVED');
    await expectClean(s, mark, 'waive');
  });
});

test.describe('Portal · student@greenwood.demo cancels the reservation', () => {
  const session = signedIn('student@greenwood.demo');
  test('cancel removes the reservation from the queue', async () => {
    const s = session();
    await s.go('/portal/library');
    const mark = s.mark();
    const row = s.page.locator('tbody tr').filter({ hasText: book });
    // The only copy came back damaged, so the reservation is still waiting.
    await expect(row).toContainText('WAITING');
    await row.getByRole('button', { name: /^Cancel$/i }).click();
    await s.settle();
    await expect(row.filter({ hasText: /WAITING|READY/ })).toHaveCount(0);
    await expectClean(s, mark, 'cancel reservation', ['NOT_FOUND']);
  });
});

test.describe('Portal · hostel@greenwood.demo allocates Aarav', () => {
  const session = signedIn('hostel@greenwood.demo');

  test('creates a hostel with a room and allocates the student', async () => {
    const s = session();
    await s.go('/institution/hostel/hostels');
    const mark = s.mark();
    await s.page.getByRole('button', { name: 'New hostel' }).click();
    let d = dialog(s.page);
    await pick(d, 'Institution', 'Greenwood International School');
    await fill(d, 'Code *', code);
    await fill(d, 'Name *', hostel);
    await pick(d, 'Type', 'MIXED');
    await saveDialog(s);
    await expectRow(s.page, code);
    const roomsCard = s.page.locator('.v-card').filter({ hasText: 'Rooms & beds' }).first();
    await roomsCard.locator('.v-select .v-field').first().click();
    await menu(s.page).filter({ hasText: code }).first().click();
    await s.settle();
    await s.page.getByRole('button', { name: 'New room' }).click();
    d = dialog(s.page);
    await fill(d, 'Room no', '201');
    await fill(d, 'Floor', '2');
    await pick(d, 'Type', 'SINGLE');
    await fill(d, 'Beds', '1');
    await fill(d, 'Monthly rent', '4000');
    await saveDialog(s);
    await expect(roomsCard.getByText('Room 201')).toBeVisible();

    await s.page.getByRole('tab', { name: 'Allocations' }).click();
    await s.settle();
    // A student holds one bed at a time: free Aarav if an earlier run left him allocated.
    await pick(s.page, 'Status', 'ACTIVE');
    await s.settle();
    await expect(rows(s.page).first()).toBeVisible();
    const held = rows(s.page).filter({ hasText: AARAV });
    if (await held.count()) {
      await held.first().getByRole('button', { name: 'Vacate' }).click();
      await s.settle();
    }
    await s.page.getByRole('button', { name: 'Allocate room' }).click();
    d = dialog(s.page);
    await pick(d, 'Hostel', code);
    await s.settle();
    await d
      .getByLabel('Student', { exact: true })
      .locator('xpath=ancestor::div[contains(@class,"v-input")][1]')
      .locator('.v-field')
      .click();
    await d.getByLabel('Student', { exact: true }).fill(AARAV);
    await s.settle();
    await menu(s.page).filter({ hasText: AARAV }).first().click();
    // The student autocomplete re-searches with the picked title and keeps its menu open.
    if (await s.page.locator('.v-menu.v-overlay--active').count())
      await s.page.keyboard.press('Escape');
    await expect(s.page.locator('.v-menu.v-overlay--active')).toHaveCount(0);
    await pick(d, 'Room', /201/);
    await fill(d, 'From', isoDate(0));
    await saveDialog(s, 'Allocate');
    await expect(rows(s.page).filter({ hasText: AARAV }).filter({ hasText: code })).toContainText(
      'ACTIVE',
    );
    await expectClean(s, mark, 'allocate Aarav');
  });
});

test.describe('Portal · student@greenwood.demo hostel self-service', () => {
  const session = signedIn('student@greenwood.demo');

  test('sees the allocated room', async () => {
    const s = session();
    await s.go('/portal/hostel');
    const mark = s.mark();
    const card = s.page.locator('.v-card').filter({ hasText: hostel });
    await expect(card).toContainText('Aarav');
    await expect(card).toContainText(/Room 201 · Bed/);
    await expectClean(s, mark, 'my hostel');
  });

  test('an out-pass that ends before it starts is rejected', async () => {
    const s = session();
    const mark = s.mark();
    await s.page.getByRole('button', { name: /^Apply$/i }).click();
    const d = dialog(s.page);
    await fill(d, 'From', `${isoDate(passDay)}T18:00`);
    await fill(d, 'To', `${isoDate(passDay)}T10:00`);
    await fill(d, 'Reason', outing);
    await d.getByRole('button', { name: /^Submit$/i }).click();
    await s.settle();
    await expect(d).toBeVisible();
    expect((await s.failedSince(mark)).map((c) => c.status)).toContain(400);
    // Fixing the window submits the same request.
    await fill(d, 'To', `${isoDate(passDay)}T20:00`);
    await d.getByRole('button', { name: /^Submit$/i }).click();
    await s.settle();
    await expect(d).toBeHidden();
    const row = s.page.locator('tbody tr').filter({ hasText: outing });
    await expect(row).toContainText('PENDING');
    await expectClean(s, mark, 'out-pass', ['VALIDATION_ERROR']);
  });

  test('applies for and cancels a second out-pass', async () => {
    const s = session();
    const mark = s.mark();
    await s.page.getByRole('button', { name: /^Apply$/i }).click();
    const d = dialog(s.page);
    await fill(d, 'From', `${isoDate(passDay + 1)}T09:00`);
    await fill(d, 'To', `${isoDate(passDay + 1)}T17:00`);
    await fill(d, 'Destination', 'Home');
    await fill(d, 'Reason', visit);
    await saveDialog(s, 'Submit');
    const row = s.page.locator('tbody tr').filter({ hasText: visit });
    await expect(row).toContainText('PENDING');
    await row.getByRole('button', { name: /^Withdraw$/i }).click();
    await s.settle();
    await expect(row).toContainText('CANCELLED');
    await expect(row.getByRole('button', { name: /^Withdraw$/i })).toHaveCount(0);
    await expectClean(s, mark, 'cancel out-pass');
  });

  test('raises a complaint', async () => {
    const s = session();
    const mark = s.mark();
    await s.page.getByRole('button', { name: /^Raise$/i }).click();
    const d = dialog(s.page);
    await fill(d, 'Title', complaint);
    await fill(d, 'Details', 'Bathroom tap drips all night');
    await saveDialog(s, 'Submit');
    await expect(s.page.locator('tbody tr').filter({ hasText: complaint })).toContainText('OPEN');
    await expectClean(s, mark, 'complaint');
  });
});

test.describe('Portal · warden@greenwood.demo approves the student out-pass', () => {
  const session = signedIn('warden@greenwood.demo');
  test('approves', async () => {
    const s = session();
    await s.go('/institution/hostel/outpasses');
    const mark = s.mark();
    const row = rows(s.page).filter({ hasText: outing });
    await expect(row).toContainText('PENDING');
    await row.getByRole('button', { name: 'Approve' }).click();
    await s.settle();
    await expect(row).toContainText('APPROVED');
    await expectClean(s, mark, 'approve');
  });
});

test.describe('Portal · parent@greenwood.demo sees the ward hostel', () => {
  const session = signedIn('parent@greenwood.demo');
  test('the ward’s room and approved out-pass are visible', async () => {
    const s = session();
    await s.go('/portal/hostel');
    const mark = s.mark();
    const card = s.page.locator('.v-card').filter({ hasText: hostel });
    await expect(card).toContainText('Aarav');
    await expect(card).toContainText(/Room 201/);
    await expect(card.locator('tbody tr').filter({ hasText: outing })).toContainText('APPROVED');
    await expectClean(s, mark, 'ward hostel');
  });
});

test.describe('Portal · hostel@greenwood.demo closes up', () => {
  const session = signedIn('hostel@greenwood.demo');
  test('resolves the complaint and vacates the bed', async () => {
    const s = session();
    await s.go('/institution/hostel/hostels');
    const mark = s.mark();
    await s.page.getByRole('tab', { name: 'Complaints' }).click();
    await s.settle();
    const ticket = rows(s.page).filter({ hasText: complaint });
    await ticket.getByRole('button', { name: 'Start' }).click();
    await s.settle();
    await ticket.getByRole('button', { name: 'Resolve' }).click();
    await s.settle();
    await expect(ticket).toContainText('RESOLVED');
    await s.page.getByRole('tab', { name: 'Allocations' }).click();
    await s.settle();
    const row = rows(s.page).filter({ hasText: AARAV }).filter({ hasText: code });
    await row.getByRole('button', { name: 'Vacate' }).click();
    await s.settle();
    await expect(row.filter({ hasText: /\bACTIVE\b/ })).toHaveCount(0);
    await expectClean(s, mark, 'close up');
  });
});

test.describe('Portal · documents', () => {
  for (const email of ['student@greenwood.demo', 'parent@greenwood.demo']) {
    test.describe(email, () => {
      const session = signedIn(email);
      test('sees the student’s own documents only, without upload', async () => {
        const s = session();
        await s.go('/portal/documents');
        const mark = s.mark();
        await expectRow(s.page, 'Character certificate GWIS-MAIN/CC/2026/0001');
        // Certificates of other students stay hidden.
        await expect(rows(s.page).filter({ hasText: 'GWIS-MAIN/CC/2026/0002' })).toHaveCount(0);
        await expect(s.page.getByRole('button', { name: /^Upload$/i })).toHaveCount(0);
        await expectClean(s, mark, 'portal documents');
      });
    });
  }
});

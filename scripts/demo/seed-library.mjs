// Idempotent ABBS library demo seed through the public HTTP API.
//   API_URL=http://localhost:3103/api/v1 node scripts/demo/seed-library.mjs
// Creates librarian logins, circulation policies, a ~200-title catalogue with 2–5 copies per
// title in every ABBS institution library, return history (incl. late returns with fines),
// ~150 active loans (~20 overdue) and a few reservations. Safe to re-run: books are matched by
// ISBN/title, circulation is only topped up to the targets.
import { COMMERCE, ENGINEERING, FICTION, NON_BOOK, SCHOOL } from './library-titles.mjs';

const API = process.env.API_URL ?? 'http://localhost:3103/api/v1';
const PLATFORM = {
  email: process.env.PLATFORM_EMAIL ?? 'platform@erp.test',
  password: process.env.PLATFORM_PASSWORD ?? 'Demo-Passw0rd!',
};
const PASSWORD = 'Abbs@2026Demo';
const ACTIVE_PER_INST = 30;
const OVERDUE_PER_INST = 4;
const HISTORY_PER_INST = 16;
const RESERVATIONS_PER_INST = 4;

async function login({ email, password }) {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`login ${email}: ${JSON.stringify(j)}`);
  return j.data.accessToken;
}

function client(token) {
  return async (method, path, body) => {
    const r = await fetch(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = r.status === 204 ? {} : await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(`${method} ${path} ${r.status}: ${JSON.stringify(j.error ?? j)}`);
      err.status = r.status;
      err.code = j.error?.code;
      throw err;
    }
    return j;
  };
}

async function all(api, path) {
  const out = [];
  for (let page = 1; ; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const j = await api('GET', `${path}${sep}page=${page}&pageSize=100`);
    out.push(...(j.data ?? []));
    if (!j.meta || out.length >= j.meta.total || !j.data?.length) return out;
  }
}

const DAY = 86_400_000;
const today = new Date();
const day = (offset) => new Date(today.getTime() + offset * DAY).toISOString().slice(0, 10);

/** Deterministic 32-bit hash for stable pseudo-random choices. */
function hash(s) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** Valid-looking ISBN-13 (978 prefix + checksum) derived from the title. */
function isbnFor(title) {
  const body = `978${String(hash(title) % 1_000_000_000).padStart(9, '0')}`;
  const sum = [...body].reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
  return `${body}${(10 - (sum % 10)) % 10}`;
}

const platform = client(await login(PLATFORM));
const orgs = await all(platform, '/platform/organizations');
const org = orgs.find((o) => /abbs/i.test(`${o.name} ${o.slug}`));
if (!org) throw new Error('ABBS organization not found — run the education seed first');
const sub = (await platform('GET', `/platform/organizations/${org.id}/subscription`)).data;
const enabled = new Set([...(sub.plan?.features ?? []), ...(sub.addOnFeatures ?? [])]);
if (!enabled.has('library')) {
  await platform('PUT', `/platform/organizations/${org.id}/subscription`, {
    planId: sub.plan.id,
    status: sub.status,
    addOnFeatures: [...new Set([...(sub.addOnFeatures ?? []), 'library'])],
    limitOverrides: sub.limitOverrides ?? {},
    reason: 'Library demo seed',
  });
}
const access = (
  await platform('POST', `/platform/organizations/${org.id}/access`, {
    reason: 'Seed ABBS library demo data',
  })
).data.accessToken;
const api = client(access);

/* ---------------------------------- Librarian logins ----------------------------------- */
const roles = await all(api, '/roles');
const librarianRole = roles.find((r) => r.key === 'librarian');
if (!librarianRole) throw new Error('librarian role missing — is the library migration applied?');
const users = await all(api, '/users');
const userEmails = new Set(users.map((u) => u.email.toLowerCase()));
const institutions = (await all(api, '/institutions')).filter((i) =>
  ['AEC', 'AIT', 'ABS', 'AJC', 'ABM'].includes(i.code),
);
const logins = [];
for (const inst of institutions) {
  const email = `${inst.code.toLowerCase()}.librarian@abbs.test`;
  if (!userEmails.has(email))
    await api('POST', '/users', {
      email,
      name: `${inst.name} Librarian`,
      password: PASSWORD,
      roles: [{ roleId: librarianRole.id, scopes: [{ type: 'INSTITUTION', id: inst.id }] }],
    });
  logins.push(email);
}

/* ------------------------------------ Catalogue ---------------------------------------- */
const isSchool = (inst) => inst.type === 'SCHOOL';
function catalogueFor(inst) {
  const nb = (rows) =>
    rows.map(([title, authors, publisher, year, category, itemType, url]) => ({
      title,
      authors,
      publisher,
      year,
      category,
      itemType,
      url,
    }));
  const books = (rows) =>
    rows.map(([title, authors, publisher, year, category]) => ({
      title,
      authors,
      publisher,
      year,
      category,
      itemType: 'BOOK',
    }));
  if (isSchool(inst)) return [...books(SCHOOL), ...books(FICTION), ...nb(NON_BOOK.slice(4))];
  if (inst.code === 'ABM')
    return [...books(COMMERCE), ...books(FICTION), ...books(ENGINEERING.slice(17, 25))].concat(
      nb(
        NON_BOOK.filter(
          (r) => ['MAGAZINE', 'E_RESOURCE'].includes(r[5]) || r[0].includes('Economic'),
        ),
      ),
    );
  return [
    ...books(ENGINEERING),
    ...books(COMMERCE.slice(0, 20)),
    ...books(FICTION),
    ...nb(NON_BOOK.filter((r) => !r[0].includes('Kids') && r[0] !== 'ePathshala')),
  ];
}

const stats = {
  books: 0,
  copies: 0,
  issued: 0,
  overdue: 0,
  returned: 0,
  fines: 0,
  reservations: 0,
};
const LANG = (title) => (/Hindi|Godaan|Sanskrit/.test(title) ? 'Hindi' : 'English');

for (const inst of institutions) {
  const school = isSchool(inst);
  await api('PUT', '/library/policies', {
    institutionId: inst.id,
    memberType: 'STUDENT',
    maxBooks: school ? 3 : 4,
    loanDays: 14,
    maxRenewals: 2,
    finePerDay: school ? 2 : 5,
    maxFine: school ? 100 : 250,
    holdDays: 3,
  });
  await api('PUT', '/library/policies', {
    institutionId: inst.id,
    memberType: 'EMPLOYEE',
    maxBooks: 8,
    loanDays: 30,
    maxRenewals: 3,
    finePerDay: 1,
    maxFine: 100,
    holdDays: 5,
  });

  const existing = await all(api, `/library/books?institutionId=${inst.id}`);
  const key = (b) => (b.isbn ? `isbn:${b.isbn}` : `title:${b.title.toLowerCase()}`);
  const have = new Set(existing.map(key));
  const shelves = new Map();
  for (const item of catalogueFor(inst)) {
    const isbn = item.itemType === 'BOOK' ? isbnFor(item.title) : null;
    if (have.has(isbn ? `isbn:${isbn}` : `title:${item.title.toLowerCase()}`)) continue;
    const shelfNo = shelves.get(item.category) ?? shelves.size + 1;
    shelves.set(item.category, shelfNo);
    const copies =
      item.itemType === 'E_RESOURCE'
        ? 0
        : item.itemType === 'BOOK'
          ? 2 + (hash(`${inst.code}:${item.title}`) % 4)
          : 2;
    await api('POST', '/library/books', {
      institutionId: inst.id,
      itemType: item.itemType,
      isbn,
      title: item.title,
      authors: item.authors.split(';').map((a) => a.trim()),
      publisher: item.publisher,
      publicationYear: item.year,
      category: item.category,
      language: LANG(item.title),
      tags: [item.category.toLowerCase().replace(/^textbook: /, 'textbook ')].slice(0, 1),
      callNumber: `${item.category.slice(0, 3).toUpperCase()}-${String(hash(item.title) % 1000).padStart(3, '0')}`,
      url: item.url ?? null,
      copies,
      shelf: `S${String(shelfNo).padStart(2, '0')}`,
      rack: `R${(hash(item.title) % 6) + 1}`,
    });
    stats.books++;
    stats.copies += copies;
  }
}

/* ----------------------------------- Circulation --------------------------------------- */
async function availableCopies(instId) {
  return all(api, `/library/copies?institutionId=${instId}&status=AVAILABLE`);
}

for (const inst of institutions) {
  const students = (await all(api, `/students?institutionId=${inst.id}&status=ACTIVE`)).sort(
    (a, b) => Number(Boolean(b.userId)) - Number(Boolean(a.userId)) || a.id.localeCompare(b.id),
  );
  if (students.length < 40) {
    console.warn(`${inst.code}: only ${students.length} students; skipping circulation`);
    continue;
  }
  const loans = await all(api, `/library/loans?institutionId=${inst.id}`);
  const active = loans.filter((l) => l.status === 'ISSUED');
  const returnedCount = loans.filter((l) => l.status !== 'ISSUED').length;
  let copies = await availableCopies(inst.id);
  // Spread popular books first: copies of the first titles get borrowed most.
  copies.sort(
    (a, b) => hash(a.bookId) - hash(b.bookId) || a.accessionNo.localeCompare(b.accessionNo),
  );
  let cursor = 0;
  const nextCopy = (exclude = new Set()) => {
    while (cursor < copies.length) {
      const c = copies[cursor++];
      if (!exclude.has(c.bookId)) return c;
    }
    return null;
  };

  // Return history: students 20..; issued 40–90 days ago; every 4th returned late.
  for (let i = returnedCount; i < HISTORY_PER_INST; i++) {
    const copy = nextCopy();
    if (!copy) break;
    const student = students[20 + (i % (students.length - 20))];
    const issuedOffset = -90 + i * 3;
    const late = i % 4 === 0;
    const loan = (
      await api('POST', '/library/issue', {
        copyId: copy.id,
        studentId: student.id,
        issuedAt: day(issuedOffset),
        dueDate: day(issuedOffset + 14),
      })
    ).data;
    await api('POST', '/library/return', {
      loanId: loan.id,
      returnedAt: day(issuedOffset + (late ? 14 + 6 + (i % 9) : 7 + (i % 6))),
    });
    stats.returned++;
    if (late) stats.fines++;
  }

  // Active loans: students 0..19 (students with logins first), ≤2 loans each; overdue first.
  copies = await availableCopies(inst.id);
  copies.sort(
    (a, b) => hash(a.bookId) - hash(b.bookId) || a.accessionNo.localeCompare(b.accessionNo),
  );
  cursor = 0;
  const perStudent = new Map();
  for (const l of active) perStudent.set(l.studentId, (perStudent.get(l.studentId) ?? 0) + 1);
  const overdueNow = active.filter((l) => l.dueDate < day(0)).length;
  for (let i = active.length, o = overdueNow; i < ACTIVE_PER_INST; i++) {
    const overdue = o < OVERDUE_PER_INST;
    // Overdue loans go to dedicated students (an overdue loan blocks further issues).
    const pool = overdue
      ? students.slice(10, 10 + OVERDUE_PER_INST)
      : [...students.slice(0, 10), ...students.slice(10 + OVERDUE_PER_INST, 20)];
    const student = pool.find((s) => (perStudent.get(s.id) ?? 0) < (overdue ? 1 : 2));
    if (!student) break;
    const copy = nextCopy();
    if (!copy) break;
    const issuedOffset = overdue ? -30 - o * 4 : -(i % 12);
    try {
      await api('POST', '/library/issue', {
        copyId: copy.id,
        studentId: student.id,
        issuedAt: day(issuedOffset),
        dueDate: day(issuedOffset + 14),
      });
    } catch (e) {
      if (e.status === 409 || e.status === 422) {
        i--;
        continue;
      }
      throw e;
    }
    perStudent.set(student.id, (perStudent.get(student.id) ?? 0) + 1);
    stats.issued++;
    if (overdue) {
      stats.overdue++;
      o++;
    }
  }

  // Collect / waive a couple of the historical fines so the fines report has data.
  const pending = await all(api, `/library/fines?institutionId=${inst.id}&status=PENDING`);
  const settled = await all(api, `/library/fines?institutionId=${inst.id}&status=COLLECTED`);
  if (!settled.length && pending.length >= 2) {
    await api('POST', `/library/fines/${pending[0].id}/collect`, {
      utr: `LIB${pending[0].id.replace(/-/g, '').slice(0, 12).toUpperCase()}`,
      note: 'Paid at desk via UPI',
    });
    await api('POST', `/library/fines/${pending[1].id}/waive`, { note: 'Medical leave' });
  }

  // Reservations on books that are currently out, by students without active loans.
  const open = [
    ...(await all(api, `/library/reservations?institutionId=${inst.id}&status=WAITING`)),
    ...(await all(api, `/library/reservations?institutionId=${inst.id}&status=READY`)),
  ];
  const issuedBooks = [
    ...new Set(
      (await all(api, `/library/loans?institutionId=${inst.id}&status=ISSUED`)).map(
        (l) => l.bookId,
      ),
    ),
  ];
  for (let i = open.length, k = 0; i < RESERVATIONS_PER_INST && k < issuedBooks.length; k++) {
    const student = students[40 + i];
    if (!student) break;
    try {
      await api('POST', '/library/reservations', { bookId: issuedBooks[k], studentId: student.id });
      stats.reservations++;
      i++;
    } catch (e) {
      if (e.status !== 409 && e.status !== 422) throw e;
    }
  }
  console.log(`${inst.code}: library seeded`);
}

console.log('Library seed done', stats);
console.log('Librarian logins (password', PASSWORD + '):', logins.join(', '));

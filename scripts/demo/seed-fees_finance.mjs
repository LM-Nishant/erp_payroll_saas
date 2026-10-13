#!/usr/bin/env node
/**
 * Demo seed for the Fees & Finance module (ABBS demo organization). HTTP-API based and
 * idempotent: every record is looked up by its natural key before it is created.
 *
 *   API_URL=http://localhost:3101 node scripts/demo/seed-fees_finance.mjs
 *
 * Creates per institution: fee heads, a late-fee rule, 2026-27 fee structures for every class
 * section (3 terms), student concessions + a sibling discount, invoices for all students,
 * payments for ~60% of students (full / partial, mixed modes) with receipts, a refund, vendors,
 * expenses and manual journal vouchers. Also creates accountant / finance-manager logins.
 */

const API = (process.env.API_URL ?? 'http://localhost:3101').replace(/\/$/, '');
const EMAIL = process.env.SEED_EMAIL ?? 'abbs.admin@abbs.test';
const PASSWORD = process.env.SEED_PASSWORD ?? 'Abbs@2026Demo';
const ORG = process.env.SEED_ORG ?? 'abbs';
// Granting the built-in finance roles needs every permission they carry (anti-escalation), so the
// logins are created as the organization owner (base `pnpm db:seed` user).
const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? 'owner@abbs.test';
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? 'Demo-Passw0rd!';
const YEAR = '2026-27';

let token = '';

async function api(method, path, body) {
  const res = await fetch(`${API}/api/v1${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}
const get = (p) => api('GET', p);
const post = (p, b) => api('POST', p, b);

async function all(path) {
  const out = [];
  const sep = path.includes('?') ? '&' : '?';
  for (let page = 1; ; page++) {
    const r = await get(`${path}${sep}page=${page}&pageSize=100`);
    out.push(...r.data);
    if (out.length >= r.meta.total || r.data.length === 0) return out;
  }
}

/** Deterministic pseudo-random in [0,1) from a string (stable across runs). */
function rand(s) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) % 10_000) / 10_000;
}

const HEADS = [
  { code: 'TUITION', name: 'Tuition fee', category: 'TUITION', sortOrder: 1 },
  { code: 'ADMISSION', name: 'Admission & registration', category: 'ADMISSION', sortOrder: 2 },
  { code: 'EXAM', name: 'Examination fee', category: 'EXAM', sortOrder: 3 },
  { code: 'LIBRARY', name: 'Library fee', category: 'LIBRARY', sortOrder: 4 },
  { code: 'TRANSPORT', name: 'Transport fee', category: 'TRANSPORT', sortOrder: 5 },
  { code: 'HOSTEL', name: 'Hostel fee', category: 'HOSTEL', sortOrder: 6 },
  { code: 'CAUTION', name: 'Caution deposit', category: 'MISC', refundable: true, sortOrder: 7 },
  { code: 'ACTIVITY', name: 'Activities & sports', category: 'MISC', taxRate: 18, sortOrder: 8 },
];

async function seedInstitution(inst, instSections, stats) {
  const school = inst.type === 'SCHOOL';
  console.log(`\n== ${inst.code} ${inst.name} (${instSections.length} sections)`);

  // fees are collected only via UPI: each institution has its own UPI ID
  await api('PUT', '/fees/upi/settings', {
    institutionId: inst.id,
    upiId: `${inst.code.toLowerCase().replace(/[^a-z0-9]/g, '')}.fees@okhdfcbank`,
    payeeName: inst.name.slice(0, 100),
  });

  const heads = new Map(
    (await all(`/fees/heads?institutionId=${inst.id}`)).map((h) => [h.code, h]),
  );
  for (const h of HEADS) {
    if (!heads.has(h.code)) {
      heads.set(h.code, (await post('/fees/heads', { institutionId: inst.id, ...h })).data);
    }
  }
  const headId = (code) => heads.get(code).id;

  const rules = (await get(`/fees/late-rules?institutionId=${inst.id}`)).data;
  let rule = rules.find((r) => r.name === 'Standard late fee');
  if (!rule) {
    rule = (
      await post('/fees/late-rules', {
        institutionId: inst.id,
        name: 'Standard late fee',
        mode: 'PER_DAY',
        amount: school ? 10 : 25,
        graceDays: 7,
        maxAmount: school ? 500 : 1500,
      })
    ).data;
  }

  // concessions first so invoice generation applies them
  const concessions = await all(`/fees/concessions?institutionId=${inst.id}`);
  const conc = async (input) => {
    if (concessions.some((c) => c.name === input.name)) return;
    await post('/fees/concessions', { institutionId: inst.id, academicYear: YEAR, ...input });
    stats.concessions++;
  };
  await conc({
    name: 'Sibling discount 10%',
    kind: 'SIBLING',
    appliesTo: 'SIBLING',
    feeHeadId: headId('TUITION'),
    valueType: 'PERCENT',
    value: 10,
    reason: 'Second and later children of the same guardian',
  });
  const firstStudents = await all(`/students?classSectionId=${instSections[0].id}&status=ACTIVE`);
  const awards = [
    { label: 'Merit scholarship 50%', kind: 'SCHOLARSHIP', valueType: 'PERCENT', value: 50 },
    { label: 'Merit scholarship 25%', kind: 'SCHOLARSHIP', valueType: 'PERCENT', value: 25 },
    { label: 'Staff ward concession', kind: 'CONCESSION', valueType: 'AMOUNT', value: 5000 },
  ];
  for (const [i, a] of awards.entries()) {
    const s = firstStudents[i];
    if (!s) break;
    await conc({
      name: `${a.label} - ${s.admissionNo}`,
      kind: a.kind,
      appliesTo: 'STUDENT',
      studentId: s.id,
      feeHeadId: headId('TUITION'),
      valueType: a.valueType,
      value: a.value,
      reason: a.kind === 'SCHOLARSHIP' ? 'Academic merit 2025-26' : 'Child of staff member',
    });
  }

  // structures + invoices per section
  const structures = new Map(
    (await all(`/fees/structures?institutionId=${inst.id}&academicYear=${YEAR}`)).map((s) => [
      s.code,
      s,
    ]),
  );
  const tuition = school ? 14000 : 38000;
  const item = (c, amount) => ({ feeHeadId: headId(c), amount });
  for (const sec of instSections) {
    const code = `FS-${sec.code}-2627`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
    let structure = structures.get(code);
    if (!structure) {
      structure = (
        await post('/fees/structures', {
          institutionId: inst.id,
          classSectionId: sec.id,
          academicYear: YEAR,
          code,
          name: `${sec.name} fees ${YEAR}`,
          lateRuleId: rule.id,
          installments: [
            {
              label: 'Term 1',
              dueDate: '2026-06-15',
              items: [
                item('TUITION', tuition),
                item('ADMISSION', school ? 2000 : 5000),
                item('LIBRARY', school ? 800 : 2000),
                item('ACTIVITY', school ? 1500 : 2500),
              ],
            },
            {
              label: 'Term 2',
              dueDate: '2026-09-15',
              items: [item('TUITION', tuition), item('EXAM', school ? 1200 : 3000)],
            },
            {
              label: 'Term 3',
              dueDate: '2027-01-15',
              items: [item('TUITION', tuition), item('EXAM', school ? 1200 : 3000)],
            },
          ],
        })
      ).data;
      stats.structures++;
    }
    const gen = (
      await post('/fees/invoices/generate', { structureId: structure.id, issueDate: '2026-05-20' })
    ).data;
    stats.invoices += gen.created;
    console.log(`  ${sec.code}: ${code}, invoices +${gen.created} (existing ${gen.skipped})`);
  }

  // payments: ~60% of students pay (fully or partially); the rest become defaulters
  const invoices = await all(`/fees/invoices?institutionId=${inst.id}&academicYear=${YEAR}`);
  const paidStudents = new Set(
    (await all(`/fees/payments?institutionId=${inst.id}`)).map((p) => p.studentId),
  );
  const byStudent = new Map();
  for (const inv of invoices) {
    if (inv.status === 'CANCELLED') continue;
    byStudent.set(inv.studentId, [...(byStudent.get(inv.studentId) ?? []), inv]);
  }
  for (const [studentId, list] of byStudent) {
    if (paidStudents.has(studentId)) continue;
    const r = rand(studentId);
    if (r >= 0.6) continue;
    list.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const [t1, t2] = list;
    let amount;
    if (r < 0.3) amount = t1.balance + (t2?.balance ?? 0);
    else if (r < 0.45) amount = t1.balance;
    else amount = Math.round(t1.balance * 0.5);
    if (amount <= 0) continue;
    const day = String(1 + Math.floor(rand(`${studentId}d`) * 27)).padStart(2, '0');
    const paidOn = r < 0.3 ? `2026-09-${day}` : `2026-06-${day}`;
    await post('/fees/payments', {
      studentId,
      amount,
      paidOn,
      mode: 'UPI',
      reference: `DEMO${studentId.replace(/-/g, '').slice(0, 12).toUpperCase()}`,
      remarks: 'Demo seed',
    });
    stats.payments++;
  }

  // one partial refund per institution (audit-trail demo)
  const refunded = await all(`/fees/payments?institutionId=${inst.id}&status=PARTIALLY_REFUNDED`);
  if (refunded.length === 0) {
    const p = (await all(`/fees/payments?institutionId=${inst.id}&status=ACTIVE`)).find(
      (x) => x.amount >= 2000,
    );
    if (p) {
      await post(`/fees/payments/${p.id}/refund`, {
        amount: 500,
        mode: 'UPI',
        reference: `RF-${p.number}`.replace(/[^A-Za-z0-9-]/g, '').slice(0, 64),
        refundedOn: '2026-09-28',
        reason: 'Activity fee waived for medical leave',
      });
    }
  }

  // vendors, expenses, manual vouchers
  const accounts = (await get('/finance/accounts')).data;
  const bySystemKey = (key) => accounts.find((a) => a.systemKey === key);
  const vendors = await all(`/finance/vendors?institutionId=${inst.id}`);
  const vendor = async (suffix, name, extra) => {
    const code = `${inst.code}-${suffix}`.slice(0, 32);
    const found = vendors.find((x) => x.code === code);
    if (found) return found;
    const created = (
      await post('/finance/vendors', { institutionId: inst.id, code, name, ...extra })
    ).data;
    vendors.push(created);
    return created;
  };
  const v1 = await vendor('STAT', 'Sri Lakshmi Stationers', {
    gstin: '29ABCDE1234F1Z5',
    phone: '+91 9845012345',
  });
  const v2 = await vendor('ELEC', 'BESCOM Electricity', { phone: '+91 1912' });
  const v3 = await vendor('CLEAN', 'Shine Facility Services', { email: 'billing@shinefs.example' });
  const expenses = await all(`/finance/expenses?institutionId=${inst.id}`);
  const plan = [
    {
      ref: 'EXP-01',
      date: '2026-08-05',
      vendor: v1,
      acct: bySystemKey('admin_expense'),
      amount: 18450,
      desc: 'Exam answer booklets & stationery',
    },
    {
      ref: 'EXP-02',
      date: '2026-09-11',
      vendor: v2,
      acct: bySystemKey('utilities'),
      amount: school ? 42300 : 96800,
      desc: 'Electricity bill Aug 2026',
    },
    {
      ref: 'EXP-03',
      date: '2026-08-17',
      vendor: v3,
      acct: bySystemKey('maintenance'),
      amount: 35000,
      desc: 'Housekeeping contract',
    },
    {
      ref: 'EXP-04',
      date: '2026-08-15',
      vendor: null,
      acct: bySystemKey('general_expense'),
      amount: 12500,
      desc: 'Independence Day celebration',
    },
  ];
  for (const e of plan) {
    const reference = `${inst.code}-${e.ref}`;
    if (expenses.some((x) => x.reference === reference)) continue;
    await post('/finance/expenses', {
      institutionId: inst.id,
      expenseDate: e.date,
      vendorId: e.vendor?.id ?? null,
      expenseAccountId: e.acct.id,
      amount: e.amount,
      mode: e.vendor ? 'BANK_TRANSFER' : 'CASH',
      reference,
      description: e.desc,
    });
    stats.expenses++;
  }
  const vouchers = await all(`/finance/vouchers?institutionId=${inst.id}&sourceType=MANUAL`);
  const cash = bySystemKey('cash');
  const bank = bySystemKey('bank');
  const fund = bySystemKey('corpus_fund');
  const corpus = school ? 500000 : 1500000;
  const manual = [];
  if (bank && fund) {
    manual.push({
      narration: 'Opening balance - corpus fund (demo)',
      type: 'JOURNAL',
      voucherDate: '2026-04-01',
      lines: [
        { accountId: bank.id, debit: corpus, credit: 0 },
        { accountId: fund.id, debit: 0, credit: corpus },
      ],
    });
  }
  if (cash && bank) {
    manual.push({
      narration: 'Cash deposited into bank (demo)',
      type: 'CONTRA',
      voucherDate: '2026-07-01',
      lines: [
        { accountId: bank.id, debit: 50000, credit: 0 },
        { accountId: cash.id, debit: 0, credit: 50000 },
      ],
    });
  }
  for (const v of manual) {
    if (vouchers.some((x) => x.narration === v.narration)) continue;
    await post('/finance/vouchers', { institutionId: inst.id, post: true, ...v });
  }
}

async function main() {
  const login = await post('/auth/login', { email: EMAIL, password: PASSWORD, organization: ORG });
  token = login.data.accessToken;
  const me = (await get('/me')).data;
  if (!me.features.includes('finance')) {
    throw new Error(`The 'finance' feature is not enabled for ${ORG}; enable it on the plan first`);
  }
  console.log(`Signed in as ${me.user.email} (${me.organization?.name})`);

  const institutions = await all('/institutions');
  const sections = await all('/class-sections');
  const stats = { structures: 0, invoices: 0, payments: 0, concessions: 0, expenses: 0 };
  for (const inst of institutions) {
    const instSections = sections.filter(
      (s) => s.institutionId === inst.id && (!s.academicYear || s.academicYear === YEAR),
    );
    if (instSections.length > 0) await seedInstitution(inst, instSections, stats);
  }

  // finance logins: org-wide finance manager + one accountant per institution
  const ownerLogin = await post('/auth/login', {
    email: OWNER_EMAIL,
    password: OWNER_PASSWORD,
    organization: ORG,
  });
  token = ownerLogin.data.accessToken;
  const roles = (await get('/roles?pageSize=100')).data;
  const roleId = (key) => roles.find((r) => r.key === key)?.id;
  const users = await all('/users');
  const ensureUser = async (email, name, roleKey, scope) => {
    if (users.some((u) => u.email === email) || !roleId(roleKey)) return;
    await post('/users', {
      email,
      name,
      password: PASSWORD,
      roles: [{ roleId: roleId(roleKey), scopes: [scope] }],
    });
    console.log(`  + login ${email} (${roleKey})`);
  };
  await ensureUser('finance.manager@abbs.test', 'ABBS Finance Manager', 'finance_manager', {
    type: 'ORGANIZATION',
  });
  for (const inst of institutions) {
    if (!sections.some((s) => s.institutionId === inst.id)) continue;
    const slug = inst.code.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    await ensureUser(`${slug}.accountant@abbs.test`, `${inst.code} Accountant`, 'accountant', {
      type: 'INSTITUTION',
      id: inst.id,
    });
  }

  const tb = (await get('/finance/reports/trial_balance')).data;
  const total = tb.rows.at(-1);
  const defaulters = await get('/fees/defaulters?pageSize=1');
  console.log(`\nDone: ${JSON.stringify(stats)}`);
  console.log(`Trial balance totals: Dr ${total[3]} / Cr ${total[4]}`);
  console.log(`Defaulters: ${defaulters.meta.total}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

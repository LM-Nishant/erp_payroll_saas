// Organization builders for the licence matrix (everything except Greenwood).
import { academicOps } from './education.mjs';
import {
  ensureCampus,
  ensureDepartments,
  ensureGroup,
  ensureInstitution,
  ensureUser,
  linkGuardian,
  scope,
  tenantContext,
} from './core.mjs';
import {
  seedAttendance,
  seedEmployees,
  seedHolidays,
  seedHrMasters,
  seedLeaveRequest,
  seedLeaveSetup,
  seedPayrollRuns,
  seedPayrollSetup,
  seedWorkflows,
  workday,
} from './hr.mjs';
import { TODAY, addDays, all, bump, step } from './lib.mjs';
import { seedCommunication, seedDocuments, seedHostel, seedTransport } from './operations.mjs';

/**
 * Create (or find) an organization through the platform API and apply its subscription,
 * add-ons and organization-level overrides. Returns a tenant context.
 */
export async function createOrg(plat, plans, meta) {
  const plan = plans.find((p) => p.key === meta.plan);
  if (!plan) throw new Error(`Plan ${meta.plan} not found`);
  const existing = (await all(plat, '/platform/organizations')).find((o) => o.slug === meta.slug);
  const org =
    existing ??
    (
      await plat('POST', '/platform/organizations', {
        name: meta.name,
        slug: meta.slug,
        kind: meta.kind,
        planId: plan.id,
        subscriptionStatus: meta.status === 'TRIAL' ? 'TRIAL' : 'ACTIVE',
        owner: { name: meta.ownerName, email: `owner@${meta.domain}`, role: meta.ownerRole },
      })
    ).data;
  if (!existing) bump('organizations');
  // CANCELLED orgs are set up while ACTIVE and cancelled afterwards (see applyStatus).
  await applyStatus(plat, org, plan, meta, meta.status === 'CANCELLED' ? 'ACTIVE' : meta.status);
  const ctx = await tenantContext(plat, org, meta);
  ctx.overrides = [];
  ctx.planDef = plan;
  return ctx;
}

export async function applyStatus(plat, org, plan, meta, status) {
  await plat('PUT', `/platform/organizations/${org.id}/subscription`, {
    planId: plan.id,
    status,
    ...(status === 'TRIAL' ? { trialEndsAt: addDays(TODAY, 14) } : {}),
    addOnFeatures: meta.addOns ?? [],
    limitOverrides: meta.limitOverrides ?? {},
    reason: 'Demo environment licence configuration',
  });
}

/** Feature override at ORGANIZATION / GROUP / INSTITUTION scope (recorded for the manifest). */
export async function override(ctx, { scopeType, target, featureKey, enabled }) {
  await ctx.api('PUT', '/features/overrides', {
    scopeType,
    ...(target ? { targetId: target.id } : {}),
    featureKey,
    enabled,
  });
  ctx.overrides.push({ scopeType, target: target?.name ?? ctx.org.name, featureKey, enabled });
}

const ownerUser = (ctx, name, role, persona, institution) =>
  ensureUser(ctx, {
    email: 'owner',
    name,
    roles: [{ key: role, scope: institution ? scope.inst(institution) : undefined }],
    setRoles: false,
    institution,
    persona,
  });

/* ------------------------------------------------------------------------------------------ */
/* Sunrise Starter School — EDUCATION, starter: education + documents + communication only.   */
/* ------------------------------------------------------------------------------------------ */
export async function seedSunrise(plat, plans) {
  const ctx = await createOrg(plat, plans, {
    name: 'Sunrise Starter School',
    slug: 'sunrise',
    domain: 'sunrise.demo',
    kind: 'EDUCATION',
    plan: 'starter',
    status: 'ACTIVE',
    ownerName: 'Lakshmi Narayan',
    ownerRole: 'institution_owner',
    caseNote:
      'Starter plan: only Education, Documents, Communication (email). HR, Payroll, Finance, Transport, Hostel, Library, Assets are not licensed.',
  });
  const inst = await ensureInstitution(ctx, {
    name: 'Sunrise Starter School',
    code: 'SUN',
    type: 'SCHOOL',
    matchName: true,
  });
  const campus = await ensureCampus(ctx, inst, { name: 'Main Campus', code: 'SUN-MAIN' });
  const depts = await ensureDepartments(ctx, inst, campus, [['ACAD', 'Academics', 'ACAD']]);
  await ownerUser(
    ctx,
    'Lakshmi Narayan',
    'institution_owner',
    'School owner on the Starter plan',
    inst,
  );
  const principal = await ensureUser(ctx, {
    email: 'principal',
    name: 'Gopal Krishnan',
    roles: [{ key: 'principal', scope: scope.inst(inst) }],
    institution: inst,
    persona: 'Principal — academics only (no HR/payroll on Starter)',
  });
  const teacher = await ensureUser(ctx, {
    email: 'teacher',
    name: 'Fatima Sheikh',
    roles: [{ key: 'teacher', scope: scope.dept(depts.ACAD) }],
    institution: inst,
    persona: 'Teacher — attendance, marks, timetable',
  });
  await ensureUser(ctx, {
    email: 'hr',
    name: 'Rakesh Jain',
    roles: [{ key: 'hr_manager', scope: scope.inst(inst) }],
    institution: inst,
    persona:
      'HR manager role, but HR is NOT licensed on Starter — HR menus hidden, APIs return 403',
  });
  const student = await ensureUser(ctx, {
    email: 'student',
    name: 'Kabir Mehta',
    roles: [{ key: 'student', scope: scope.inst(inst) }],
    institution: inst,
    persona: 'Student portal',
  });
  const parent = await ensureUser(ctx, {
    email: 'parent',
    name: 'Vikas Mehta',
    roles: [{ key: 'parent', scope: scope.inst(inst) }],
    institution: inst,
    persona: 'Parent portal',
  });
  const acad = await academicOps(ctx, inst, depts.ACAD, campus, {
    prefix: 'SUN',
    grades: [1, 2, 3],
    sections: ['A'],
    students: 9,
    seed: 3,
    teacherIds: [teacher.id, principal.id],
    special: {
      0: {
        ...portalNames(student, parent),
        userId: student.id,
        email: student.email,
        guardianEmail: parent.email,
      },
    },
    exams: true,
  });
  await linkStudentAndParent(ctx, acad.students[0], student, parent);
  await step('sunrise documents', () =>
    seedDocuments(ctx, [{ title: 'Admission Policy', documentType: 'policy' }]),
  );
  await step('sunrise communication', () =>
    seedCommunication(ctx, {
      channels: ['email'],
      recipients: [parent.id, teacher.id],
      circular: {
        subject: 'Parent-Teacher Meeting on Saturday',
        body: 'Dear parents, the PTM for all classes is on Saturday from 9 AM to 12 noon.',
      },
    }),
  );
  return ctx;
}

/** Student / father names on the record match the portal logins. */
export function portalNames(student, parent) {
  const [first, ...rest] = student.entry.name.split(' ');
  return { first, last: rest.join(' '), guardianName: parent.entry.name };
}

export async function linkStudentAndParent(ctx, record, student, parent) {
  if (!record) return;
  student.entry.linkedTo =
    `Student ${record.admissionNo ?? ''} (${record.firstName} ${record.lastName})`.replace(
      '  ',
      ' ',
    );
  if (parent) {
    await step(`${ctx.slug} parent link`, async () => {
      await linkGuardian(ctx, record, parent.id, 'FATHER');
      parent.entry.linkedTo = `Guardian of ${record.firstName} ${record.lastName}`;
    });
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Acme Technologies — COMPANY, starter + HR & Payroll add-ons (no Education).                */
/* ------------------------------------------------------------------------------------------ */
const ACME_STAFF = [
  ['owner', 'Ashok', 'Mehra', 'MALE', 'ENG', 'CEO', 'FT', null, 4_800_000],
  ['manager', 'Divya', 'Menon', 'FEMALE', 'ENG', 'EM', 'FT', 'owner', 3_000_000],
  ['hr', 'Nandini', 'Rao', 'FEMALE', 'HR', 'HRBP', 'FT', 'owner', 1_500_000],
  ['payroll', 'Sameer', 'Kulkarni', 'MALE', 'FIN', 'PAYS', 'FT', 'finance', 1_200_000],
  ['finance', 'Ritu', 'Bansal', 'FEMALE', 'FIN', 'FINC', 'FT', 'owner', 2_200_000],
  ['employee', 'Rohit', 'Verma', 'MALE', 'ENG', 'SDE', 'FT', 'manager', 1_400_000],
  [null, 'Sneha', 'Pillai', 'FEMALE', 'ENG', 'SDE', 'FT', 'manager', 1_300_000],
  [null, 'Amit', 'Choudhary', 'MALE', 'ENG', 'SSDE', 'FT', 'manager', 2_100_000],
  [null, 'Karan', 'Malhotra', 'MALE', 'SALES', 'AE', 'FT', 'owner', 1_100_000],
  [null, 'Pallavi', 'Joshi', 'FEMALE', 'SALES', 'AE', 'CONTRACT', 'owner', 900_000],
  [null, 'Varun', 'Sinha', 'MALE', 'ENG', 'INTN', 'INTERN', 'manager', 360_000],
];

export async function seedAcme(plat, plans) {
  const ctx = await createOrg(plat, plans, {
    name: 'Acme Technologies',
    slug: 'acme',
    domain: 'acme.demo',
    kind: 'COMPANY',
    plan: 'starter',
    status: 'ACTIVE',
    addOns: ['hr', 'payroll'],
    ownerName: 'Ashok Mehra',
    ownerRole: 'institution_owner',
    caseNote:
      'COMPANY org on Starter + HR & Payroll add-ons. Education is never available to company orgs; Communication is switched off by an organization-level override.',
  });
  const inst = await ensureInstitution(ctx, {
    name: 'Acme Technologies',
    code: 'ACME',
    type: 'COMPANY',
    matchName: true,
  });
  await step('acme override communication', () =>
    override(ctx, { scopeType: 'ORGANIZATION', featureKey: 'communication', enabled: false }),
  );
  const campus = await ensureCampus(ctx, inst, { name: 'Pune Office', code: 'ACME-PUN' });
  const depts = await ensureDepartments(ctx, inst, campus, [
    ['ENG', 'Engineering', 'ENG'],
    ['SALES', 'Sales', 'SALES'],
    ['HR', 'People & HR', 'HR'],
    ['FIN', 'Finance', 'FIN'],
  ]);
  const owner = await ownerUser(
    ctx,
    'Ashok Mehra',
    'institution_owner',
    'Company owner — HRMS + Payroll',
    inst,
  );
  const users = { owner };
  const roleFor = {
    manager: ['hod', 'Engineering manager (head of department) — approves team leave'],
    hr: ['hr_manager', 'HR manager — employees, attendance, leave'],
    payroll: ['payroll_manager', 'Payroll manager — salary structures and payroll runs'],
    finance: ['finance_manager', 'Finance manager — approves payroll runs'],
    employee: ['employee', 'Employee self-service — attendance, leave, payslips'],
  };
  for (const [key, [role, persona]] of Object.entries(roleFor)) {
    const s = ACME_STAFF.find((x) => x[0] === key);
    const roleScope = role === 'hod' ? scope.dept(depts.ENG) : scope.inst(inst);
    const roles = [{ key: role, scope: roleScope }];
    if (role !== 'employee') roles.push({ key: 'employee', scope: scope.inst(inst) });
    users[key] = await ensureUser(ctx, {
      email: key,
      name: `${s[1]} ${s[2]}`,
      roles,
      institution: inst,
      persona,
    });
  }
  const masters = await seedHrMasters(ctx, {
    types: [
      ['FT', 'Full-time', 'FULL_TIME'],
      ['CONTRACT', 'Contract', 'CONTRACT'],
      ['INTERN', 'Intern', 'INTERN'],
    ],
    designations: [
      ['CEO', 'Chief Executive Officer', 10],
      ['EM', 'Engineering Manager', 8],
      ['HRBP', 'HR Business Partner', 7],
      ['FINC', 'Finance Controller', 8],
      ['PAYS', 'Payroll Specialist', 5],
      ['SSDE', 'Senior Software Engineer', 6],
      ['SDE', 'Software Engineer', 5],
      ['AE', 'Account Executive', 4],
      ['INTN', 'Engineering Intern', 1],
    ],
  });
  const specs = ACME_STAFF.map(([key, first, last, gender, dept, desig, type, managerKey], i) => ({
    key: key ?? `staff${i}`,
    first,
    last,
    gender,
    dept: depts[dept],
    desig,
    type,
    managerKey,
    userId: key ? users[key].id : null,
    email: key ? `${key}@acme.demo` : `${first.toLowerCase()}.${last.toLowerCase()}@acme.demo`,
    dob: `198${i % 10}-0${(i % 9) + 1}-15`,
    joined: `202${i % 5}-0${(i % 9) + 1}-01`,
  }));
  const employees = await seedEmployees(ctx, inst, specs, masters);
  for (const [k, u] of Object.entries(users)) {
    if (employees[k]) u.entry.linkedTo = `Employee ${employees[k].employeeCode}`;
  }
  await step('acme holidays', () => seedHolidays(ctx, 'Acme'));
  await step('acme workflows', () =>
    seedWorkflows(ctx, { payrollApprovers: ['finance_manager', 'institution_owner'] }),
  );
  await step('acme attendance', () => seedAttendance(ctx, inst, employees));
  const leave = await step('acme leave setup', () => seedLeaveSetup(ctx, 'Acme'));
  if (leave) {
    await step('acme leave (approved)', () =>
      seedLeaveRequest(ctx, {
        email: users.employee.email,
        type: leave.EL,
        from: workday(14),
        to: addDays(workday(14), 2),
        reason: 'Vacation to Goa',
        approver: users.manager.email,
      }),
    );
    await step('acme leave (pending)', () =>
      seedLeaveRequest(ctx, {
        email: users.employee.email,
        type: leave.CL,
        from: workday(21),
        to: workday(21),
        reason: 'Personal errand',
      }),
    );
  }
  await step('acme payroll setup', () =>
    seedPayrollSetup(
      ctx,
      inst,
      specs.map((s, i) => ({
        employee: employees[s.key],
        annualCtc: ACME_STAFF[i][8],
        excludePf: s.type === 'INTERN',
      })),
      { state: 'MH' },
    ),
  );
  await step('acme payroll run', () =>
    seedPayrollRuns(ctx, inst, {
      payrollEmail: users.payroll.email,
      approverEmail: users.finance.email,
    }),
  );
  await step('acme documents', () =>
    seedDocuments(ctx, [
      { title: 'Employee Handbook', documentType: 'handbook' },
      { title: 'Leave Policy 2026', documentType: 'policy' },
    ]),
  );
  return ctx;
}

/* ------------------------------------------------------------------------------------------ */
/* Brightway Education Group — professional + WhatsApp add-on, 3 institutions, override.      */
/* ------------------------------------------------------------------------------------------ */
export async function seedBrightway(plat, plans) {
  const ctx = await createOrg(plat, plans, {
    name: 'Brightway Education Group',
    slug: 'brightway',
    domain: 'brightway.demo',
    kind: 'EDUCATION',
    plan: 'professional',
    status: 'ACTIVE',
    addOns: ['whatsapp'],
    ownerName: 'Ramesh Iyengar',
    ownerRole: 'group_owner',
    caseNote:
      'Professional plan + WhatsApp add-on; 3 institutions in one group; Hostel disabled for Brightway South by an institution-level override; AI disabled organization-wide.',
  });
  const group = await ensureGroup(ctx, {
    name: 'Brightway Education Group',
    code: 'BEG',
    description: 'Brightway schools and junior college',
  });
  const north = await ensureInstitution(ctx, {
    groupId: group.id,
    name: 'Brightway North School',
    code: 'BW-N',
    type: 'SCHOOL',
  });
  const south = await ensureInstitution(ctx, {
    groupId: group.id,
    name: 'Brightway South School',
    code: 'BW-S',
    type: 'SCHOOL',
  });
  const college = await ensureInstitution(ctx, {
    groupId: group.id,
    name: 'Brightway Junior College',
    code: 'BW-JC',
    type: 'COLLEGE',
  });
  await step('brightway override hostel@south', () =>
    override(ctx, {
      scopeType: 'INSTITUTION',
      target: south,
      featureKey: 'hostel',
      enabled: false,
    }),
  );
  await step('brightway override ai', () =>
    override(ctx, { scopeType: 'ORGANIZATION', featureKey: 'ai', enabled: false }),
  );
  const nc = await ensureCampus(ctx, north, { name: 'North Campus', code: 'BW-N-C' });
  const sc = await ensureCampus(ctx, south, { name: 'South Campus', code: 'BW-S-C' });
  await ensureCampus(ctx, college, { name: 'College Campus', code: 'BW-JC-C' });
  const nd = await ensureDepartments(ctx, north, nc, [['ACAD', 'Academics', 'N-ACAD']]);
  const sd = await ensureDepartments(ctx, south, sc, [['ACAD', 'Academics', 'S-ACAD']]);

  await ownerUser(ctx, 'Ramesh Iyengar', 'group_owner', 'Group owner — all three institutions');
  await ensureUser(ctx, {
    email: 'admin',
    name: 'Shweta Kapoor',
    roles: [{ key: 'group_admin', scope: scope.group(group) }],
    persona: 'Group admin — switches between North, South and the Junior College',
  });
  const np = await ensureUser(ctx, {
    email: 'north.principal',
    name: 'Venkat Raman',
    roles: [{ key: 'principal', scope: scope.inst(north) }],
    institution: north,
    persona: 'Principal of Brightway North only',
  });
  await ensureUser(ctx, {
    email: 'south.principal',
    name: 'Geeta Bose',
    roles: [{ key: 'principal', scope: scope.inst(south) }],
    institution: south,
    persona: 'Principal of Brightway South (hostel disabled here)',
  });
  const nt = await ensureUser(ctx, {
    email: 'north.teacher',
    name: 'Anil Kumble',
    roles: [{ key: 'teacher', scope: scope.dept(nd.ACAD) }],
    institution: north,
    persona: 'Teacher at North',
  });
  const st = await ensureUser(ctx, {
    email: 'south.teacher',
    name: 'Mithali Raj',
    roles: [{ key: 'teacher', scope: scope.dept(sd.ACAD) }],
    institution: south,
    persona: 'Teacher at South',
  });
  await ensureUser(ctx, {
    email: 'north.hostel',
    name: 'Joseph Mathew',
    roles: [{ key: 'hostel_manager', scope: scope.inst(north) }],
    institution: north,
    persona: 'Hostel manager at North — hostel enabled',
  });
  await ensureUser(ctx, {
    email: 'south.hostel',
    name: 'Farhan Akhtar',
    roles: [{ key: 'hostel_manager', scope: scope.inst(south) }],
    institution: south,
    persona: 'Hostel manager at South — hostel is disabled by override (expect 403 / hidden menu)',
  });
  const student = await ensureUser(ctx, {
    email: 'student',
    name: 'Vivaan Iyer',
    roles: [{ key: 'student', scope: scope.inst(north) }],
    institution: north,
    persona: 'Student at North',
  });
  const parent = await ensureUser(ctx, {
    email: 'parent',
    name: 'Sanjay Iyer',
    roles: [{ key: 'parent', scope: scope.inst(north) }],
    institution: north,
    persona: 'Parent at North',
  });

  const na = await academicOps(ctx, north, nd.ACAD, nc, {
    prefix: 'BWN',
    grades: [1, 2, 3],
    sections: ['A', 'B'],
    students: 12,
    seed: 7,
    teacherIds: [nt.id, np.id],
    special: {
      0: {
        ...portalNames(student, parent),
        userId: student.id,
        email: student.email,
        guardianEmail: parent.email,
      },
    },
    exams: true,
    fees: { tuition: 24000 },
  });
  await linkStudentAndParent(ctx, na.students[0], student, parent);
  const sa = await academicOps(ctx, south, sd.ACAD, sc, {
    prefix: 'BWS',
    grades: [1, 2],
    sections: ['A'],
    students: 6,
    seed: 9,
    teacherIds: [st.id],
    fees: { tuition: 20000 },
  });
  await step('brightway hostel north', () =>
    seedHostel(ctx, north, na.students.slice(6, 10), {
      code: 'BW-NH',
      name: 'North Boys & Girls Hostel',
      hostelType: 'MIXED',
    }),
  );
  await step('brightway transport south', () =>
    seedTransport(ctx, south, sa.students.slice(0, 4), { plate: 'TN09-BW' }),
  );
  await step('brightway communication', () =>
    seedCommunication(ctx, {
      channels: ['email', 'sms', 'whatsapp'],
      recipients: [parent.id, nt.id],
      circular: {
        subject: 'Diwali vacation',
        body: 'School remains closed for Diwali vacation. Classes resume on the Monday after Diwali.',
      },
    }),
  );
  return ctx;
}

/* ------------------------------------------------------------------------------------------ */
/* Subscription-status cases: PAST_DUE (still licensed + open invoice), CANCELLED, TRIAL.     */
/* ------------------------------------------------------------------------------------------ */
export async function seedStatusOrgs(plat, plans) {
  const out = [];
  const cases = [
    {
      name: 'Lakeside Public School',
      slug: 'lakeside',
      plan: 'starter',
      status: 'PAST_DUE',
      ownerName: 'Prem Chopra',
      caseNote:
        'PAST_DUE: modules stay licensed (grace) and an OPEN platform invoice is shown under Billing.',
    },
    {
      name: 'Oldtown Academy',
      slug: 'oldtown',
      plan: 'starter',
      status: 'CANCELLED',
      ownerName: 'Usha Uthup',
      caseNote:
        'CANCELLED: nothing is licensed — every module menu is hidden and module APIs return 403.',
    },
    {
      name: 'Maple Leaf Academy',
      slug: 'maple',
      plan: 'professional',
      status: 'TRIAL',
      ownerName: 'Arvind Swamy',
      caseNote: 'TRIAL (14 days left): full Professional features while the trial runs.',
    },
  ];
  for (const c of cases) {
    const ctx = await step(`status org ${c.slug}`, async () => {
      const ctx = await createOrg(plat, plans, {
        ...c,
        domain: `${c.slug}.demo`,
        kind: 'EDUCATION',
        ownerRole: 'institution_owner',
      });
      const inst = await ensureInstitution(ctx, {
        name: c.name,
        code: c.slug.toUpperCase(),
        type: 'SCHOOL',
        matchName: true,
      });
      await ownerUser(ctx, c.ownerName, 'institution_owner', c.caseNote, inst);
      if (c.status === 'PAST_DUE') {
        const end = addDays(TODAY, -8);
        await plat('POST', `/platform/organizations/${ctx.org.id}/invoices`, {
          periodStart: addDays(end, -30),
          periodEnd: end,
          dueAt: addDays(TODAY, -1),
          status: 'OPEN',
          reason: 'Monthly subscription invoice (demo, overdue)',
        });
        bump('platform_invoices');
      }
      if (c.status === 'CANCELLED') await applyStatus(plat, ctx.org, ctx.planDef, c, 'CANCELLED');
      return ctx;
    });
    if (ctx) out.push(ctx);
  }
  return out;
}

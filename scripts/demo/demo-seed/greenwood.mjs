// Greenwood International School — EDUCATION, enterprise plan: every module, group + branch.
import { academicOps } from './education.mjs';
import { seedFinance } from './academic.mjs';
import { seedStudentRecords } from './certificates.mjs';
import {
  ensureCampus,
  ensureDepartments,
  ensureGroup,
  ensureInstitution,
  ensureUser,
  scope,
} from './core.mjs';
import { linkStudentAndParent, portalNames } from './orgs.mjs';
import {
  seedAttendance,
  setAttendancePolicy,
  seedEmployees,
  seedHolidays,
  seedHrMasters,
  seedLeaveRequest,
  seedLeaveSetup,
  seedNewJoiners,
  seedPayrollRuns,
  seedPayrollSetup,
  seedWorkflows,
  workday,
} from './hr.mjs';
import { TODAY, addDays, step } from './lib.mjs';
import {
  seedAssets,
  seedCommunication,
  seedInstitutionSenders,
  seedDocuments,
  seedHostel,
  seedLibrary,
  seedTransport,
} from './operations.mjs';

const HR_TYPES = [
  ['TEACH', 'Teaching staff', 'TEACHING'],
  ['NONTEACH', 'Non-teaching staff', 'NON_TEACHING'],
  ['CONTRACT', 'Contract staff', 'CONTRACT'],
];

const DESIGNATIONS = [
  ['PRIN', 'Principal', 10],
  ['VP', 'Vice Principal', 9],
  ['DEAN', 'Dean of Academics', 9],
  ['REG', 'Registrar', 8],
  ['ADMN', 'School Administrator', 8],
  ['HOD', 'Head of Department', 7],
  ['COORD', 'Academic Coordinator', 7],
  ['PGT', 'Senior Teacher (PGT)', 6],
  ['TGT', 'Teacher (TGT)', 5],
  ['HRM', 'HR Manager', 7],
  ['PAYM', 'Payroll Manager', 7],
  ['FINM', 'Finance Manager', 7],
  ['ACC', 'Accountant', 5],
  ['ITA', 'IT Administrator', 5],
  ['ASTM', 'Asset Manager', 5],
  ['TRNM', 'Transport Manager', 5],
  ['LIB', 'Librarian', 5],
  ['HSTM', 'Hostel Manager', 5],
  ['WRDN', 'Hostel Warden', 4],
  ['OFFA', 'Office Assistant', 2],
];

/*
 * [local, name, roleKey, scopeKey, deptKey, desig, type, managerKey, ctc, gender]
 * scopeKey: 'inst' | 'dept'. Every main-campus staff member also gets the `employee` role.
 */
const STAFF = [
  [
    'principal',
    'Dr. Anita Desai',
    'principal',
    'inst',
    'ADMIN',
    'PRIN',
    'TEACH',
    null,
    2_400_000,
    'FEMALE',
  ],
  [
    'admin',
    'Vikram Malhotra',
    'institution_admin',
    'inst',
    'ADMIN',
    'ADMN',
    'NONTEACH',
    'principal',
    1_200_000,
    'MALE',
  ],
  [
    'vice.principal',
    'Suresh Menon',
    'vice_principal',
    'inst',
    'ADMIN',
    'VP',
    'TEACH',
    'principal',
    1_800_000,
    'MALE',
  ],
  [
    'dean',
    'Dr. Farah Khan',
    'dean',
    'inst',
    'ACAD',
    'DEAN',
    'TEACH',
    'principal',
    1_700_000,
    'FEMALE',
  ],
  [
    'registrar',
    'Prakash Joshi',
    'registrar',
    'inst',
    'ADMIN',
    'REG',
    'NONTEACH',
    'principal',
    900_000,
    'MALE',
  ],
  ['hod', 'Kavita Rao', 'hod', 'dept', 'ACAD', 'HOD', 'TEACH', 'dean', 1_300_000, 'FEMALE'],
  [
    'coordinator',
    'Rahul Bhatt',
    'academic_coordinator',
    'inst',
    'ACAD',
    'COORD',
    'TEACH',
    'dean',
    1_000_000,
    'MALE',
  ],
  ['teacher', 'Priya Nair', 'teacher', 'dept', 'ACAD', 'TGT', 'TEACH', 'hod', 720_000, 'FEMALE'],
  ['teacher2', 'Arjun Reddy', 'teacher', 'dept', 'ACAD', 'TGT', 'TEACH', 'hod', 690_000, 'MALE'],
  ['faculty', 'Neha Kulkarni', 'faculty', 'dept', 'ACAD', 'PGT', 'TEACH', 'hod', 820_000, 'FEMALE'],
  [
    'hr',
    'Sunita Verma',
    'hr_manager',
    'inst',
    'ADMIN',
    'HRM',
    'NONTEACH',
    'principal',
    1_100_000,
    'FEMALE',
  ],
  [
    'payroll',
    'Manoj Pillai',
    'payroll_manager',
    'inst',
    'ACCT',
    'PAYM',
    'NONTEACH',
    'finance',
    950_000,
    'MALE',
  ],
  [
    'finance',
    'Rajiv Saxena',
    'finance_manager',
    'inst',
    'ACCT',
    'FINM',
    'NONTEACH',
    'principal',
    1_400_000,
    'MALE',
  ],
  [
    'accountant',
    'Deepa Iyer',
    'accountant',
    'inst',
    'ACCT',
    'ACC',
    'NONTEACH',
    'finance',
    600_000,
    'FEMALE',
  ],
  [
    'it',
    'Karthik Subramanian',
    'it_admin',
    'inst',
    'SUPPORT',
    'ITA',
    'NONTEACH',
    'admin',
    780_000,
    'MALE',
  ],
  [
    'assets',
    'Imran Shaikh',
    'asset_manager',
    'inst',
    'SUPPORT',
    'ASTM',
    'NONTEACH',
    'admin',
    540_000,
    'MALE',
  ],
  [
    'transport',
    'Gurpreet Singh',
    'transport_manager',
    'inst',
    'SUPPORT',
    'TRNM',
    'NONTEACH',
    'admin',
    520_000,
    'MALE',
  ],
  [
    'librarian',
    'Lata Mangeshkar',
    'librarian',
    'inst',
    'ACAD',
    'LIB',
    'NONTEACH',
    'dean',
    480_000,
    'FEMALE',
  ],
  [
    'hostel',
    'Thomas George',
    'hostel_manager',
    'inst',
    'SUPPORT',
    'HSTM',
    'NONTEACH',
    'admin',
    560_000,
    'MALE',
  ],
  [
    'warden',
    'Mary Fernandes',
    'hostel_warden',
    'inst',
    'SUPPORT',
    'WRDN',
    'NONTEACH',
    'hostel',
    420_000,
    'FEMALE',
  ],
  [
    'employee',
    'Ravi Kumar',
    'employee',
    'inst',
    'ADMIN',
    'OFFA',
    'CONTRACT',
    'admin',
    360_000,
    'MALE',
  ],
];

export async function seedGreenwood(ctx) {
  const group = await ensureGroup(ctx, {
    name: 'Greenwood Education Trust',
    code: 'GW',
    description: 'Trust running the Greenwood schools',
  });
  const main = await ensureInstitution(ctx, {
    groupId: group.id,
    name: 'Greenwood International School',
    code: 'GWIS-MAIN',
    type: 'SCHOOL',
    email: 'office@greenwood.demo',
    phone: '+91 80 4123 4567',
    address: '12 Residency Road, Bengaluru 560025',
  });
  const branch = await ensureInstitution(ctx, {
    groupId: group.id,
    name: 'Greenwood Whitefield Branch',
    code: 'GWIS-BR',
    type: 'SCHOOL',
    email: 'whitefield@greenwood.demo',
    phone: '+91 80 4123 9999',
    address: 'ITPL Main Road, Whitefield, Bengaluru 560066',
  });
  const mainCampus = await ensureCampus(ctx, main, {
    name: 'Residency Road Campus',
    code: 'GW-RR',
  });
  const brCampus = await ensureCampus(ctx, branch, { name: 'Whitefield Campus', code: 'GW-WF' });
  const depts = await ensureDepartments(ctx, main, mainCampus, [
    ['ACAD', 'Academics', 'ACAD'],
    ['ADMIN', 'Administration', 'ADMIN'],
    ['ACCT', 'Accounts', 'ACCT'],
    ['SUPPORT', 'Support Services', 'SUPPORT'],
  ]);
  const brDepts = await ensureDepartments(ctx, branch, brCampus, [
    ['ACAD', 'Academics', 'BR-ACAD'],
  ]);

  // ---- users -------------------------------------------------------------------------------
  const owner = await ensureUser(ctx, {
    email: 'owner',
    name: 'Meera Kapoor',
    roles: [{ key: 'group_owner' }],
    setRoles: false,
    persona: 'Organization owner (trust chairperson) — sees everything',
  });
  const g = scope.group(group);
  await ensureUser(ctx, {
    email: 'group.admin',
    name: 'Sanjay Bhatia',
    roles: [{ key: 'group_admin', scope: g }],
    persona: 'Group administrator for all Greenwood schools',
  });
  await ensureUser(ctx, {
    email: 'group.hr',
    name: 'Pooja Chawla',
    roles: [{ key: 'group_hr', scope: g }],
    persona: 'Group HR across both schools',
  });
  await ensureUser(ctx, {
    email: 'group.finance',
    name: 'Nitin Agarwal',
    roles: [{ key: 'group_finance', scope: g }],
    persona: 'Group finance controller',
  });
  const brOwner = await ensureUser(ctx, {
    email: 'branch.owner',
    name: 'Harish Shetty',
    roles: [{ key: 'institution_owner', scope: scope.inst(branch) }],
    institution: branch,
    persona: 'Branch (institution) owner — limited to the Whitefield branch',
  });
  const brTeacher = await ensureUser(ctx, {
    email: 'branch.teacher',
    name: 'Shalini Gupta',
    roles: [
      { key: 'teacher', scope: scope.dept(brDepts.ACAD) },
      { key: 'employee', scope: scope.inst(branch) },
    ],
    institution: branch,
    persona: 'Teacher at the branch — cannot see main-campus classes',
  });
  const users = {};
  for (const [local, name, roleKey, sk, deptKey] of STAFF) {
    const roleScope = sk === 'dept' ? scope.dept(depts[deptKey]) : scope.inst(main);
    const roles = [{ key: roleKey, scope: roleScope }];
    if (roleKey !== 'employee') roles.push({ key: 'employee', scope: scope.inst(main) });
    users[local] = await ensureUser(ctx, {
      email: local,
      name,
      roles,
      institution: main,
      persona:
        local === 'employee'
          ? 'Self-service employee (PF opted out) — attendance, leave, payslips'
          : `${roleKey.replace(/_/g, ' ')} at the main campus`,
    });
  }
  const student = await ensureUser(ctx, {
    email: 'student',
    name: 'Aarav Sharma',
    roles: [{ key: 'student', scope: scope.inst(main) }],
    institution: main,
    persona: 'Student portal (Grade 1-A, roll 1)',
  });
  const parent = await ensureUser(ctx, {
    email: 'parent',
    name: 'Rajesh Sharma',
    roles: [{ key: 'parent', scope: scope.inst(main) }],
    institution: main,
    persona: 'Parent portal — father of Aarav Sharma',
  });

  // ---- HR masters & employees ----------------------------------------------------------------
  const masters = await seedHrMasters(ctx, { types: HR_TYPES, designations: DESIGNATIONS });
  const specs = STAFF.map(([local, name, , , deptKey, desig, type, managerKey, , gender]) => {
    const [first, ...rest] = name.replace(/^Dr\. /, '').split(' ');
    return {
      key: local,
      first,
      last: rest.join(' '),
      gender,
      dept: depts[deptKey],
      desig,
      type,
      managerKey,
      userId: users[local].id,
      email: users[local].email,
      dob: `19${80 + (local.length % 15)}-0${(local.length % 9) + 1}-1${local.length % 9}`,
      joined: `20${18 + (local.length % 6)}-06-01`,
    };
  });
  const employees = await seedEmployees(ctx, main, specs, masters);
  for (const [k, u] of Object.entries(users)) {
    u.entry.linkedTo = `Employee ${employees[k].employeeCode}`;
  }
  const brEmployees = await seedEmployees(
    ctx,
    branch,
    [
      {
        key: 'branch.teacher',
        first: 'Shalini',
        last: 'Gupta',
        gender: 'FEMALE',
        dept: brDepts.ACAD,
        desig: 'TGT',
        type: 'TEACH',
        userId: brTeacher.id,
        email: brTeacher.email,
      },
    ],
    masters,
  );
  brTeacher.entry.linkedTo = `Employee ${brEmployees['branch.teacher'].employeeCode}`;

  // ---- academics (classes, students, timetables, exams, fees, finance) ---------------------
  const teacherIds = ['teacher', 'teacher2', 'faculty', 'hod'].map((k) => users[k].id);
  const mainAcad = await academicOps(ctx, main, depts.ACAD, mainCampus, {
    prefix: 'GW',
    grades: [1, 2, 3, 4, 5],
    sections: ['A', 'B'],
    students: 20,
    seed: 1,
    teacherIds,
    special: {
      0: {
        ...portalNames(student, parent),
        userId: student.id,
        email: student.email,
        guardianEmail: parent.email,
      },
    },
    exams: true,
    fees: { tuition: 18000 },
  });
  await linkStudentAndParent(ctx, mainAcad.students[0], student, parent);
  await academicOps(ctx, branch, brDepts.ACAD, brCampus, {
    prefix: 'GWB',
    grades: [1, 2],
    sections: ['A'],
    students: 6,
    seed: 5,
    teacherIds: [brTeacher.id],
    fees: { tuition: 15000 },
  });
  await step('greenwood finance', () => seedFinance(ctx, main));

  // ---- HR operations ------------------------------------------------------------------------
  await step('greenwood holidays', () => seedHolidays(ctx, 'Greenwood'));
  await step('greenwood workflows', () =>
    seedWorkflows(ctx, {
      payrollApprovers: ['finance_manager', 'institution_owner', 'group_finance'],
    }),
  );
  await step('greenwood attendance', () => seedAttendance(ctx, main, employees));
  await step('greenwood branch attendance policy', () => setAttendancePolicy(ctx, branch));
  const leave = await step('greenwood leave setup', () => seedLeaveSetup(ctx, 'Greenwood'));
  if (leave) {
    await step('greenwood leave (approved)', () =>
      seedLeaveRequest(ctx, {
        email: users.teacher.email,
        type: leave.CL,
        from: workday(7),
        to: addDays(workday(7), 1),
        reason: 'Family function in Mysuru',
        approver: users.hod.email,
      }),
    );
    await step('greenwood leave (pending)', () =>
      seedLeaveRequest(ctx, {
        email: users.employee.email,
        type: leave.CL,
        from: workday(10),
        to: workday(10),
        reason: 'Personal work at bank',
      }),
    );
    await step('greenwood leave (pending, teacher2)', () =>
      seedLeaveRequest(ctx, {
        email: users.teacher2.email,
        type: leave.SL,
        from: workday(3),
        to: workday(3),
        reason: 'Dental appointment',
      }),
    );
  }
  await step('greenwood payroll setup', () =>
    seedPayrollSetup(
      ctx,
      main,
      STAFF.map(([local, , , , , , , , ctc]) => ({
        employee: employees[local],
        annualCtc: ctc,
        excludePf: local === 'employee',
      })),
      {
        extraComponent: {
          code: 'TRANSPORT_ALW',
          name: 'Transport Allowance',
          type: 'EARNING',
          calcType: 'FIXED',
          amount: 1600,
          taxable: false,
          description: 'Custom component created for the demo',
        },
      },
    ),
  );
  await step('greenwood payroll run', () =>
    seedPayrollRuns(ctx, main, {
      payrollEmail: users.payroll.email,
      approverEmail: users.finance.email,
    }),
  );

  await step('greenwood new joiners', () =>
    seedNewJoiners(ctx, main, masters, {
      dept: depts.ACAD,
      desig: 'TGT',
      type: 'TEACH',
      domain: 'greenwood.demo',
      people: [
        ['Meera', 'Joshi', 'FEMALE'],
        ['Vikram', 'Sethi', 'MALE'],
      ],
    }),
  );

  // ---- campus operations --------------------------------------------------------------------
  const st = mainAcad.students;
  await step('greenwood previous schools & certificates', () => seedStudentRecords(ctx, st));
  await step('greenwood library', () => seedLibrary(ctx, main, st));
  await step('greenwood transport', () =>
    seedTransport(ctx, main, st.slice(0, 8), { plate: 'KA01-GW' }),
  );
  await step('greenwood hostel', () =>
    seedHostel(ctx, main, st.slice(12, 18), {
      code: 'GW-H1',
      name: 'Greenwood Residency',
      hostelType: 'MIXED',
    }),
  );
  await step('greenwood assets', () =>
    seedAssets(ctx, main, [employees.teacher, employees.it, employees.hod]),
  );
  await step('greenwood documents', () =>
    seedDocuments(ctx, [
      {
        title: 'Staff Code of Conduct',
        documentType: 'policy',
        description: 'Rules every staff member acknowledges',
      },
      { title: 'Fee Refund Policy', documentType: 'policy' },
      {
        title: 'CBSE Affiliation Certificate',
        category: 'institution',
        documentType: 'affiliation',
        expiryDate: addDays(TODAY, 365),
      },
      {
        title: 'Appointment Letter',
        ownerType: 'employee',
        ownerId: employees.employee.id,
        category: 'employment',
        documentType: 'appointment_letter',
        confidentiality: 'CONFIDENTIAL',
      },
    ]),
  );
  await step('greenwood communication', () =>
    seedCommunication(ctx, {
      channels: ['email', 'sms', 'whatsapp'],
      recipients: [parent.id, users.teacher.id, users.employee.id],
      circular: {
        subject: 'Annual Sports Day on 14 November',
        body: 'Dear parents and staff, the Annual Sports Day will be held on 14 November at the main ground. Students should report by 8:00 AM in house colours.',
      },
    }),
  );
  await step('greenwood institution senders', () =>
    seedInstitutionSenders(ctx, main, {
      name: 'Greenwood',
      email: 'office@greenwood.demo',
      smsSender: 'GRNWD',
      whatsapp: '+918041234567',
    }),
  );
  return { group, main, branch, owner, brOwner };
}

// HRMS + attendance + leave + workflows + payroll seeding for the demo.
import {
  AY_START,
  MONTH_START,
  PREV_MONTH,
  TODAY,
  addDays,
  all,
  bump,
  dow,
  ist,
  minutes,
  rand,
  step,
  tolerate,
  userSession,
  warn,
  workingDays,
} from './lib.mjs';

const HOLIDAYS = [
  ['01-01', 'New Year'],
  ['01-26', 'Republic Day'],
  ['03-04', 'Holi'],
  ['04-03', 'Good Friday'],
  ['08-15', 'Independence Day'],
  ['09-14', 'Janmashtami'],
  ['10-02', 'Gandhi Jayanti'],
  ['10-20', 'Dussehra'],
  ['11-08', 'Diwali'],
  ['12-25', 'Christmas'],
];
const YEAR = Number(TODAY.slice(0, 4));
export const holidaySet = new Set(HOLIDAYS.map(([md]) => `${YEAR}-${md}`));

/** First Monday–Friday non-holiday on or after `TODAY + offset` (for leave requests). */
export function workday(offset) {
  let d = addDays(TODAY, offset);
  while (dow(d) === 6 || workingDays(d, d, holidaySet).length === 0) {
    d = addDays(d, 1);
  }
  return d;
}

/** Organization holiday calendar for the current year (2nd/4th Saturdays + Sundays off). */
export async function seedHolidays(ctx, label) {
  const existing = await all(ctx.api, `/holidays/calendars?year=${YEAR}&scope=ORGANIZATION`);
  const cal =
    existing[0] ??
    (
      await ctx.api('POST', '/holidays/calendars', {
        scope: 'ORGANIZATION',
        year: YEAR,
        name: `${label} Holiday Calendar ${YEAR}`,
        weeklyOffs: [{ weekday: 0 }, { weekday: 6, weeks: [2, 4] }],
      })
    ).data;
  const detail = (await ctx.api('GET', `/holidays/calendars/${cal.id}`)).data;
  const have = new Set((detail.holidays ?? []).map((h) => h.date));
  for (const [md, name] of HOLIDAYS) {
    const date = `${YEAR}-${md}`;
    if (have.has(date)) continue;
    await ctx.api('POST', `/holidays/calendars/${cal.id}/holidays`, {
      date,
      name,
      type: 'PUBLIC',
      removed: false,
    });
    bump('holidays');
  }
}

/** Org-wide employee types + designations; returns lookup maps by code. */
export async function seedHrMasters(ctx, { types, designations }) {
  const haveTypes = await all(ctx.api, '/employee-types');
  const typeIds = {};
  for (const [code, name, category] of types) {
    const t =
      haveTypes.find((x) => x.code === code) ??
      (await ctx.api('POST', '/employee-types', { code, name, category })).data;
    typeIds[code] = t.id;
  }
  const haveDesig = await all(ctx.api, '/designations');
  const desigIds = {};
  for (const [code, name, level] of designations) {
    const d =
      haveDesig.find((x) => x.code === code) ??
      (await ctx.api('POST', '/designations', { code, name, level })).data;
    desigIds[code] = d.id;
  }
  bump('employee_types', types.length);
  bump('designations', designations.length);
  return { typeIds, desigIds };
}

/**
 * Employees: `{ key, first, last, gender, dept, desig, type, managerKey?, userId?, email, dob,
 * joined }`. Returns map key → employee.
 */
export async function seedEmployees(ctx, inst, specs, masters) {
  const existing = await all(ctx.api, `/employees?institutionId=${inst.id}`);
  const byKey = {};
  for (const s of specs) {
    let emp = existing.find((e) => e.workEmail === s.email);
    if (!emp) {
      emp = (
        await ctx.api('POST', '/employees', {
          institutionId: inst.id,
          departmentId: s.dept.id,
          designationId: masters.desigIds[s.desig],
          employeeTypeId: masters.typeIds[s.type],
          reportingManagerId: s.managerKey ? byKey[s.managerKey]?.id : null,
          userId: s.userId ?? null,
          status: 'ACTIVE',
          firstName: s.first,
          lastName: s.last,
          workEmail: s.email,
          workPhone: `+91 99${String(10_000_000 + Math.floor(rand(s.email) * 89_999_999)).slice(0, 8)}`,
          dateOfJoining: s.joined ?? '2023-06-01',
          personal: {
            dateOfBirth: s.dob ?? '1988-05-14',
            gender: s.gender ?? 'UNDISCLOSED',
            maritalStatus: 'MARRIED',
            nationality: 'Indian',
          },
        })
      ).data;
      bump('employees');
    }
    byKey[s.key] = { ...emp, spec: s };
  }
  return byKey;
}

/** Shift, attendance policy, punches for previous + current month, recompute and lock. */
/** Attendance policy; punches in and out need a live selfie matched to the profile photo. */
export async function setAttendancePolicy(ctx, inst, { faceMatch = true } = {}) {
  await ctx.api('PUT', `/attendance/policies/${inst.id}`, {
    timezone: 'Asia/Kolkata',
    lateMarksPerHalfDay: 3,
    absentIsLop: true,
    allowWebPunch: true,
    allowMobilePunch: true,
    requireFaceMatch: faceMatch,
  });
}

export async function seedAttendance(ctx, inst, employees, { faceMatch = true } = {}) {
  const shifts = await all(ctx.api, `/shifts?institutionId=${inst.id}`);
  const shift =
    shifts.find((s) => s.code === 'GEN') ??
    (
      await ctx.api('POST', '/shifts', {
        institutionId: inst.id,
        code: 'GEN',
        name: 'General 09:00-17:30',
        startMinute: minutes('09:00'),
        endMinute: minutes('17:30'),
        graceInMinutes: 10,
        graceOutMinutes: 10,
        breakMinutes: 45,
        halfDayMinutes: 240,
        fullDayMinutes: 465,
        overtimeAfterMinutes: 60,
        weeklyOffs: null,
        isDefault: true,
      })
    ).data;
  bump('shifts');
  await setAttendancePolicy(ctx, inst, { faceMatch });
  const emps = Object.values(employees);
  for (const e of emps) {
    await tolerate([409], () =>
      ctx.api('POST', '/shifts/assignments', {
        employeeId: e.id,
        shiftId: shift.id,
        effectiveFrom: AY_START,
        effectiveTo: null,
      }),
    );
  }
  const to = addDays(TODAY, -1);
  const days = workingDays(PREV_MONTH.start, to < MONTH_START ? PREV_MONTH.end : to, holidaySet);
  const punches = [];
  for (const e of emps) {
    for (const d of days) {
      const r = rand(e.employeeCode, d);
      if (r < 0.04) continue; // absent (no punch)
      const late = r > 0.9;
      punches.push(
        {
          employeeCode: e.employeeCode,
          punchedAt: ist(d, late ? '09:32' : '08:52'),
          direction: 'IN',
          deviceId: 'BIO-GATE-1',
        },
        {
          employeeCode: e.employeeCode,
          punchedAt: ist(d, r > 0.85 && r <= 0.9 ? '13:05' : '17:41'),
          direction: 'OUT',
          deviceId: 'BIO-GATE-1',
        },
      );
    }
  }
  for (let i = 0; i < punches.length; i += 4000) {
    const j = await ctx.api('POST', '/attendance/punches/import', {
      source: 'API',
      punches: punches.slice(i, i + 4000),
    });
    bump('attendance_punches', j.data.importedRows ?? 0);
    if (j.data.failedRows) {
      warn(
        `${ctx.slug} punch import: ${j.data.failedRows} failed ${JSON.stringify(j.data.errors?.slice(0, 2))}`,
      );
    }
  }
  await ctx.api('POST', '/attendance/recompute', {
    institutionId: inst.id,
    from: PREV_MONTH.start,
    to: days.at(-1) ?? PREV_MONTH.end,
  });
  await tolerate([409], () =>
    ctx.api('POST', '/attendance/locks', {
      institutionId: inst.id,
      periodStart: PREV_MONTH.start,
      periodEnd: PREV_MONTH.end,
      reason: `${PREV_MONTH.label} attendance closed for payroll`,
    }),
  );
  bump('attendance_locks');
}

/** Leave types + org policy + accrual. Returns leave types by code. */
export async function seedLeaveSetup(ctx, label) {
  const defs = [
    ['CL', 'Casual Leave', true, null, 12, 'YEARLY', null],
    ['SL', 'Sick Leave', true, null, 10, 'YEARLY', null],
    ['EL', 'Earned Leave', true, null, 15, 'MONTHLY', 30],
    ['LOP', 'Loss of Pay', false, null, 0, 'NONE', 0],
    ['ML', 'Maternity Leave', true, ['FEMALE'], 182, 'YEARLY', 0],
  ];
  let types = (await ctx.api('GET', '/leave/types?includeInactive=true')).data;
  for (const [code, name, isPaid, genders, , , carry] of defs) {
    if (types.some((t) => t.code === code)) continue;
    await ctx.api('POST', '/leave/types', {
      code,
      name,
      isPaid,
      allowHalfDay: code !== 'ML',
      genders,
      employmentTypes: null,
      requiresDocument: code === 'SL',
      documentAfterDays: code === 'SL' ? 2 : 0,
      sandwichRule: false,
      encashable: code === 'EL',
      maxEncashDays: code === 'EL' ? 10 : null,
      maxCarryForward: carry,
      allowNegativeBalance: code === 'LOP',
    });
    bump('leave_types');
  }
  types = (await ctx.api('GET', '/leave/types?includeInactive=true')).data;
  const byCode = Object.fromEntries(types.map((t) => [t.code, t]));
  const policies = (await ctx.api('GET', '/leave/policies')).data;
  if (!policies.length) {
    await ctx.api('POST', '/leave/policies', {
      name: `${label} Leave Policy`,
      institutionId: null,
      employmentType: null,
      rules: defs.map(([code, , , , annualQuota, freq, carry]) => ({
        leaveTypeId: byCode[code].id,
        accrualFrequency: freq,
        annualQuota,
        proRataOnJoining: true,
        maxCarryForward: carry,
      })),
    });
    bump('leave_policies');
  }
  await ctx.api('POST', '/leave/accrual/run', { asOf: TODAY });
  return byCode;
}

/** Leave, regularization, profile change and payroll approval workflows. */
export async function seedWorkflows(ctx, { payrollApprovers }) {
  const defs = await all(ctx.api, '/workflows/definitions');
  const ensure = async (entityType, name, steps) => {
    if (defs.some((d) => d.entityType === entityType && d.status === 'ACTIVE')) return;
    await ctx.api('POST', '/workflows/definitions', {
      entityType,
      name,
      scopeType: 'ORGANIZATION',
      steps,
      allowSelfApproval: false,
      activate: true,
    });
    bump('workflow_definitions');
  };
  const st = (key, name, approvers) => ({
    key,
    name,
    approvers,
    mode: 'any',
    skipIfNoApprovers: false,
  });
  const role = (roleKey) => ({ type: 'role', roleKey });
  await ensure('leave_request', 'Leave approval', [
    st('manager', 'Reporting manager', [
      { type: 'reporting_manager', levels: 1 },
      role('hr_manager'),
    ]),
  ]);
  await ensure('attendance_regularization', 'Attendance regularization', [
    st('manager', 'Reporting manager', [
      { type: 'reporting_manager', levels: 1 },
      role('hr_manager'),
    ]),
  ]);
  await ensure('employee_profile_change', 'Profile change approval', [
    st('hr', 'HR approval', [role('hr_manager'), role('group_hr')]),
  ]);
  await ensure('payroll_run', 'Payroll run approval', [
    st('finance', 'Finance approval', payrollApprovers.map(role)),
  ]);
}

async function approve(actorEmail, instanceId, comment) {
  if (!instanceId) return false;
  const api = userSession(actorEmail);
  const inst = (await api('GET', `/workflows/instances/${instanceId}`)).data;
  if (inst.status !== 'PENDING') return false;
  await api('POST', `/workflows/instances/${instanceId}/actions`, { action: 'approve', comment });
  return true;
}

/** Employee applies for leave from their own login; optional approval by `approver`. */
export async function seedLeaveRequest(ctx, { email, type, from, to, reason, approver }) {
  const api = userSession(email);
  const req = (
    await api('POST', '/leave/me/requests', {
      leaveTypeId: type.id,
      fromDate: from,
      toDate: to,
      startHalf: false,
      endHalf: false,
      reason,
    })
  ).data;
  bump('leave_requests');
  if (approver)
    await step(`approve leave ${email}`, () =>
      approve(approver, req.workflowInstanceId, 'Approved'),
    );
  return req;
}

const LINES = [
  { componentCode: 'BASIC', calcType: 'PERCENTAGE', percentage: 50, percentOf: 'CTC' },
  { componentCode: 'HRA', calcType: 'PERCENTAGE', percentage: 40, percentOf: 'BASIC' },
  { componentCode: 'SPECIAL', calcType: 'FORMULA', formula: 'max(CTC - BASIC - HRA, 0)' },
];

/**
 * Payroll settings, default + custom components, CTC structure and salaries.
 * `salaries`: [{ employee, annualCtc, excludePf? }].
 */
export async function seedPayrollSetup(ctx, inst, salaries, { state = 'KA', extraComponent } = {}) {
  await ctx.api('PUT', '/payroll/settings', {
    institutionId: inst.id,
    state,
    pfEnabled: true,
    esiEnabled: true,
    ptEnabled: true,
    tdsEnabled: true,
    lwfEnabled: false,
    requireAttendanceLock: true,
    payDay: 1,
  });
  await tolerate([409], () =>
    ctx.api('POST', '/payroll/components/seed-defaults', { institutionId: inst.id }),
  );
  if (extraComponent) {
    await step(`${ctx.slug} custom component`, () =>
      ctx.api('POST', '/payroll/components', { institutionId: inst.id, ...extraComponent }),
    );
  }
  const structures = (await ctx.api('GET', `/payroll/structures?institutionId=${inst.id}`)).data;
  const structure =
    structures.find((s) => s.code === 'STD_CTC') ??
    (
      await ctx.api('POST', '/payroll/structures', {
        institutionId: inst.id,
        code: 'STD_CTC',
        name: 'Standard CTC',
        employmentType: null,
        grade: null,
        description: 'Basic 50% of CTC, HRA 40% of Basic, balance as Special Allowance',
        version: { effectiveFrom: AY_START, notes: 'Current financial year', lines: LINES },
      })
    ).data;
  bump('salary_structures');
  for (const s of salaries) {
    await ctx.api('POST', `/payroll/employees/${s.employee.id}/salary`, {
      structureId: structure.id,
      effectiveFrom: AY_START,
      annualCtc: s.annualCtc,
      amounts: {},
      excludedComponents: s.excludePf ? ['PF_EE', 'PF_ER'] : [],
      taxRegime: 'NEW',
      reason: s.excludePf ? 'Opted out of PF (above wage ceiling)' : 'Annual appraisal',
    });
    bump('employee_salaries');
  }
  return structure;
}

async function pollRun(api, id) {
  for (let i = 0; i < 90; i++) {
    const r = (await api('GET', `/payroll/runs/${id}`)).data;
    if (!['DRAFT', 'COMPUTING', 'QUEUED'].includes(r.status)) return r;
    await new Promise((res) => setTimeout(res, 1000));
  }
  throw new Error(`payroll run ${id} did not finish computing`);
}

/**
 * Previous month: compute → submit (payroll user) → approve + finalize (approver).
 */
export async function seedPayrollRuns(ctx, inst, { payrollEmail, approverEmail }) {
  const papi = userSession(payrollEmail);
  let run = (
    await papi('POST', '/payroll/runs', {
      institutionId: inst.id,
      periodStart: PREV_MONTH.start,
      periodEnd: PREV_MONTH.end,
      label: `${PREV_MONTH.label} payroll`,
    })
  ).data;
  await papi('POST', `/payroll/runs/${run.id}/compute`);
  run = await pollRun(papi, run.id);
  if (run.status !== 'COMPUTED') throw new Error(`run ${run.id} status ${run.status}`);
  run = (await papi('POST', `/payroll/runs/${run.id}/submit`)).data;
  if (run.status === 'PENDING_APPROVAL') {
    await step(`${ctx.slug} payroll approval`, () =>
      approve(approverEmail, run.workflowInstanceId, 'Verified against attendance lock'),
    );
    run = (await papi('GET', `/payroll/runs/${run.id}`)).data;
    if (run.status === 'PENDING_APPROVAL') {
      await userSession(approverEmail)('POST', `/payroll/runs/${run.id}/decision`, {
        approved: true,
        comment: 'Approved',
      });
      run = (await papi('GET', `/payroll/runs/${run.id}`)).data;
    }
  }
  if (run.status === 'APPROVED') {
    // Finalizing (payroll.lock) is a finance / owner action, not the payroll processor's.
    run = (await userSession(approverEmail)('POST', `/payroll/runs/${run.id}/finalize`)).data;
    bump('payroll_runs_finalized');
  } else warn(`${ctx.slug} payroll run left in ${run.status}`);
  return run;
}

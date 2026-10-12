import { z } from 'zod';
import { codeSchema, idSchema, nameSchema, paginationQuerySchema } from './common';
import { employmentTypeSchema, faceDescriptorSchema, isoDateSchema } from './hr';

/*
 * Attendance / leave / holiday / shift foundation (Layer 7). All request schemas are `.strict()`.
 * Dates are `YYYY-MM-DD`; times of day are minutes after local midnight (0..1439) in the
 * institution's attendance time zone.
 */

const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => text(max).nullish();
const minuteOfDay = z.number().int().min(0).max(1439);
const minutes = (max = 24 * 60) => z.number().int().min(0).max(max);
const dayAmount = z.number().min(0).max(366).multipleOf(0.25);

/* --------------------------------- Weekly offs ------------------------------------------ */

/**
 * Weekly-off pattern: `{ weekday: 0 (Sun) .. 6 (Sat), weeks?: [nth occurrences in the month] }`.
 * `weeks` omitted = every week. e.g. every Sunday + 2nd/4th Saturday:
 * `[{ weekday: 0 }, { weekday: 6, weeks: [2, 4] }]`.
 */
export const weeklyOffRuleSchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    weeks: z.array(z.number().int().min(1).max(5)).min(1).max(5).optional(),
  })
  .strict();
export type WeeklyOffRule = z.infer<typeof weeklyOffRuleSchema>;
export const weeklyOffsSchema = z.array(weeklyOffRuleSchema).max(14);

/* --------------------------------- Holidays --------------------------------------------- */

export const HOLIDAY_CALENDAR_SCOPES = ['ORGANIZATION', 'GROUP', 'INSTITUTION', 'CAMPUS'] as const;
export const holidayCalendarScopeSchema = z.enum(HOLIDAY_CALENDAR_SCOPES);
export type HolidayCalendarScope = z.infer<typeof holidayCalendarScopeSchema>;

/** PUBLIC holidays are days off for everybody; RESTRICTED / OPTIONAL are listed but not off. */
export const HOLIDAY_TYPES = ['PUBLIC', 'RESTRICTED', 'OPTIONAL'] as const;
export const holidayTypeSchema = z.enum(HOLIDAY_TYPES);
export type HolidayType = z.infer<typeof holidayTypeSchema>;

export const createHolidayCalendarSchema = z
  .object({
    scope: holidayCalendarScopeSchema,
    /** Required for GROUP / INSTITUTION / CAMPUS scope (the group / institution / campus id). */
    targetId: idSchema.nullish(),
    year: z.number().int().min(2000).max(2100),
    name: nameSchema,
    /** null = inherit the weekly-off pattern from the parent calendar. */
    weeklyOffs: weeklyOffsSchema.nullish(),
  })
  .strict();
export type CreateHolidayCalendarInput = z.infer<typeof createHolidayCalendarSchema>;

export const updateHolidayCalendarSchema = z
  .object({ name: nameSchema.optional(), weeklyOffs: weeklyOffsSchema.nullish() })
  .strict();
export type UpdateHolidayCalendarInput = z.infer<typeof updateHolidayCalendarSchema>;

export const listHolidayCalendarsQuerySchema = paginationQuerySchema
  .extend({
    year: z.coerce.number().int().min(2000).max(2100).optional(),
    scope: holidayCalendarScopeSchema.optional(),
    institutionId: idSchema.optional(),
  })
  .strict();
export type ListHolidayCalendarsQuery = z.infer<typeof listHolidayCalendarsQuerySchema>;

export const upsertHolidaySchema = z
  .object({
    date: isoDateSchema,
    name: nameSchema,
    type: holidayTypeSchema.default('PUBLIC'),
    /** Override: suppress an inherited (parent calendar) holiday on this date. */
    removed: z.boolean().default(false),
  })
  .strict();
export type UpsertHolidayInput = z.infer<typeof upsertHolidaySchema>;

export const holidayParamsSchema = z.object({ id: idSchema, holidayId: idSchema }).strict();

export const dateRangeQuerySchema = z
  .object({ from: isoDateSchema, to: isoDateSchema })
  .strict()
  .refine((v) => v.from <= v.to, { message: '"from" must not be after "to"', path: ['to'] })
  .refine((v) => Date.parse(v.to) - Date.parse(v.from) <= 366 * 86_400_000, {
    message: 'Range must not exceed 366 days',
    path: ['to'],
  });

export const resolveHolidaysQuerySchema = z
  .object({ employeeId: idSchema, from: isoDateSchema, to: isoDateSchema })
  .strict()
  .refine((v) => v.from <= v.to, { message: '"from" must not be after "to"', path: ['to'] });

/* --------------------------------- Shifts ----------------------------------------------- */

const shiftFields = {
  code: codeSchema,
  name: nameSchema,
  startMinute: minuteOfDay,
  endMinute: minuteOfDay,
  graceInMinutes: minutes(240).default(0),
  graceOutMinutes: minutes(240).default(0),
  breakMinutes: minutes(480).default(0),
  /** Worked minutes needed for a half day (below = absent). */
  halfDayMinutes: minutes().default(240),
  /** Worked minutes needed for a full day (below = half day). */
  fullDayMinutes: minutes().default(480),
  /** Overtime counts only beyond the scheduled minutes plus this threshold. */
  overtimeAfterMinutes: minutes().default(0),
  /** null = use the holiday calendar's weekly-off pattern. */
  weeklyOffs: weeklyOffsSchema.nullish(),
  isDefault: z.boolean().default(false),
};

export const createShiftSchema = z
  .object({ institutionId: idSchema, ...shiftFields })
  .strict()
  .refine((v) => v.startMinute !== v.endMinute, {
    message: 'Start and end must differ',
    path: ['endMinute'],
  })
  .refine((v) => v.halfDayMinutes <= v.fullDayMinutes, {
    message: 'Half-day minutes must not exceed full-day minutes',
    path: ['halfDayMinutes'],
  });
export type CreateShiftInput = z.infer<typeof createShiftSchema>;

export const updateShiftSchema = z
  .object({
    name: nameSchema.optional(),
    startMinute: minuteOfDay.optional(),
    endMinute: minuteOfDay.optional(),
    graceInMinutes: minutes(240).optional(),
    graceOutMinutes: minutes(240).optional(),
    breakMinutes: minutes(480).optional(),
    halfDayMinutes: minutes().optional(),
    fullDayMinutes: minutes().optional(),
    overtimeAfterMinutes: minutes().optional(),
    weeklyOffs: weeklyOffsSchema.nullish(),
    isDefault: z.boolean().optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  })
  .strict();
export type UpdateShiftInput = z.infer<typeof updateShiftSchema>;

export const listShiftsQuerySchema = paginationQuerySchema
  .extend({ institutionId: idSchema.optional() })
  .strict();
export type ListShiftsQuery = z.infer<typeof listShiftsQuerySchema>;

export const createShiftAssignmentSchema = z
  .object({
    /** Exactly one of employeeId / departmentId. */
    employeeId: idSchema.nullish(),
    departmentId: idSchema.nullish(),
    shiftId: idSchema,
    /** Basic rotation: cycle through these shifts, `rotationDays` days each (from effectiveFrom). */
    rotationShiftIds: z.array(idSchema).min(2).max(7).nullish(),
    rotationDays: z.number().int().min(1).max(31).nullish(),
    effectiveFrom: isoDateSchema,
    effectiveTo: isoDateSchema.nullish(),
  })
  .strict()
  .refine((v) => !!v.employeeId !== !!v.departmentId, {
    message: 'Provide exactly one of employeeId or departmentId',
    path: ['employeeId'],
  })
  .refine((v) => !v.effectiveTo || v.effectiveTo >= v.effectiveFrom, {
    message: 'effectiveTo must not be before effectiveFrom',
    path: ['effectiveTo'],
  })
  .refine((v) => !v.rotationShiftIds || !!v.rotationDays, {
    message: 'rotationDays is required with rotationShiftIds',
    path: ['rotationDays'],
  });
export type CreateShiftAssignmentInput = z.infer<typeof createShiftAssignmentSchema>;

export const listShiftAssignmentsQuerySchema = paginationQuerySchema
  .extend({
    institutionId: idSchema.optional(),
    employeeId: idSchema.optional(),
    departmentId: idSchema.optional(),
  })
  .strict();
export type ListShiftAssignmentsQuery = z.infer<typeof listShiftAssignmentsQuerySchema>;

export const resolveShiftQuerySchema = z
  .object({ employeeId: idSchema, date: isoDateSchema })
  .strict();

/* --------------------------------- Attendance ------------------------------------------- */

export const ATTENDANCE_STATUSES = [
  'PRESENT',
  'ABSENT',
  'HALF_DAY',
  'LATE',
  'ON_LEAVE',
  'HOLIDAY',
  'WEEKLY_OFF',
  'ON_DUTY',
  'LOP',
] as const;
export const attendanceStatusSchema = z.enum(ATTENDANCE_STATUSES);
export type AttendanceStatus = z.infer<typeof attendanceStatusSchema>;

export const PUNCH_SOURCES = ['WEB', 'MOBILE', 'BIOMETRIC', 'API', 'MANUAL'] as const;
export const punchSourceSchema = z.enum(PUNCH_SOURCES);
export type PunchSource = z.infer<typeof punchSourceSchema>;
export const punchDirectionSchema = z.enum(['IN', 'OUT', 'UNKNOWN']);
export type PunchDirection = z.infer<typeof punchDirectionSchema>;

const geoFields = {
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  accuracyMeters: z.number().min(0).max(100_000).nullish(),
  deviceId: text(100).nullish(),
};

/** Liveness steps the camera challenge can ask for (random order, chosen by the server). */
export const livenessStepSchema = z.enum(['BLINK', 'TURN_LEFT', 'TURN_RIGHT']);
export type LivenessStep = z.infer<typeof livenessStepSchema>;

/** Result of a liveness challenge: the signed challenge plus one face descriptor per step. */
export const livenessProofSchema = z
  .object({
    challenge: z.string().min(16).max(2000),
    frames: z
      .array(z.object({ step: livenessStepSchema, descriptor: faceDescriptorSchema }).strict())
      .min(1)
      .max(4),
  })
  .strict();
export type LivenessProof = z.infer<typeof livenessProofSchema>;

/** Self-service punch (time = server clock). */
export const selfPunchSchema = z
  .object({
    source: z.enum(['WEB', 'MOBILE']).default('WEB'),
    direction: punchDirectionSchema.default('UNKNOWN'),
    ...geoFields,
    /** Descriptor of the selfie (sent with the selfie image when face match is required). */
    faceDescriptor: faceDescriptorSchema.optional(),
    /** Required with face match: proof that a live person completed the camera challenge. */
    liveness: livenessProofSchema.optional(),
  })
  .strict();
export type SelfPunchInput = z.infer<typeof selfPunchSchema>;

/** One punch from a biometric device / integration (`employeeCode` or `employeeId`). */
export const importPunchSchema = z
  .object({
    employeeId: idSchema.nullish(),
    employeeCode: text(40).nullish(),
    punchedAt: z.string().datetime({ offset: true }),
    direction: punchDirectionSchema.default('UNKNOWN'),
    ...geoFields,
  })
  .strict()
  .refine((v) => !!v.employeeId || !!v.employeeCode, {
    message: 'employeeId or employeeCode is required',
    path: ['employeeCode'],
  });
export type ImportPunchInput = z.infer<typeof importPunchSchema>;

export const importPunchesSchema = z
  .object({
    source: z.enum(['BIOMETRIC', 'API']).default('API'),
    punches: z.array(z.unknown()).min(1).max(5000),
  })
  .strict();
export type ImportPunchesInput = z.infer<typeof importPunchesSchema>;

/** Columns of the biometric CSV import. */
export const ATTENDANCE_IMPORT_COLUMNS = [
  'employeeCode',
  'punchedAt',
  'direction',
  'deviceId',
] as const;

export const listAttendanceQuerySchema = paginationQuerySchema
  .extend({
    from: isoDateSchema,
    to: isoDateSchema,
    employeeId: idSchema.optional(),
    institutionId: idSchema.optional(),
    departmentId: idSchema.optional(),
    status: attendanceStatusSchema.optional(),
  })
  .strict();
export type ListAttendanceQuery = z.infer<typeof listAttendanceQuerySchema>;

export const recomputeAttendanceSchema = z
  .object({
    from: isoDateSchema,
    to: isoDateSchema,
    employeeId: idSchema.nullish(),
    institutionId: idSchema.nullish(),
  })
  .strict()
  .refine((v) => v.from <= v.to, { message: '"from" must not be after "to"', path: ['to'] })
  .refine((v) => Date.parse(v.to) - Date.parse(v.from) <= 62 * 86_400_000, {
    message: 'Range must not exceed 62 days',
    path: ['to'],
  });
export type RecomputeAttendanceInput = z.infer<typeof recomputeAttendanceSchema>;

/** HR manual correction of a day (blocked inside locked periods). */
export const overrideAttendanceSchema = z
  .object({
    employeeId: idSchema,
    date: isoDateSchema,
    /** null clears a previous override (back to computed). */
    status: z.enum(['PRESENT', 'ABSENT', 'HALF_DAY', 'ON_DUTY']).nullable(),
    reason: text(1000).min(3),
  })
  .strict();
export type OverrideAttendanceInput = z.infer<typeof overrideAttendanceSchema>;

export const createRegularizationSchema = z
  .object({
    date: isoDateSchema,
    /** Corrected local in / out times (minutes after midnight); at least one, or a status. */
    inMinute: minuteOfDay.nullish(),
    outMinute: minuteOfDay.nullish(),
    requestedStatus: z.enum(['PRESENT', 'HALF_DAY', 'ON_DUTY']).nullish(),
    reason: text(1000).min(3),
  })
  .strict()
  .refine((v) => v.inMinute != null || v.outMinute != null || !!v.requestedStatus, {
    message: 'Provide corrected times or a requested status',
    path: ['requestedStatus'],
  });
export type CreateRegularizationInput = z.infer<typeof createRegularizationSchema>;

export const listRegularizationsQuerySchema = paginationQuerySchema
  .extend({
    employeeId: idSchema.optional(),
    status: z.enum(['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
  })
  .strict();
export type ListRegularizationsQuery = z.infer<typeof listRegularizationsQuerySchema>;

export const lockAttendancePeriodSchema = z
  .object({
    institutionId: idSchema,
    periodStart: isoDateSchema,
    periodEnd: isoDateSchema,
    reason: optionalText(500),
  })
  .strict()
  .refine((v) => v.periodStart <= v.periodEnd, {
    message: 'periodStart must not be after periodEnd',
    path: ['periodEnd'],
  });
export type LockAttendancePeriodInput = z.infer<typeof lockAttendancePeriodSchema>;

export const unlockAttendancePeriodSchema = z.object({ reason: text(500).min(3) }).strict();

export const listPeriodLocksQuerySchema = paginationQuerySchema
  .extend({ institutionId: idSchema.optional() })
  .strict();

export const upsertAttendancePolicySchema = z
  .object({
    /** IANA zone used to map punches to local days / shift times. */
    timezone: text(64).min(1).default('Asia/Kolkata'),
    /** Every N late marks in a period deduct half a day (LOP). null = no deduction. */
    lateMarksPerHalfDay: z.number().int().min(1).max(31).nullish(),
    /** Absent days are loss of pay (default true). */
    absentIsLop: z.boolean().default(true),
    allowWebPunch: z.boolean().default(true),
    allowMobilePunch: z.boolean().default(true),
    /** Self punches need a selfie matching the employee's profile photo. */
    requireFaceMatch: z.boolean().default(false),
  })
  .strict();
export type UpsertAttendancePolicyInput = z.infer<typeof upsertAttendancePolicySchema>;

export const attendanceSummaryQuerySchema = z
  .object({
    from: isoDateSchema,
    to: isoDateSchema,
    employeeId: idSchema.optional(),
    institutionId: idSchema.optional(),
    departmentId: idSchema.optional(),
  })
  .strict()
  .refine((v) => v.from <= v.to, { message: '"from" must not be after "to"', path: ['to'] })
  .refine((v) => Date.parse(v.to) - Date.parse(v.from) <= 62 * 86_400_000, {
    message: 'Range must not exceed 62 days',
    path: ['to'],
  });
export type AttendanceSummaryQuery = z.infer<typeof attendanceSummaryQuerySchema>;

/* --------------------------------- Leave ------------------------------------------------ */

export const ACCRUAL_FREQUENCIES = ['NONE', 'MONTHLY', 'QUARTERLY', 'YEARLY'] as const;
export const accrualFrequencySchema = z.enum(ACCRUAL_FREQUENCIES);
export type AccrualFrequency = z.infer<typeof accrualFrequencySchema>;

export const LEAVE_LEDGER_ENTRY_TYPES = [
  'ACCRUAL',
  'CONSUMPTION',
  'ADJUSTMENT',
  'CARRY_FORWARD',
  'LAPSE',
  'ENCASHMENT',
  'REVERSAL',
] as const;
export type LeaveLedgerEntryType = (typeof LEAVE_LEDGER_ENTRY_TYPES)[number];

export const LEAVE_REQUEST_STATUSES = [
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
] as const;
export type LeaveRequestStatus = (typeof LEAVE_REQUEST_STATUSES)[number];

const genderList = z
  .array(z.enum(['MALE', 'FEMALE', 'OTHER', 'UNDISCLOSED']))
  .min(1)
  .max(4);

export const createLeaveTypeSchema = z
  .object({
    code: codeSchema,
    name: nameSchema,
    isPaid: z.boolean().default(true),
    allowHalfDay: z.boolean().default(true),
    /** null = all genders / employment types eligible. */
    genders: genderList.nullish(),
    employmentTypes: z.array(employmentTypeSchema).min(1).max(7).nullish(),
    requiresDocument: z.boolean().default(false),
    /** A document is required only when the request exceeds this many days (0 = always). */
    documentAfterDays: z.number().min(0).max(366).default(0),
    /** Holidays / weekly offs between leave days count as leave. */
    sandwichRule: z.boolean().default(false),
    encashable: z.boolean().default(false),
    maxEncashDays: dayAmount.nullish(),
    /** Max days carried into the next year (null = unlimited, 0 = none). */
    maxCarryForward: dayAmount.nullish(),
    allowNegativeBalance: z.boolean().default(false),
  })
  .strict();
export type CreateLeaveTypeInput = z.infer<typeof createLeaveTypeSchema>;

export const updateLeaveTypeSchema = z
  .object({
    name: nameSchema.optional(),
    allowHalfDay: z.boolean().optional(),
    genders: genderList.nullish(),
    employmentTypes: z.array(employmentTypeSchema).min(1).max(7).nullish(),
    requiresDocument: z.boolean().optional(),
    documentAfterDays: z.number().min(0).max(366).optional(),
    sandwichRule: z.boolean().optional(),
    encashable: z.boolean().optional(),
    maxEncashDays: dayAmount.nullish(),
    maxCarryForward: dayAmount.nullish(),
    allowNegativeBalance: z.boolean().optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  })
  .strict();
export type UpdateLeaveTypeInput = z.infer<typeof updateLeaveTypeSchema>;

/**
 * Sandwich counting of non-working days enclosed by leave: NONE, only weekly offs, only
 * holidays, or BOTH. `LeaveType.sandwichRule` is the default (true = BOTH, false = NONE).
 */
export const SANDWICH_MODES = ['NONE', 'WEEKLY_OFFS', 'HOLIDAYS', 'BOTH'] as const;
export const sandwichModeSchema = z.enum(SANDWICH_MODES);
export type SandwichMode = z.infer<typeof sandwichModeSchema>;

/** Notice tier: leave of at least `minDays` days must be applied `noticeDays` days ahead. */
export const leaveNoticeTierSchema = z
  .object({
    minDays: z.number().min(0.5).max(366).multipleOf(0.5),
    noticeDays: z.number().int().min(0).max(365),
  })
  .strict();
export type LeaveNoticeTier = z.infer<typeof leaveNoticeTierSchema>;

const wholeDays = (max: number) => z.number().int().min(0).max(max);

/**
 * Leave application rules of a policy rule (policy × leave type). Every field is optional;
 * null / omitted = inherit the leave type default (no restriction, sandwich per type).
 */
export const leaveRuleOverridesShape = {
  sandwichMode: sandwichModeSchema.nullish(),
  /** Sandwich applies only when the request has at least this many working leave days. */
  sandwichMinDays: dayAmount.nullish(),
  /**
   * Also sandwich across adjacent requests (e.g. Friday + Monday applied separately): the
   * weekly offs / holidays between them are charged to the later request.
   */
  sandwichAdjacent: z.boolean().nullish(),
  /** Days in advance a request must be applied (calendar days before the start date). */
  minNoticeDays: wholeDays(365).nullish(),
  /** Longer leave may need more notice; the highest matching tier (and minNoticeDays) applies. */
  noticeTiers: z.array(leaveNoticeTierSchema).max(10).nullish(),
  /** A request may not start more than this many days ahead. */
  maxAdvanceDays: wholeDays(730).nullish(),
  /** Past-dated requests (null = allowed). */
  allowBackdated: z.boolean().nullish(),
  /** How far back a past-dated request may start. */
  backdatedMaxDays: wholeDays(365).nullish(),
  minDaysPerRequest: dayAmount.nullish(),
  maxConsecutiveDays: dayAmount.nullish(),
  maxRequestsPerMonth: z.number().int().min(1).max(31).nullish(),
  maxDaysPerMonth: dayAmount.nullish(),
  /** Leave type codes that may not be taken adjacent to this leave type. */
  notClubbableWith: z.array(codeSchema).max(20).nullish(),
};

export const leavePolicyRuleSchema = z
  .object({
    leaveTypeId: idSchema,
    accrualFrequency: accrualFrequencySchema,
    /** Days per year (credited evenly per period). */
    annualQuota: dayAmount,
    /** Pro-rate the credit of the period in which the employee joined. */
    proRataOnJoining: z.boolean().default(true),
    /** Overrides the leave type's carry-forward cap. */
    maxCarryForward: dayAmount.nullish(),
    ...leaveRuleOverridesShape,
  })
  .strict()
  .superRefine((r, ctx) => {
    const tiers = r.noticeTiers ?? [];
    if (new Set(tiers.map((t) => t.minDays)).size !== tiers.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Notice tiers must have distinct minimum days',
        path: ['noticeTiers'],
      });
    }
    if (
      r.minDaysPerRequest != null &&
      r.maxConsecutiveDays != null &&
      r.minDaysPerRequest > r.maxConsecutiveDays
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Minimum days per request exceeds the maximum consecutive days',
        path: ['minDaysPerRequest'],
      });
    }
    if (r.allowBackdated === false && r.backdatedMaxDays != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'backdatedMaxDays requires backdated requests to be allowed',
        path: ['backdatedMaxDays'],
      });
    }
  });
export type LeavePolicyRuleInput = z.infer<typeof leavePolicyRuleSchema>;

/** Policy scope: organization default (both null), a group, or an institution — not both. */
export const createLeavePolicySchema = z
  .object({
    name: nameSchema,
    /** Group (head office) scope; null = not group-scoped. */
    groupId: idSchema.nullish(),
    /** Institution (college / company) scope; null = not institution-scoped. */
    institutionId: idSchema.nullish(),
    /** null = all employment types. */
    employmentType: employmentTypeSchema.nullish(),
    rules: z.array(leavePolicyRuleSchema).max(50).default([]),
  })
  .strict()
  .refine((v) => !(v.groupId && v.institutionId), {
    message: 'A policy applies to either a group or an institution, not both',
    path: ['groupId'],
  });
export type CreateLeavePolicyInput = z.infer<typeof createLeavePolicySchema>;

export const updateLeavePolicySchema = z
  .object({
    name: nameSchema.optional(),
    rules: z.array(leavePolicyRuleSchema).max(50).optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  })
  .strict();
export type UpdateLeavePolicyInput = z.infer<typeof updateLeavePolicySchema>;

const leaveRequestFields = {
  leaveTypeId: idSchema,
  fromDate: isoDateSchema,
  toDate: isoDateSchema,
  /** First day is taken from the second half only. */
  startHalf: z.boolean().default(false),
  /** Last day is taken for the first half only. */
  endHalf: z.boolean().default(false),
  reason: text(1000).min(3),
  /** Supporting document (core documents) when the leave type requires one. */
  documentId: idSchema.nullish(),
  /**
   * Apply despite leave policy rule violations (notice, limits, clubbing). Requires
   * `leave.manage` on the employee; audited.
   */
  ruleOverrideReason: text(500).min(3).nullish(),
};
const leaveRangeRefine = <T extends { fromDate: string; toDate: string }>(v: T) =>
  v.fromDate <= v.toDate;

export const applyLeaveSchema = z
  .object(leaveRequestFields)
  .strict()
  .refine(leaveRangeRefine, { message: 'fromDate must not be after toDate', path: ['toDate'] });
export type ApplyLeaveInput = z.infer<typeof applyLeaveSchema>;

/** HR applies on behalf of an employee. */
export const applyLeaveForSchema = z
  .object({ employeeId: idSchema, ...leaveRequestFields })
  .strict()
  .refine(leaveRangeRefine, { message: 'fromDate must not be after toDate', path: ['toDate'] });
export type ApplyLeaveForInput = z.infer<typeof applyLeaveForSchema>;

export const leavePreviewSchema = z
  .object({
    employeeId: idSchema.nullish(),
    leaveTypeId: idSchema,
    fromDate: isoDateSchema,
    toDate: isoDateSchema,
    startHalf: z.boolean().default(false),
    endHalf: z.boolean().default(false),
  })
  .strict()
  .refine(leaveRangeRefine, { message: 'fromDate must not be after toDate', path: ['toDate'] });
export type LeavePreviewInput = z.infer<typeof leavePreviewSchema>;

export const cancelLeaveSchema = z.object({ reason: text(1000).min(3) }).strict();

export const listLeaveRequestsQuerySchema = paginationQuerySchema
  .extend({
    employeeId: idSchema.optional(),
    institutionId: idSchema.optional(),
    leaveTypeId: idSchema.optional(),
    status: z.enum(LEAVE_REQUEST_STATUSES).optional(),
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
  })
  .strict();
export type ListLeaveRequestsQuery = z.infer<typeof listLeaveRequestsQuerySchema>;

export const leaveBalanceQuerySchema = z
  .object({ employeeId: idSchema, asOf: isoDateSchema.optional() })
  .strict();

export const leaveLedgerQuerySchema = paginationQuerySchema
  .extend({ employeeId: idSchema, leaveTypeId: idSchema.optional() })
  .strict();

export const leaveAdjustmentSchema = z
  .object({
    employeeId: idSchema,
    leaveTypeId: idSchema,
    entryType: z.enum(['ADJUSTMENT', 'ENCASHMENT']).default('ADJUSTMENT'),
    /** Signed for ADJUSTMENT; positive number of days for ENCASHMENT. */
    days: z.number().min(-366).max(366).multipleOf(0.25),
    effectiveDate: isoDateSchema,
    reason: text(500).min(3),
  })
  .strict()
  .refine((v) => v.days !== 0, { message: 'days must not be 0', path: ['days'] })
  .refine((v) => v.entryType !== 'ENCASHMENT' || v.days > 0, {
    message: 'Encashment days must be positive',
    path: ['days'],
  });
export type LeaveAdjustmentInput = z.infer<typeof leaveAdjustmentSchema>;

export const runAccrualSchema = z.object({ asOf: isoDateSchema.optional() }).strict();
export const runYearEndSchema = z.object({ year: z.number().int().min(2000).max(2100) }).strict();

export const holidayTypeLabels: Record<HolidayType, string> = {
  PUBLIC: 'Public holiday',
  RESTRICTED: 'Restricted holiday',
  OPTIONAL: 'Optional holiday',
};

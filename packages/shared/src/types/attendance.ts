import type {
  AccrualFrequency,
  AttendanceStatus,
  HolidayCalendarScope,
  HolidayType,
  LeaveLedgerEntryType,
  LeaveRequestStatus,
  PunchDirection,
  PunchSource,
  WeeklyOffRule,
} from '../schemas/attendance';
import type { EmploymentType } from '../schemas/hr';

/* Attendance / leave / holiday / shift DTOs (Layer 7). Dates `YYYY-MM-DD`, timestamps ISO. */

export interface HolidayDto {
  id: string;
  calendarId: string;
  date: string;
  name: string;
  type: HolidayType;
  removed: boolean;
}

export interface HolidayCalendarDto {
  id: string;
  scope: HolidayCalendarScope;
  groupId: string | null;
  institutionId: string | null;
  campusId: string | null;
  year: number;
  name: string;
  weeklyOffs: WeeklyOffRule[] | null;
  holidayCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface HolidayCalendarDetailDto extends HolidayCalendarDto {
  holidays: HolidayDto[];
}

/** One non-working (or listed optional) day for an employee, from the effective calendar chain. */
export interface ResolvedDayDto {
  date: string;
  institutionId: string | null;
  kind: 'HOLIDAY' | 'WEEKLY_OFF' | 'RESTRICTED' | 'OPTIONAL';
  name: string;
  /** Calendar that supplied the entry (null for the built-in Sunday default). */
  calendarId: string | null;
}

export interface ShiftDto {
  id: string;
  institutionId: string;
  code: string;
  name: string;
  startMinute: number;
  endMinute: number;
  crossesMidnight: boolean;
  graceInMinutes: number;
  graceOutMinutes: number;
  breakMinutes: number;
  halfDayMinutes: number;
  fullDayMinutes: number;
  overtimeAfterMinutes: number;
  weeklyOffs: WeeklyOffRule[] | null;
  isDefault: boolean;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
}

export interface ShiftAssignmentDto {
  id: string;
  institutionId: string;
  employeeId: string | null;
  employeeCode?: string;
  employeeName?: string;
  departmentId: string | null;
  shiftId: string;
  rotationShiftIds: string[] | null;
  rotationDays: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
}

export interface ResolvedShiftDto {
  employeeId: string;
  date: string;
  institutionId: string | null;
  source: 'EMPLOYEE' | 'DEPARTMENT' | 'INSTITUTION_DEFAULT' | 'NONE';
  assignmentId: string | null;
  shift: ShiftDto | null;
}

export interface AttendancePunchDto {
  id: string;
  employeeId: string;
  punchedAt: string;
  attendanceDate: string;
  direction: PunchDirection;
  source: PunchSource;
  deviceId: string | null;
  latitude: number | null;
  longitude: number | null;
  createdAt: string;
}

export interface AttendanceRecordDto {
  id: string;
  employeeId: string;
  employeeCode?: string;
  employeeName?: string;
  date: string;
  institutionId: string;
  departmentId: string | null;
  shiftId: string | null;
  status: AttendanceStatus;
  /** Status forced by HR override / approved regularization (null = computed). */
  overrideStatus: AttendanceStatus | null;
  firstIn: string | null;
  lastOut: string | null;
  workedMinutes: number;
  lateMinutes: number;
  earlyExitMinutes: number;
  overtimeMinutes: number;
  isLate: boolean;
  missingPunch: boolean;
  /** Day weights (sum to 1): present / paid leave / unpaid leave / absent / holiday-or-weekly-off. */
  presentDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  absentDays: number;
  offDays: number;
  leaveTypeId: string | null;
  leaveRequestId: string | null;
  holidayName: string | null;
  locked: boolean;
  computedAt: string;
}

export interface AttendanceRegularizationDto {
  id: string;
  employeeId: string;
  employeeCode?: string;
  employeeName?: string;
  date: string;
  inMinute: number | null;
  outMinute: number | null;
  requestedStatus: AttendanceStatus | null;
  reason: string;
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  workflowInstanceId: string | null;
  decidedComment: string | null;
  createdAt: string;
}

export interface AttendancePeriodLockDto {
  id: string;
  institutionId: string;
  periodStart: string;
  periodEnd: string;
  status: 'LOCKED' | 'UNLOCKED';
  reason: string | null;
  lockedAt: string;
  lockedByUserId: string | null;
  unlockedAt: string | null;
  unlockedByUserId: string | null;
  unlockReason: string | null;
}

export interface AttendancePolicyDto {
  institutionId: string;
  timezone: string;
  lateMarksPerHalfDay: number | null;
  absentIsLop: boolean;
  allowWebPunch: boolean;
  allowMobilePunch: boolean;
  /** True when no policy row exists and defaults are returned. */
  isDefault: boolean;
}

export interface AttendanceImportResultDto {
  id: string;
  source: 'BIOMETRIC' | 'API';
  fileName: string | null;
  status: 'COMPLETED' | 'FAILED';
  totalRows: number;
  importedRows: number;
  duplicateRows: number;
  failedRows: number;
  errors: { row: number; message: string }[];
  createdAt: string;
}

/**
 * Payroll feed (acceptance criteria 11-13): attendance of one employee for a pay period.
 * Every employed, processed day contributes exactly 1 to
 * `presentDays + paidLeaveDays + unpaidLeaveDays + absentDays + holidays + weeklyOffs`
 * (half days split 0.5 / 0.5). See docs/ARCHITECTURE.md §10.7 for the full contract.
 */
export interface AttendanceSummaryDto {
  employeeId: string;
  employeeCode: string;
  periodStart: string;
  periodEnd: string;
  calendarDays: number;
  /** Days within the employment window (joining .. last working day). */
  employedDays: number;
  /** Employed days not yet processed (in the future) — excluded from every other count. */
  pendingDays: number;
  payableDays: number;
  presentDays: number;
  onDutyDays: number;
  paidLeaveDays: number;
  paidLeaveByType: { leaveTypeId: string; code: string; days: number }[];
  unpaidLeaveDays: number;
  absentDays: number;
  lateDeductionDays: number;
  /** unpaidLeaveDays + absentDays (when policy.absentIsLop) + lateDeductionDays. */
  lopDays: number;
  holidays: number;
  weeklyOffs: number;
  lateCount: number;
  earlyExitCount: number;
  overtimeMinutes: number;
  overtimeHours: number;
  /** True when every employed day of the period lies in a locked attendance period. */
  locked: boolean;
  /** Days attributed per institution (transfers inside the period split the period). */
  institutionDays: { institutionId: string; days: number }[];
}

export interface LeaveTypeDto {
  id: string;
  code: string;
  name: string;
  isPaid: boolean;
  allowHalfDay: boolean;
  genders: string[] | null;
  employmentTypes: EmploymentType[] | null;
  requiresDocument: boolean;
  documentAfterDays: number;
  sandwichRule: boolean;
  encashable: boolean;
  maxEncashDays: number | null;
  maxCarryForward: number | null;
  allowNegativeBalance: boolean;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
}

export interface LeavePolicyRuleDto {
  id: string;
  leaveTypeId: string;
  accrualFrequency: AccrualFrequency;
  annualQuota: number;
  proRataOnJoining: boolean;
  maxCarryForward: number | null;
}

export interface LeavePolicyDto {
  id: string;
  name: string;
  institutionId: string | null;
  employmentType: EmploymentType | null;
  status: 'ACTIVE' | 'INACTIVE';
  rules: LeavePolicyRuleDto[];
  createdAt: string;
  updatedAt: string;
}

export interface LeaveBalanceDto {
  leaveTypeId: string;
  code: string;
  name: string;
  isPaid: boolean;
  /** Ledger sum (accruals + carry-forward + adjustments − consumption − lapse − encashment). */
  balance: number;
  /** Days in pending (not yet approved) requests. */
  pending: number;
  available: number;
  accrued: number;
  consumed: number;
}

export interface LeaveLedgerEntryDto {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  entryType: LeaveLedgerEntryType;
  days: number;
  effectiveDate: string;
  periodKey: string | null;
  leaveRequestId: string | null;
  reason: string | null;
  createdByUserId: string | null;
  createdAt: string;
}

export interface LeaveDayDto {
  date: string;
  /** Leave counted for this date (0, 0.5 or 1). */
  days: number;
  kind: 'WORKING' | 'HOLIDAY' | 'WEEKLY_OFF';
  sandwiched: boolean;
  name?: string;
}

export interface LeavePreviewDto {
  employeeId: string;
  leaveTypeId: string;
  fromDate: string;
  toDate: string;
  days: number;
  breakdown: LeaveDayDto[];
  balance: LeaveBalanceDto | null;
  requiresDocument: boolean;
}

export interface LeaveRequestDto {
  id: string;
  employeeId: string;
  employeeCode?: string;
  employeeName?: string;
  leaveTypeId: string;
  leaveTypeCode?: string;
  institutionId: string;
  fromDate: string;
  toDate: string;
  startHalf: boolean;
  endHalf: boolean;
  days: number;
  breakdown: LeaveDayDto[];
  reason: string;
  documentId: string | null;
  status: LeaveRequestStatus;
  workflowInstanceId: string | null;
  decidedComment: string | null;
  cancelReason: string | null;
  appliedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MyAttendanceDto {
  employeeId: string;
  from: string;
  to: string;
  records: AttendanceRecordDto[];
  punches: AttendancePunchDto[];
  days: ResolvedDayDto[];
}

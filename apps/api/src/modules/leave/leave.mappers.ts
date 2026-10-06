import type {
  LeaveDayDto,
  LeaveLedgerEntryDto,
  LeavePolicyDto,
  LeaveRequestDto,
  LeaveTypeDto,
} from '@erp/shared';
import type {
  LeaveLedgerEntry,
  LeavePolicy,
  LeavePolicyRule,
  LeaveRequest,
  LeaveType,
  Prisma,
} from '@prisma/client';
import { dateToStr } from '../attendance/time';

const num = (d: Prisma.Decimal | number) => Number(d);
const numOrNull = (d: Prisma.Decimal | number | null) => (d == null ? null : Number(d));
const strList = (v: Prisma.JsonValue | null) => (Array.isArray(v) ? (v as string[]) : null);

export const toLeaveTypeDto = (t: LeaveType): LeaveTypeDto => ({
  id: t.id,
  code: t.code,
  name: t.name,
  isPaid: t.isPaid,
  allowHalfDay: t.allowHalfDay,
  genders: strList(t.genders),
  employmentTypes: strList(t.employmentTypes) as LeaveTypeDto['employmentTypes'],
  requiresDocument: t.requiresDocument,
  documentAfterDays: num(t.documentAfterDays),
  sandwichRule: t.sandwichRule,
  encashable: t.encashable,
  maxEncashDays: numOrNull(t.maxEncashDays),
  maxCarryForward: numOrNull(t.maxCarryForward),
  allowNegativeBalance: t.allowNegativeBalance,
  status: t.status,
  createdAt: t.createdAt.toISOString(),
  updatedAt: t.updatedAt.toISOString(),
});

export const toLeavePolicyDto = (
  p: LeavePolicy & { rules: LeavePolicyRule[] },
): LeavePolicyDto => ({
  id: p.id,
  name: p.name,
  institutionId: p.institutionId,
  employmentType: p.employmentType,
  status: p.status,
  rules: p.rules.map((r) => ({
    id: r.id,
    leaveTypeId: r.leaveTypeId,
    accrualFrequency: r.accrualFrequency,
    annualQuota: num(r.annualQuota),
    proRataOnJoining: r.proRataOnJoining,
    maxCarryForward: numOrNull(r.maxCarryForward),
  })),
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
});

export const toLedgerDto = (e: LeaveLedgerEntry): LeaveLedgerEntryDto => ({
  id: e.id,
  employeeId: e.employeeId,
  leaveTypeId: e.leaveTypeId,
  entryType: e.entryType,
  days: num(e.days),
  effectiveDate: dateToStr(e.effectiveDate),
  periodKey: e.periodKey,
  leaveRequestId: e.leaveRequestId,
  reason: e.reason,
  createdByUserId: e.createdByUserId,
  createdAt: e.createdAt.toISOString(),
});

export const toLeaveRequestDto = (
  r: LeaveRequest & {
    employee?: { employeeCode: string; displayName: string } | null;
    leaveType?: { code: string } | null;
  },
): LeaveRequestDto => ({
  id: r.id,
  employeeId: r.employeeId,
  ...(r.employee
    ? { employeeCode: r.employee.employeeCode, employeeName: r.employee.displayName }
    : {}),
  leaveTypeId: r.leaveTypeId,
  ...(r.leaveType ? { leaveTypeCode: r.leaveType.code } : {}),
  institutionId: r.institutionId,
  fromDate: dateToStr(r.fromDate),
  toDate: dateToStr(r.toDate),
  startHalf: r.startHalf,
  endHalf: r.endHalf,
  days: num(r.days),
  breakdown: r.breakdown as unknown as LeaveDayDto[],
  reason: r.reason,
  documentId: r.documentId,
  status: r.status,
  workflowInstanceId: r.workflowInstanceId,
  decidedComment: r.decidedComment,
  cancelReason: r.cancelReason,
  appliedByUserId: r.appliedByUserId,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

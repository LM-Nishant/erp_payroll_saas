import type {
  AttendanceImportResultDto,
  AttendancePeriodLockDto,
  AttendancePunchDto,
  AttendanceRecordDto,
  AttendanceRegularizationDto,
  AttendanceStatus,
} from '@erp/shared';
import type {
  AttendanceImportJob,
  AttendancePeriodLock,
  AttendancePunch,
  AttendanceRecord,
  AttendanceRegularization,
} from '@prisma/client';
import { dateToStr } from './time';

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export const toPunchDto = (p: AttendancePunch): AttendancePunchDto => ({
  id: p.id,
  employeeId: p.employeeId,
  punchedAt: p.punchedAt.toISOString(),
  attendanceDate: dateToStr(p.attendanceDate),
  direction: p.direction,
  source: p.source,
  deviceId: p.deviceId,
  latitude: n(p.latitude),
  longitude: n(p.longitude),
  selfieDocumentId: p.selfieDocumentId,
  faceDistance: n(p.faceDistance),
  createdAt: p.createdAt.toISOString(),
});

export const toRecordDto = (
  r: AttendanceRecord & { employee?: { employeeCode: string; displayName: string } },
  locked = false,
  today?: string,
): AttendanceRecordDto => ({
  id: r.id,
  employeeId: r.employeeId,
  ...(r.employee
    ? { employeeCode: r.employee.employeeCode, employeeName: r.employee.displayName }
    : {}),
  date: dateToStr(r.date),
  institutionId: r.institutionId,
  departmentId: r.departmentId,
  shiftId: r.shiftId,
  status: r.status as AttendanceStatus,
  overrideStatus: (r.overrideStatus as AttendanceStatus | null) ?? null,
  firstIn: r.firstIn?.toISOString() ?? null,
  lastOut: r.lastOut?.toISOString() ?? null,
  workedMinutes: r.workedMinutes,
  lateMinutes: r.lateMinutes,
  earlyExitMinutes: r.earlyExitMinutes,
  overtimeMinutes: r.overtimeMinutes,
  isLate: r.isLate,
  missingPunch: r.missingPunch,
  presentDays: Number(r.presentDays),
  paidLeaveDays: Number(r.paidLeaveDays),
  unpaidLeaveDays: Number(r.unpaidLeaveDays),
  absentDays: Number(r.absentDays),
  offDays: Number(r.offDays),
  leaveTypeId: r.leaveTypeId,
  leaveRequestId: r.leaveRequestId,
  holidayName: r.holidayName,
  locked,
  inProgress:
    !!today &&
    dateToStr(r.date) === today &&
    !r.overrideStatus &&
    (r.status === 'ABSENT' || r.status === 'HALF_DAY'),
  computedAt: r.computedAt.toISOString(),
});

export const toRegularizationDto = (
  r: AttendanceRegularization & { employee?: { employeeCode: string; displayName: string } },
): AttendanceRegularizationDto => ({
  id: r.id,
  employeeId: r.employeeId,
  ...(r.employee
    ? { employeeCode: r.employee.employeeCode, employeeName: r.employee.displayName }
    : {}),
  date: dateToStr(r.date),
  inMinute: r.inMinute,
  outMinute: r.outMinute,
  requestedStatus: (r.requestedStatus as AttendanceStatus | null) ?? null,
  reason: r.reason,
  status: r.status,
  workflowInstanceId: r.workflowInstanceId,
  decidedComment: r.decidedComment,
  createdAt: r.createdAt.toISOString(),
});

export const toLockDto = (l: AttendancePeriodLock): AttendancePeriodLockDto => ({
  id: l.id,
  institutionId: l.institutionId,
  periodStart: dateToStr(l.periodStart),
  periodEnd: dateToStr(l.periodEnd),
  status: l.status,
  reason: l.reason,
  lockedAt: l.lockedAt.toISOString(),
  lockedByUserId: l.lockedByUserId,
  unlockedAt: l.unlockedAt?.toISOString() ?? null,
  unlockedByUserId: l.unlockedByUserId,
  unlockReason: l.unlockReason,
});

export const toImportDto = (j: AttendanceImportJob): AttendanceImportResultDto => ({
  id: j.id,
  source: j.source === 'BIOMETRIC' ? 'BIOMETRIC' : 'API',
  fileName: j.fileName,
  status: j.status === 'FAILED' ? 'FAILED' : 'COMPLETED',
  totalRows: j.totalRows,
  importedRows: j.importedRows,
  duplicateRows: j.duplicateRows,
  failedRows: j.failedRows,
  errors: (j.errors as { row: number; message: string }[] | null) ?? [],
  createdAt: j.createdAt.toISOString(),
});

import type { AttendanceRecord } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { toRecordDto } from './attendance.mappers';
import { strToDate } from './time';

const record = (over: Partial<AttendanceRecord> = {}) =>
  ({
    id: 'r1',
    employeeId: 'e1',
    date: strToDate('2026-10-13'),
    institutionId: 'i1',
    departmentId: null,
    shiftId: null,
    status: 'ABSENT',
    overrideStatus: null,
    firstIn: null,
    lastOut: null,
    workedMinutes: 0,
    lateMinutes: 0,
    earlyExitMinutes: 0,
    overtimeMinutes: 0,
    isLate: false,
    missingPunch: false,
    presentDays: 0,
    paidLeaveDays: 0,
    unpaidLeaveDays: 0,
    absentDays: 1,
    offDays: 0,
    leaveTypeId: null,
    leaveRequestId: null,
    holidayName: null,
    computedAt: new Date(),
    ...over,
  }) as unknown as AttendanceRecord;

describe('toRecordDto inProgress', () => {
  it("marks today's computed absence as in progress", () => {
    expect(toRecordDto(record(), false, '2026-10-13').inProgress).toBe(true);
    expect(toRecordDto(record({ status: 'HALF_DAY' }), false, '2026-10-13').inProgress).toBe(true);
  });

  it('keeps past absences, HR overrides and present days as they are', () => {
    expect(toRecordDto(record(), false, '2026-10-14').inProgress).toBe(false);
    expect(toRecordDto(record({ overrideStatus: 'ABSENT' }), false, '2026-10-13').inProgress).toBe(
      false,
    );
    expect(toRecordDto(record({ status: 'PRESENT' }), false, '2026-10-13').inProgress).toBe(false);
    expect(toRecordDto(record()).inProgress).toBe(false);
  });
});

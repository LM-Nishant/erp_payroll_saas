import { describe, expect, it } from 'vitest';
import {
  collapseDay,
  daysOfMonth,
  summarizeAttendance,
  withinEditWindow,
} from './attendance.logic';

describe('summarizeAttendance', () => {
  it('counts statuses and weights late / half-day', () => {
    const s = summarizeAttendance(['PRESENT', 'LATE', 'HALF_DAY', 'ABSENT']);
    expect(s).toMatchObject({ workingDays: 4, present: 1, late: 1, halfDay: 1, absent: 1 });
    expect(s.percentage).toBe(62.5);
  });

  it('returns 0% for no marks', () => {
    expect(summarizeAttendance([]).percentage).toBe(0);
  });
});

describe('withinEditWindow', () => {
  it('allows today and the last N days only', () => {
    expect(withinEditWindow('2026-10-07', '2026-10-07', 3)).toBe(true);
    expect(withinEditWindow('2026-10-04', '2026-10-07', 3)).toBe(true);
    expect(withinEditWindow('2026-10-03', '2026-10-07', 3)).toBe(false);
    expect(withinEditWindow('2026-10-08', '2026-10-07', 3)).toBe(false);
  });
});

describe('daysOfMonth', () => {
  it('handles leap February', () => {
    expect(daysOfMonth('2028-02')).toHaveLength(29);
    expect(daysOfMonth('2026-10')[0]).toBe('2026-10-01');
  });
});

describe('collapseDay', () => {
  it('prefers the daily mark and derives from periods otherwise', () => {
    expect(collapseDay('LEAVE', ['PRESENT'])).toBe('LEAVE');
    expect(collapseDay(undefined, [])).toBeNull();
    expect(collapseDay(undefined, ['ABSENT', 'ABSENT'])).toBe('ABSENT');
    expect(collapseDay(undefined, ['PRESENT', 'LATE'])).toBe('PRESENT');
    expect(collapseDay(undefined, ['PRESENT', 'ABSENT'])).toBe('HALF_DAY');
  });
});

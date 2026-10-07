import { describe, expect, it } from 'vitest';
import { detectClashes, isoDayOfWeek } from './timetable.logic';

describe('detectClashes', () => {
  it('flags a teacher booked in two sections in the same slot', () => {
    const clashes = detectClashes([
      { classSectionId: 'A', dayOfWeek: 1, periodId: 'p1', teacherUserId: 't1', room: '101' },
      { classSectionId: 'B', dayOfWeek: 1, periodId: 'p1', teacherUserId: 't1', room: '102' },
      { classSectionId: 'C', dayOfWeek: 1, periodId: 'p2', teacherUserId: 't1', room: '101' },
    ]);
    expect(clashes).toEqual([
      { kind: 'TEACHER', dayOfWeek: 1, periodId: 'p1', key: 't1', classSectionIds: ['A', 'B'] },
    ]);
  });

  it('flags rooms case-insensitively and ignores empty rooms', () => {
    const clashes = detectClashes([
      { classSectionId: 'A', dayOfWeek: 2, periodId: 'p1', teacherUserId: 't1', room: 'lab-1' },
      { classSectionId: 'B', dayOfWeek: 2, periodId: 'p1', teacherUserId: 't2', room: 'LAB-1 ' },
      { classSectionId: 'C', dayOfWeek: 2, periodId: 'p1', teacherUserId: 't3', room: ' ' },
      { classSectionId: 'D', dayOfWeek: 2, periodId: 'p1', teacherUserId: null, room: null },
    ]);
    expect(clashes).toHaveLength(1);
    expect(clashes[0]).toMatchObject({ kind: 'ROOM', key: 'LAB-1', classSectionIds: ['A', 'B'] });
  });

  it('does not flag the same section twice', () => {
    expect(
      detectClashes([
        { classSectionId: 'A', dayOfWeek: 3, periodId: 'p1', teacherUserId: 't1' },
        { classSectionId: 'A', dayOfWeek: 3, periodId: 'p1', teacherUserId: 't1' },
      ]),
    ).toEqual([]);
  });
});

describe('isoDayOfWeek', () => {
  it('maps Monday to 1 and Sunday to 7', () => {
    expect(isoDayOfWeek('2026-10-05')).toBe(1);
    expect(isoDayOfWeek('2026-10-11')).toBe(7);
  });
});

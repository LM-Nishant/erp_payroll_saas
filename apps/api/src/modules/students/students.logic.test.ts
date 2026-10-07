import { describe, expect, it } from 'vitest';
import { canTransitionAdmission, formatStudentNumber } from './students.logic';

describe('student/admission pure rules', () => {
  it('formats admission numbers with padding', () => {
    expect(formatStudentNumber('ABBS-2026-', 4, 7)).toBe('ABBS-2026-0007');
  });
  it('allows only configured admission status transitions', () => {
    expect(canTransitionAdmission('SUBMITTED', 'UNDER_REVIEW')).toBe(true);
    expect(canTransitionAdmission('APPROVED', 'ENROLLED')).toBe(true);
    expect(canTransitionAdmission('REJECTED', 'APPROVED')).toBe(false);
    expect(canTransitionAdmission('ENROLLED', 'REJECTED')).toBe(false);
  });
});

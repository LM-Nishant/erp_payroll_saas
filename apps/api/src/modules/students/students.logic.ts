export const ADMISSION_TRANSITIONS: Record<string, readonly string[]> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['UNDER_REVIEW', 'APPROVED', 'REJECTED', 'WAITLISTED'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED', 'WAITLISTED'],
  WAITLISTED: ['UNDER_REVIEW', 'APPROVED', 'REJECTED'],
  APPROVED: ['ENROLLED', 'REJECTED'],
  REJECTED: [],
  ENROLLED: [],
};
export function canTransitionAdmission(from: string, to: string): boolean {
  return ADMISSION_TRANSITIONS[from]?.includes(to) ?? false;
}
export function formatStudentNumber(prefix: string, padding: number, nextNumber: number): string {
  return `${prefix}${String(nextNumber).padStart(padding, '0')}`;
}

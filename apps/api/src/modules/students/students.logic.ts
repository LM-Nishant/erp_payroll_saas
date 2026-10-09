import { ADMISSION_TRANSITIONS, type AdmissionStatus } from '@erp/shared';

export { ADMISSION_TRANSITIONS };
export function canTransitionAdmission(from: string, to: string): boolean {
  return ADMISSION_TRANSITIONS[from as AdmissionStatus]?.includes(to as AdmissionStatus) ?? false;
}
export function formatStudentNumber(prefix: string, padding: number, nextNumber: number): string {
  return `${prefix}${String(nextNumber).padStart(padding, '0')}`;
}

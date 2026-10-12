/**
 * Students-side hooks implemented by other modules (registered at boot, so the students module
 * never imports them). The fees module provides the outstanding-dues lookup used before a
 * transfer certificate is issued.
 */

export interface StudentDues {
  /** Outstanding balance (rupees) of open invoices due on or before `asOf`. */
  amount: number;
  invoiceCount: number;
}

/** Returns null when dues cannot be checked (e.g. finance disabled for the institution). */
export type StudentDuesProvider = (args: {
  studentId: string;
  institutionId: string;
  asOf: string;
}) => Promise<StudentDues | null>;

let duesProvider: StudentDuesProvider | null = null;

export function registerStudentDuesProvider(fn: StudentDuesProvider) {
  duesProvider = fn;
}

export function getStudentDuesProvider(): StudentDuesProvider | null {
  return duesProvider;
}

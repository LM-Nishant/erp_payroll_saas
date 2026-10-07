/*
 * Library module constants and the fee-integration hook.
 *
 * Fee integration (soft dependency): the fees module, when present, calls
 * `registerLibraryFinePoster(fn)` from its registrations. Every new STUDENT fine is then handed
 * to `fn`, which should create a charge on the student's fee account and return its id. The
 * fine is stored with status POSTED + externalChargeId and is collected through fees. Without a
 * registered poster (or when it returns null / throws) fines stay PENDING in `library_fines`
 * and are collected or waived from the library desk.
 */

export const LIBRARY_EVENTS = {
  bookCreated: 'library.book_created',
  issued: 'library.issued',
  returned: 'library.returned',
  renewed: 'library.renewed',
  reserved: 'library.reserved',
  reservationReady: 'library.reservation_ready',
  fineAssessed: 'library.fine_assessed',
  fineSettled: 'library.fine_settled',
} as const;

export const LIBRARY_NOTIFICATIONS = {
  dueReminder: 'library.due_reminder',
  overdue: 'library.overdue',
  reservationReady: 'library.reservation_ready',
  fineAssessed: 'library.fine_assessed',
} as const;

export const LIBRARY_DAILY_JOB = 'library.daily_circulation';
export const LIBRARY_LABELS_TEMPLATE = 'library_labels';
export const LIBRARY_REPORT_TEMPLATE = 'library_report';
export const LIBRARY_BOOK_OWNER = 'library_book';

export interface LibraryFineCharge {
  fineId: string;
  organizationId: string;
  groupId: string | null;
  institutionId: string;
  studentId: string;
  amount: number;
  reason: string;
  description: string;
}

export type LibraryFinePoster = (
  charge: LibraryFineCharge,
) => Promise<{ externalChargeId: string } | null>;

let finePoster: LibraryFinePoster | null = null;

/** Called by the fees module (if installed) to post student library fines to fee accounts. */
export function registerLibraryFinePoster(poster: LibraryFinePoster | null): void {
  finePoster = poster;
}

export function getLibraryFinePoster(): LibraryFinePoster | null {
  return finePoster;
}

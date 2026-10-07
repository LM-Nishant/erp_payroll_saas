/**
 * Fees integration hook for transport & hostel charges.
 *
 * Transport and hostel always keep their own `transport_charges` / `hostel_charges` rows
 * (one per allocation per `YYYY-MM` period). When a fees module is present it registers a
 * poster here (e.g. from `fees.registrations.ts`):
 *
 *   registerStudentChargePoster((c) => feesService.createStudentCharge({ ... }));
 *
 * The poster returns the fee-side reference (stored as `externalRef`, charge → POSTED) or
 * null to leave the charge PENDING. Posting runs inside the caller's tenant context.
 */
export interface ExternalChargeInput {
  source: 'transport' | 'hostel';
  /** transport_charges.id / hostel_charges.id — use as the idempotency key. */
  sourceChargeId: string;
  studentId: string | null;
  employeeId: string | null;
  institutionId: string;
  period: string;
  amount: number;
  description: string;
}

export type StudentChargePoster = (charge: ExternalChargeInput) => Promise<string | null>;

let poster: StudentChargePoster | null = null;

export function registerStudentChargePoster(fn: StudentChargePoster | null): void {
  poster = fn;
}

export function hasStudentChargePoster(): boolean {
  return poster !== null;
}

/** Post a charge to the fees module when one is registered; returns its external reference. */
export async function postExternalCharge(charge: ExternalChargeInput): Promise<string | null> {
  if (!poster || !charge.studentId) return null;
  return poster(charge);
}

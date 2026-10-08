/**
 * Fees integration hook for transport & hostel charges.
 *
 * Transport and hostel always keep their own `transport_charges` / `hostel_charges` rows
 * (one per allocation per `YYYY-MM` period). When a fees module is present it registers a
 * poster here — `fees.registrations.ts` does, via `createStudentCharge` / `cancelStudentCharge`:
 *
 *   registerStudentChargePoster(postFn, cancelFn);
 *
 * The poster returns the fee-side reference (stored as `externalRef`, charge → POSTED) or
 * null to leave the charge PENDING. Waiving a POSTED charge calls the canceller so the fee
 * invoice is cancelled too. Both run inside the caller's tenant context.
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

export interface ExternalChargeCancelInput {
  source: 'transport' | 'hostel';
  sourceChargeId: string;
  studentId: string;
  reason: string;
}

export type StudentChargeCanceller = (charge: ExternalChargeCancelInput) => Promise<void>;

let poster: StudentChargePoster | null = null;
let canceller: StudentChargeCanceller | null = null;

export function registerStudentChargePoster(
  fn: StudentChargePoster | null,
  cancel: StudentChargeCanceller | null = null,
): void {
  poster = fn;
  canceller = fn ? cancel : null;
}

export function hasStudentChargePoster(): boolean {
  return poster !== null;
}

/** Post a charge to the fees module when one is registered; returns its external reference. */
export async function postExternalCharge(charge: ExternalChargeInput): Promise<string | null> {
  if (!poster || !charge.studentId) return null;
  return poster(charge);
}

/** Cancel the fee-side charge of a POSTED transport/hostel charge (no-op without a canceller). */
export async function cancelExternalCharge(charge: ExternalChargeCancelInput): Promise<void> {
  if (canceller) await canceller(charge);
}

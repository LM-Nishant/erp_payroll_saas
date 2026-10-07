import type { TransportTripStatus } from '@erp/shared';

/** Pure transport rules (unit-tested in transport.logic.test.ts). */

export interface FareSlabLike {
  minKm: number;
  maxKm: number;
  amount: number;
}

/**
 * Fare for a stop: an explicit stop fare wins; otherwise the slab whose (minKm, maxKm] range
 * contains the stop distance (a stop at exactly 0 km matches a slab starting at 0).
 */
export function fareForStop(
  stop: { fareAmount: number | null; distanceKm: number | null },
  slabs: FareSlabLike[],
): number | null {
  if (stop.fareAmount !== null) return stop.fareAmount;
  if (stop.distanceKm === null) return null;
  const d = stop.distanceKm;
  const slab = [...slabs]
    .sort((a, b) => a.minKm - b.minKm)
    .find((s) => (d > s.minKm || (d === 0 && s.minKm === 0)) && d <= s.maxKm);
  return slab ? slab.amount : null;
}

/** Seats left on a vehicle given the number of active allocations on its route(s). */
export function seatsLeft(capacity: number | null, activeAllocations: number): number | null {
  return capacity === null ? null : capacity - activeAllocations;
}

const TRIP_TRANSITIONS: Record<TransportTripStatus, TransportTripStatus[]> = {
  SCHEDULED: ['IN_PROGRESS', 'CANCELLED', 'COMPLETED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransitionTrip(from: TransportTripStatus, to: TransportTripStatus): boolean {
  return from === to || TRIP_TRANSITIONS[from].includes(to);
}

export interface ExpiryItem {
  kind: string;
  label: string;
  expiresOn: string;
  daysLeft: number;
}

/** Dates (YYYY-MM-DD) expiring within `withinDays` of `today` (already-expired included). */
export function dueExpiries(
  dates: { kind: string; label: string; date: string | null }[],
  today: string,
  withinDays: number,
): ExpiryItem[] {
  const t = Date.parse(`${today}T00:00:00Z`);
  const out: ExpiryItem[] = [];
  for (const d of dates) {
    if (!d.date) continue;
    const daysLeft = Math.round((Date.parse(`${d.date}T00:00:00Z`) - t) / 86_400_000);
    if (daysLeft <= withinDays) {
      out.push({ kind: d.kind, label: d.label, expiresOn: d.date, daysLeft });
    }
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}

/** Reminder thresholds: notify when exactly this many days are left (and on the day / overdue weekly). */
export const REMINDER_DAYS = [30, 15, 7, 1, 0] as const;

export function shouldRemind(daysLeft: number): boolean {
  return (
    (REMINDER_DAYS as readonly number[]).includes(daysLeft) || (daysLeft < 0 && daysLeft % 7 === 0)
  );
}

import type { HostelType, OutpassStatus } from '@erp/shared';

/** Pure hostel rules (unit-tested in hostel.logic.test.ts). */

/** BOYS hostels reject female students, GIRLS hostels reject male students. */
export function genderAllowed(hostelType: HostelType | string, gender: string | null | undefined) {
  const g = (gender ?? '').trim().toUpperCase();
  if (hostelType === 'BOYS') return g !== 'FEMALE' && g !== 'F';
  if (hostelType === 'GIRLS') return g !== 'MALE' && g !== 'M';
  return true;
}

/** STAFF hostels house employees only; BOYS/GIRLS house students only; MIXED accepts both. */
export function occupantAllowed(hostelType: HostelType | string, occupantType: string) {
  if (hostelType === 'STAFF') return occupantType === 'STAFF';
  if (hostelType === 'MIXED') return true;
  return occupantType === 'STUDENT';
}

const OUTPASS_TRANSITIONS: Record<OutpassStatus, OutpassStatus[]> = {
  PENDING: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['OUT', 'CANCELLED'],
  OUT: ['RETURNED'],
  REJECTED: [],
  CANCELLED: [],
  RETURNED: [],
};

export function canTransitionOutpass(from: OutpassStatus, to: OutpassStatus): boolean {
  return OUTPASS_TRANSITIONS[from].includes(to);
}

/** Bed labels for a room: A, B, C… (AA, AB… beyond 26). */
export function bedLabel(index: number): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return index < 26
    ? letters[index]!
    : `${letters[Math.floor(index / 26) - 1]!}${letters[index % 26]!}`;
}

/** Labels for beds to add when growing a room from `existing` labels to `capacity` beds. */
export function newBedLabels(existing: string[], capacity: number): string[] {
  const taken = new Set(existing);
  const out: string[] = [];
  for (let i = 0; out.length + existing.length < capacity && i < 1000; i++) {
    const l = bedLabel(i);
    if (!taken.has(l)) out.push(l);
  }
  return out;
}

export function occupancyPercent(occupied: number, beds: number): number {
  return beds ? Math.round((occupied / beds) * 1000) / 10 : 0;
}

/** Monthly hostel charge: rent + mess fee. */
export function monthlyHostelCharge(rent: number, messFee: number | null | undefined) {
  const mess = messFee ?? 0;
  return { rentAmount: rent, messAmount: mess, amount: Math.round((rent + mess) * 100) / 100 };
}

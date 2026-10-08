import { describe, expect, it } from 'vitest';
import {
  bedLabel,
  canTransitionOutpass,
  genderAllowed,
  monthlyHostelCharge,
  newBedLabels,
  occupancyPercent,
  occupantAllowed,
} from './hostel.logic';

describe('genderAllowed / occupantAllowed', () => {
  it('enforces boys/girls hostels', () => {
    expect(genderAllowed('BOYS', 'MALE')).toBe(true);
    expect(genderAllowed('BOYS', 'FEMALE')).toBe(false);
    expect(genderAllowed('GIRLS', 'male')).toBe(false);
    expect(genderAllowed('GIRLS', 'F')).toBe(true);
    expect(genderAllowed('MIXED', 'FEMALE')).toBe(true);
    expect(genderAllowed('BOYS', null)).toBe(true);
  });
  it('separates staff and student hostels', () => {
    expect(occupantAllowed('STAFF', 'STAFF')).toBe(true);
    expect(occupantAllowed('STAFF', 'STUDENT')).toBe(false);
    expect(occupantAllowed('BOYS', 'STAFF')).toBe(false);
    expect(occupantAllowed('MIXED', 'STAFF')).toBe(true);
  });
});

describe('canTransitionOutpass', () => {
  it('follows the out-pass lifecycle', () => {
    expect(canTransitionOutpass('PENDING', 'APPROVED')).toBe(true);
    expect(canTransitionOutpass('APPROVED', 'OUT')).toBe(true);
    expect(canTransitionOutpass('OUT', 'RETURNED')).toBe(true);
    expect(canTransitionOutpass('PENDING', 'OUT')).toBe(false);
    expect(canTransitionOutpass('REJECTED', 'APPROVED')).toBe(false);
  });
});

describe('bed labels', () => {
  it('labels beds A..Z then AA..', () => {
    expect(bedLabel(0)).toBe('A');
    expect(bedLabel(25)).toBe('Z');
    expect(bedLabel(26)).toBe('AA');
  });
  it('fills gaps when growing a room', () => {
    expect(newBedLabels([], 3)).toEqual(['A', 'B', 'C']);
    expect(newBedLabels(['A', 'C'], 4)).toEqual(['B', 'D']);
    expect(newBedLabels(['A', 'B'], 2)).toEqual([]);
  });
});

describe('occupancy & charges', () => {
  it('computes occupancy percent with one decimal', () => {
    expect(occupancyPercent(0, 0)).toBe(0);
    expect(occupancyPercent(2, 3)).toBe(66.7);
  });
  it('adds rent and mess fee', () => {
    expect(monthlyHostelCharge(3000, 2500.5)).toEqual({
      rentAmount: 3000,
      messAmount: 2500.5,
      amount: 5500.5,
    });
    expect(monthlyHostelCharge(3000, null).amount).toBe(3000);
  });
});

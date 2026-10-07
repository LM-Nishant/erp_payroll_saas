import { describe, expect, it } from 'vitest';
import {
  canTransitionTrip,
  dueExpiries,
  fareForStop,
  seatsLeft,
  shouldRemind,
} from './transport.logic';

const slabs = [
  { minKm: 0, maxKm: 5, amount: 800 },
  { minKm: 5, maxKm: 10, amount: 1200 },
  { minKm: 10, maxKm: 20, amount: 1600 },
];

describe('fareForStop', () => {
  it('prefers an explicit stop fare', () => {
    expect(fareForStop({ fareAmount: 999, distanceKm: 7 }, slabs)).toBe(999);
  });
  it('picks the slab containing the distance (upper bound inclusive)', () => {
    expect(fareForStop({ fareAmount: null, distanceKm: 0 }, slabs)).toBe(800);
    expect(fareForStop({ fareAmount: null, distanceKm: 5 }, slabs)).toBe(800);
    expect(fareForStop({ fareAmount: null, distanceKm: 5.1 }, slabs)).toBe(1200);
    expect(fareForStop({ fareAmount: null, distanceKm: 20 }, slabs)).toBe(1600);
  });
  it('returns null without distance or matching slab', () => {
    expect(fareForStop({ fareAmount: null, distanceKm: null }, slabs)).toBeNull();
    expect(fareForStop({ fareAmount: null, distanceKm: 25 }, slabs)).toBeNull();
  });
});

describe('seatsLeft', () => {
  it('computes remaining seats', () => {
    expect(seatsLeft(40, 38)).toBe(2);
    expect(seatsLeft(null, 10)).toBeNull();
  });
});

describe('canTransitionTrip', () => {
  it('allows forward transitions only', () => {
    expect(canTransitionTrip('SCHEDULED', 'IN_PROGRESS')).toBe(true);
    expect(canTransitionTrip('IN_PROGRESS', 'COMPLETED')).toBe(true);
    expect(canTransitionTrip('COMPLETED', 'IN_PROGRESS')).toBe(false);
    expect(canTransitionTrip('CANCELLED', 'SCHEDULED')).toBe(false);
  });
});

describe('dueExpiries / shouldRemind', () => {
  it('lists items expiring within the window sorted by urgency', () => {
    const out = dueExpiries(
      [
        { kind: 'insurance', label: 'KA01', date: '2026-01-20' },
        { kind: 'fitness', label: 'KA01', date: '2026-01-05' },
        { kind: 'permit', label: 'KA01', date: '2026-06-01' },
        { kind: 'puc', label: 'KA01', date: null },
      ],
      '2026-01-10',
      30,
    );
    expect(out.map((o) => [o.kind, o.daysLeft])).toEqual([
      ['fitness', -5],
      ['insurance', 10],
    ]);
  });
  it('reminds on threshold days and weekly when overdue', () => {
    expect(shouldRemind(30)).toBe(true);
    expect(shouldRemind(29)).toBe(false);
    expect(shouldRemind(0)).toBe(true);
    expect(shouldRemind(-7)).toBe(true);
    expect(shouldRemind(-3)).toBe(false);
  });
});

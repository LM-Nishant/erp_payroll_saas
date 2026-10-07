import { describe, expect, it } from 'vitest';
import { nextOccurrence } from './employees.highlights';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('nextOccurrence', () => {
  it('returns this year when the day is still ahead and inside the window', () => {
    expect(nextOccurrence(d('1990-10-20'), '2026-10-07', '2026-11-06')).toBe('2026-10-20');
    expect(nextOccurrence(d('2021-10-07'), '2026-10-07', '2026-11-06')).toBe('2026-10-07');
  });
  it('rolls into next year across the year end', () => {
    expect(nextOccurrence(d('1995-01-03'), '2026-12-20', '2027-01-19')).toBe('2027-01-03');
  });
  it('returns null outside the window', () => {
    expect(nextOccurrence(d('1990-10-01'), '2026-10-07', '2026-11-06')).toBeNull();
    expect(nextOccurrence(d('1990-12-25'), '2026-10-07', '2026-11-06')).toBeNull();
  });
  it('celebrates 29 Feb on 28 Feb in non-leap years', () => {
    expect(nextOccurrence(d('2000-02-29'), '2027-02-20', '2027-03-20')).toBe('2027-02-28');
  });
});

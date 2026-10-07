import { describe, expect, it } from 'vitest';
import { conditionsMatch } from './conditions';

describe('workflow conditions', () => {
  const ctx = { amount: 60000, days: '3', type: 'casual', employee: { grade: 'A' } };

  it('compares numbers (also numeric strings)', () => {
    expect(conditionsMatch([{ field: 'amount', op: 'gt', value: 50000 }], ctx)).toBe(true);
    expect(conditionsMatch([{ field: 'amount', op: 'lte', value: 50000 }], ctx)).toBe(false);
    expect(conditionsMatch([{ field: 'days', op: 'gte', value: 3 }], ctx)).toBe(true);
  });

  it('supports eq / neq / in / not_in / exists and nested paths (AND)', () => {
    expect(
      conditionsMatch(
        [
          { field: 'type', op: 'in', value: ['casual', 'sick'] },
          { field: 'employee.grade', op: 'eq', value: 'A' },
          { field: 'missing', op: 'neq', value: 'x' },
        ],
        ctx,
      ),
    ).toBe(true);
    expect(conditionsMatch([{ field: 'type', op: 'not_in', value: ['casual'] }], ctx)).toBe(false);
    expect(conditionsMatch([{ field: 'missing', op: 'exists' }], ctx)).toBe(false);
    expect(conditionsMatch([{ field: 'missing', op: 'gt', value: 1 }], ctx)).toBe(false);
    expect(conditionsMatch([], ctx)).toBe(true);
  });
});

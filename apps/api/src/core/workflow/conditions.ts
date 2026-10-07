import type { WorkflowConditionInput } from '@erp/shared';
import { lookup } from '../communication/renderer';

function compare(a: unknown, b: unknown): number | null {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const na = Number(a);
  const nb = Number(b);
  if (a !== '' && b !== '' && Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b);
  return null;
}

/** All conditions must hold (AND). Unknown fields are `undefined` (only `exists` / `neq` pass). */
export function conditionsMatch(
  conditions: WorkflowConditionInput[],
  context: Record<string, unknown>,
): boolean {
  return conditions.every((c) => {
    const value = lookup(context, c.field);
    switch (c.op) {
      case 'exists':
        return value !== undefined && value !== null;
      case 'eq':
        return value === c.value || (compare(value, c.value) ?? 1) === 0;
      case 'neq':
        return !(value === c.value || (compare(value, c.value) ?? 1) === 0);
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte': {
        const d = compare(value, c.value);
        if (d === null) return false;
        return c.op === 'gt' ? d > 0 : c.op === 'gte' ? d >= 0 : c.op === 'lt' ? d < 0 : d <= 0;
      }
      case 'in':
        return Array.isArray(c.value) && c.value.includes(String(value));
      case 'not_in':
        return Array.isArray(c.value) && !c.value.includes(String(value));
      default:
        return false;
    }
  });
}

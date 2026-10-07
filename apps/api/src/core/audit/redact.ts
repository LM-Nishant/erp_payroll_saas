/** Keys whose values must never be written to the audit log. */
const SENSITIVE_KEY =
  /pass(word|wd|phrase)?$|password|hash|secret|token|api_?key|otp|recovery_?code|private_?key|credential|salt|^pin$|cvv|bank_?account/i;

export const REDACTED = '[REDACTED]';

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

/** JSON-safe deep copy with sensitive keys replaced by "[REDACTED]". */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (depth > 8) return '[TRUNCATED]';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    // Prisma Decimal & similar value objects.
    if ('toJSON' in value && typeof (value as { toJSON: unknown }).toJSON === 'function') {
      return redact((value as { toJSON: () => unknown }).toJSON(), depth + 1);
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      out[k] = isSensitiveKey(k) ? REDACTED : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

const IGNORED_DIFF_KEYS = new Set(['updatedAt']);

/**
 * Before/after diff for updates: only keys whose (redacted) values changed are kept.
 * For creates (no before) / deletes (no after) the full redacted snapshot is kept.
 */
export function auditDiff(before: unknown, after: unknown): { before: unknown; after: unknown } {
  const b = redact(before);
  const a = redact(after);
  const isObj = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);
  if (!isObj(b) || !isObj(a)) return { before: b ?? null, after: a ?? null };
  const changedBefore: Record<string, unknown> = {};
  const changedAfter: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (IGNORED_DIFF_KEYS.has(key)) continue;
    if (JSON.stringify(b[key]) !== JSON.stringify(a[key])) {
      changedBefore[key] = b[key] ?? null;
      changedAfter[key] = a[key] ?? null;
    }
  }
  return { before: changedBefore, after: changedAfter };
}

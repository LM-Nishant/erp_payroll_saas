/*
 * PII redaction for AI prompts. Applied to everything persisted in `ai_usage_logs` and — when the
 * organization has not enabled data sharing — to everything sent to an external provider.
 */

const RULES: ReadonlyArray<{ pattern: RegExp; replacement: string }> = [
  // API keys / bearer tokens that a user might paste.
  { pattern: /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{12,}\b/g, replacement: '[SECRET]' },
  { pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/gi, replacement: 'Bearer [SECRET]' },
  { pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, replacement: '[EMAIL]' },
  {
    pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    replacement: '[ID]',
  },
  // Indian PAN (ABCDE1234F).
  { pattern: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g, replacement: '[PAN]' },
  // Aadhaar (12 digits, optionally grouped 4-4-4).
  { pattern: /\b[2-9][0-9]{3}[ -]?[0-9]{4}[ -]?[0-9]{4}\b/g, replacement: '[AADHAAR]' },
  // Phone numbers: optional country code, 10–12 digits with single space/dash separators.
  {
    pattern: /(?<![\w+])(?:\+\d{1,3}[ -]?)?(?:\(\d{2,5}\)[ -]?)?\d(?:[ -]?\d){9,11}(?![\w])/g,
    replacement: '[PHONE]',
  },
  // Remaining long digit runs (bank accounts, card numbers, ids).
  { pattern: /\b\d{9,18}\b/g, replacement: '[NUMBER]' },
];

/** Replace emails, phone numbers, government ids, account numbers and tokens with placeholders. */
export function redactPii(text: string): string {
  let out = text;
  for (const rule of RULES) out = out.replace(rule.pattern, rule.replacement);
  return out;
}

/** Truncate to `max` characters (with an ellipsis marker). */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

/** What gets stored in `ai_usage_logs.prompt_redacted`. */
export function promptPreview(text: string, max = 1000): string {
  return truncate(redactPii(text).replace(/\s+/g, ' ').trim(), max);
}

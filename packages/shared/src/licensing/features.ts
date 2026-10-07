/**
 * Module licensing catalog (spec §63/§64) — the single source of truth for feature keys and
 * plan limit keys, shared by the API (enforcement) and the web app (menus).
 *
 * Later layers ADD keys here; never rename or reuse a key.
 */
export const FEATURES = {
  education: 'Academic structure, students, classes and exams',
  hr: 'HR employee master, attendance and leave',
  payroll: 'Payroll processing, payslips and statutory reports',
  assets: 'Asset management and assignment',
  transport: 'Transport routes and vehicles',
  hostel: 'Hostel management',
  library: 'Library management',
  finance: 'Fees and finance',
  documents: 'Document management',
  communication: 'Communication engine (announcements, templates)',
  email: 'Email delivery',
  sms: 'SMS delivery',
  whatsapp: 'WhatsApp delivery',
  ai: 'AI assistants and the AI gateway',
} as const satisfies Record<string, string>;

export type FeatureKey = keyof typeof FEATURES;
export const FEATURE_KEYS = Object.keys(FEATURES) as FeatureKey[];

/**
 * A feature is only effective when every feature it depends on is effective at the same
 * scope (e.g. payroll needs the HR employee master).
 */
export const FEATURE_DEPENDENCIES: Partial<Record<FeatureKey, readonly FeatureKey[]>> = {
  payroll: ['hr'],
  email: ['communication'],
  sms: ['communication'],
  whatsapp: ['communication'],
};

export function isFeatureKey(value: string): value is FeatureKey {
  return Object.prototype.hasOwnProperty.call(FEATURES, value);
}

/**
 * Plan limits. `gauge` limits cap a current count (institutions, students…); `monthly` limits
 * cap consumption within a calendar month (UTC) and reset automatically.
 */
export const LIMITS = {
  institutions: { label: 'Institutions', period: 'gauge' },
  students: { label: 'Students', period: 'gauge' },
  employees: { label: 'Employees', period: 'gauge' },
  storage_bytes: { label: 'Storage (bytes)', period: 'gauge' },
  ai_tokens: { label: 'AI tokens per month', period: 'monthly' },
  communication_messages: { label: 'Messages per month', period: 'monthly' },
} as const satisfies Record<string, { label: string; period: 'gauge' | 'monthly' }>;

export type LimitKey = keyof typeof LIMITS;
export const LIMIT_KEYS = Object.keys(LIMITS) as LimitKey[];

/** `null` = unlimited. Missing key = 0 (not included in the plan). */
export type PlanLimits = Partial<Record<LimitKey, number | null>>;

export function isLimitKey(value: string): value is LimitKey {
  return Object.prototype.hasOwnProperty.call(LIMITS, value);
}

export const SUBSCRIPTION_STATUSES = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const INVOICE_STATUSES = [
  'DRAFT',
  'OPEN',
  'PAYMENT_SUBMITTED',
  'PAID',
  'OVERDUE',
  'VOID',
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** Hierarchy levels that can carry feature overrides, branding and secrets. */
export const SETTING_SCOPE_TYPES = ['ORGANIZATION', 'GROUP', 'INSTITUTION'] as const;
export type SettingScopeType = (typeof SETTING_SCOPE_TYPES)[number];

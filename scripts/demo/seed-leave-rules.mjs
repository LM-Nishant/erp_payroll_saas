#!/usr/bin/env node
/**
 * Demo seed for leave policy rules (HTTP API based, idempotent).
 *
 *   API_URL=http://127.0.0.1:3100 node scripts/demo/seed-leave-rules.mjs
 *
 * Logicmines: Casual Leave (CL) in every ACTIVE leave policy gets
 *   - notice: 5 days in advance for 1–2 day leave, 10 days for 3+ days (notice tiers)
 *   - sandwich: weekly offs + holidays counted, only when the leave is 3+ working days
 * When no active policy exists yet, an organization-default policy is created with CL 12/yr.
 * Configure the same by hand: HR → Leave setup → Policies → edit → CL row → Advanced rules.
 */
const API = (process.env.API_URL ?? 'http://127.0.0.1:3100').replace(/\/+$/, '');
const ORG = 'logicmines';
const LOGINS = [
  { email: 'hr@logicmines.in', password: 'Logicmines@2026' },
  { email: 'nchoudhary@logicmines.in', password: 'Logicmines@123' },
];
const CL_RULES = {
  sandwichMode: 'BOTH',
  sandwichMinDays: 3,
  noticeTiers: [
    { minDays: 1, noticeDays: 5 },
    { minDays: 3, noticeDays: 10 },
  ],
};
const RULE_KEYS = [
  'leaveTypeId',
  'accrualFrequency',
  'annualQuota',
  'proRataOnJoining',
  'maxCarryForward',
  'sandwichMode',
  'sandwichMinDays',
  'sandwichAdjacent',
  'minNoticeDays',
  'noticeTiers',
  'maxAdvanceDays',
  'allowBackdated',
  'backdatedMaxDays',
  'minDaysPerRequest',
  'maxConsecutiveDays',
  'maxRequestsPerMonth',
  'maxDaysPerMonth',
  'notClubbableWith',
];

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(
      `${method} ${path} → ${res.status} ${json?.error?.code ?? ''} ${json?.error?.message ?? ''}`,
    );
    err.status = res.status;
    throw err;
  }
  return json;
}

/** First demo login that can manage leave (HR, else the owner). */
async function login() {
  for (const l of LOGINS) {
    try {
      const res = await call('POST', '/api/v1/auth/login', { body: { ...l, organization: ORG } });
      const token = res.data.accessToken;
      if (!token) continue;
      const api = (method, path, body) => call(method, path, { token, body });
      await api('GET', '/api/v1/leave/policies');
      console.log(`[${ORG}] signed in as ${l.email}`);
      return api;
    } catch (e) {
      console.warn(`[${ORG}] ${l.email}: ${e.message}`);
    }
  }
  throw new Error('No demo login with leave.manage worked');
}

const pick = (rule) => Object.fromEntries(RULE_KEYS.map((k) => [k, rule[k] ?? null]));
const same = (rule) =>
  rule.sandwichMode === CL_RULES.sandwichMode &&
  Number(rule.sandwichMinDays) === CL_RULES.sandwichMinDays &&
  JSON.stringify(rule.noticeTiers ?? []) === JSON.stringify(CL_RULES.noticeTiers);

async function main() {
  const api = await login();
  const types = (await api('GET', '/api/v1/leave/types?includeInactive=true')).data;
  const cl = types.find((t) => t.code === 'CL');
  if (!cl) throw new Error(`[${ORG}] leave type CL not found — create it in Leave setup first`);

  const policies = (await api('GET', '/api/v1/leave/policies')).data.filter(
    (p) => p.status === 'ACTIVE',
  );
  if (!policies.length) {
    await api('POST', '/api/v1/leave/policies', {
      name: 'Organization default',
      rules: [
        {
          leaveTypeId: cl.id,
          accrualFrequency: 'MONTHLY',
          annualQuota: 12,
          proRataOnJoining: true,
          ...CL_RULES,
        },
      ],
    });
    console.log(`[${ORG}] created the organization-default policy with CL rules`);
    return;
  }
  for (const p of policies) {
    const clRule = p.rules.find((r) => r.leaveTypeId === cl.id);
    if (clRule && same(clRule)) {
      console.log(`[${ORG}] ${p.name}: CL rules already set`);
      continue;
    }
    const rules = p.rules.map((r) =>
      r.leaveTypeId === cl.id ? { ...pick(r), ...CL_RULES } : pick(r),
    );
    if (!clRule) {
      rules.push({
        ...pick({ leaveTypeId: cl.id, accrualFrequency: 'MONTHLY', annualQuota: 12 }),
        proRataOnJoining: true,
        ...CL_RULES,
      });
    }
    await api('PATCH', `/api/v1/leave/policies/${p.id}`, { rules });
    console.log(`[${ORG}] ${p.name}: CL → notice 5d (1–2 days) / 10d (3+ days), sandwich BOTH ≥3d`);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

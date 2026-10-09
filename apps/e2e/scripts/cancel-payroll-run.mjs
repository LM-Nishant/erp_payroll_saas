#!/usr/bin/env node
/**
 * Recovery helper for an interrupted payroll e2e flow (tests/modules/payroll.spec.ts).
 *
 * The flow creates a Greenwood run for the month two months back and normally finishes by
 * reopening + cancelling it. If a run was interrupted, the next run cannot create a run for the
 * same period. This cancels the leftover run through the API (DRAFT / COMPUTED are cancelled
 * directly; FINALIZED is reopened by group finance first, then the new revision is cancelled).
 *
 *   node apps/e2e/scripts/cancel-payroll-run.mjs [YYYY-MM]
 */
const API = (process.env.E2E_API_URL ?? 'http://localhost:3100') + '/api/v1';
const PASSWORD = process.env.E2E_PASSWORD ?? 'password123';

const period =
  process.argv[2] ??
  (() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 2);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();

async function as(email) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login ${email}: ${res.status} ${await res.text()}`);
  const token = (await res.json()).data.accessToken;
  return async (method, path, body) => {
    const r = await fetch(API + path, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(json.error)}`);
    return json.data;
  };
}

const payroll = await as('payroll@greenwood.demo');
const runs = await payroll('GET', '/payroll/runs?pageSize=100');
const open = runs.filter(
  (r) =>
    r.periodStart.slice(0, 7) === period &&
    /^E2E run /.test(r.label ?? '') &&
    !['CANCELLED', 'REOPENED'].includes(r.status),
);
if (!open.length) console.log(`No open e2e payroll run for ${period}.`);
for (const run of open) {
  let id = run.id;
  if (run.status === 'FINALIZED') {
    const finance = await as('group.finance@greenwood.demo');
    id = (await finance('POST', `/payroll/runs/${id}/reopen`, { reason: 'e2e cleanup' })).id;
  } else if (!['DRAFT', 'COMPUTED'].includes(run.status)) {
    console.log(`${run.label} is ${run.status}: approve/finalize it in the UI, then re-run this.`);
    continue;
  }
  await payroll('POST', `/payroll/runs/${id}/cancel`);
  console.log(`Cancelled ${run.label} (${period}).`);
}

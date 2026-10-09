#!/usr/bin/env node
/**
 * Demo environment seed — one command builds a complete, licence-matrix demo through the
 * public API (validation, limits, workflows and audit all apply).
 *
 *   node scripts/demo/seed-demo.mjs --reset      # back up + wipe the dev DB, then seed
 *   pnpm demo:seed -- --reset                    # same, via the root package script
 *
 * Flags:
 *   --reset         mysqldump backup to ~/erp-backups, TRUNCATE all tenant data, re-sync the
 *                   permission catalog and recreate the platform admins (scripts/demo/db-admin.ts)
 *   --skip-backup   with --reset: skip the mysqldump backup
 *
 * Environment:
 *   API_URL         API base (default http://localhost:3100) — the API must be running
 *   WEB_URL         web app URL written to the docs (default http://localhost:5180)
 *   DATABASE_URL    MySQL URL used for the backup/reset (default: apps/api/.env)
 *   DEMO_PASSWORD   password given to every demo user (default password123)
 *   DEMO_TODAY      pretend "today" (YYYY-MM-DD) for attendance/payroll dates
 *   BACKUP_DIR      backup directory (default ~/erp-backups)
 *
 * Outputs scripts/demo/demo-manifest.json and docs/DEMO_ACCOUNTS.md.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { seedGreenwood } from './demo-seed/greenwood.mjs';
import {
  DEMO_PASSWORD,
  ROOT,
  SUPERADMIN,
  SUPPORT,
  all,
  dbAdmin,
  login,
  session,
  stats,
  step,
  warn,
  warnings,
} from './demo-seed/lib.mjs';
import {
  createOrg,
  seedAcme,
  seedBrightway,
  seedStatusOrgs,
  seedSunrise,
} from './demo-seed/orgs.mjs';
import { describeOrg, writeAccountsDoc, writeManifest } from './demo-seed/report.mjs';

const args = new Set(process.argv.slice(2));
const started = Date.now();
const log = (msg) =>
  console.log(`[${((Date.now() - started) / 1000).toFixed(0).padStart(4)}s] ${msg}`);

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = fs.readFileSync(path.join(ROOT, 'apps/api/.env'), 'utf8');
  const m = env.match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);
  if (!m) throw new Error('DATABASE_URL not set and not found in apps/api/.env');
  return m[1];
}

function backup() {
  const url = new URL(databaseUrl());
  const db = url.pathname.replace(/^\//, '');
  const dir = process.env.BACKUP_DIR ?? path.join(os.homedir(), 'erp-backups');
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(dir, `${db}-${ts}.sql.gz`);
  const r = spawnSync(
    'sh',
    [
      '-c',
      `mysqldump -h"$H" -P"$P" -u"$U" --single-transaction --routines --no-tablespaces "$D" | gzip > "$F"`,
    ],
    {
      env: {
        ...process.env,
        H: url.hostname,
        P: url.port || '3306',
        U: decodeURIComponent(url.username),
        D: db,
        F: file,
        MYSQL_PWD: decodeURIComponent(url.password),
      },
      encoding: 'utf8',
    },
  );
  if (r.status !== 0) throw new Error(`Backup failed: ${r.stderr}`);
  return file;
}

async function verifyLogins(users) {
  const out = [];
  for (const u of users) {
    try {
      const auth = await login(u.email, DEMO_PASSWORD);
      const api = session(async () => auth.accessToken, u.email);
      const me = (await api('GET', '/me')).data;
      out.push({ u, ok: true, me, api });
    } catch (e) {
      out.push({ u, ok: false, error: e.message });
    }
  }
  return out;
}

async function check(name, as, apiFn, method, p, expected) {
  let actual;
  try {
    await apiFn(method, p);
    actual = '200';
  } catch (e) {
    actual = `${e.status} ${e.code ?? ''}`.trim();
  }
  const pass = expected === '200' ? actual === '200' : actual.startsWith(expected);
  return { name, as, method, path: p, expected, actual, pass };
}

async function main() {
  const platformApi = session(
    async () => (await login(SUPERADMIN, DEMO_PASSWORD)).accessToken,
    '[platform]',
  );
  if (args.has('--reset')) {
    if (!args.has('--skip-backup')) log(`Backup written to ${backup()}`);
    log(`Reset: ${dbAdmin('reset')}`);
  } else {
    const orgs = await all(platformApi, '/platform/organizations');
    if (orgs.length) {
      log(
        `${orgs.length} organization(s) already exist — continuing idempotently (use --reset for a clean slate).`,
      );
    }
  }
  const plans = await all(platformApi, '/platform/plans');

  log('Greenwood International School (enterprise, every module)…');
  const greenwood = await createOrg(platformApi, plans, {
    name: 'Greenwood International School',
    slug: 'greenwood',
    domain: 'greenwood.demo',
    kind: 'EDUCATION',
    plan: 'enterprise',
    status: 'ACTIVE',
    ownerName: 'Meera Kapoor',
    ownerRole: 'group_owner',
    caseNote:
      'Enterprise plan: every module licensed and populated. Group "Greenwood Education Trust" with the main school and the Whitefield branch.',
  });
  await seedGreenwood(greenwood);
  log('Sunrise Starter School (starter)…');
  const sunrise = await seedSunrise(platformApi, plans);
  log('Acme Technologies (company, HR + payroll add-ons)…');
  const acme = await seedAcme(platformApi, plans);
  log('Brightway Education Group (professional + whatsapp, institution override)…');
  const brightway = await seedBrightway(platformApi, plans);
  log('Subscription-status organizations (past due, cancelled, trial)…');
  const statusOrgs = await seedStatusOrgs(platformApi, plans);
  const contexts = [greenwood, sunrise, acme, brightway, ...statusOrgs];

  log(`Finalize passwords: ${dbAdmin('finalize')}`);

  const orgs = [];
  for (const ctx of contexts) {
    const o = await step(`describe ${ctx.slug}`, () => describeOrg(ctx));
    if (o) orgs.push(o);
  }

  const tenantUsers = contexts.flatMap((c) => c.users);
  const all_ = [
    {
      email: SUPERADMIN,
      name: 'Platform Super Admin',
      orgSlug: null,
      roleKey: 'platform_super_admin',
      roles: [{ key: 'platform_super_admin', scope: 'PLATFORM', scopeName: 'Platform' }],
      institution: null,
      persona: 'SaaS operator — onboard organizations, plans, subscriptions, billing',
      linkedTo: null,
    },
    {
      email: SUPPORT,
      name: 'Platform Support Admin',
      orgSlug: null,
      roleKey: 'platform_support_admin',
      roles: [{ key: 'platform_support_admin', scope: 'PLATFORM', scopeName: 'Platform' }],
      institution: null,
      persona: 'Support desk — read-only organization view and tenant access',
      linkedTo: null,
    },
    ...tenantUsers,
  ];
  log(`Verifying ${all_.length} logins with the demo password (auth is rate limited)…`);
  const results = await verifyLogins(all_);
  const failed = results.filter((r) => !r.ok);
  const menus = JSON.parse(
    dbAdmin(
      'menus',
      JSON.stringify(results.filter((r) => r.ok).map((r) => ({ email: r.u.email, me: r.me }))),
    ),
  );
  const menuBy = new Map(menus.map((m) => [m.email, m]));
  const users = results.map(({ u, ok, me, error }) => ({
    email: u.email,
    password: DEMO_PASSWORD,
    name: u.name,
    org: u.orgSlug,
    roleKey: u.roleKey,
    roles: u.roles,
    institution: u.institution,
    linkedTo: u.linkedTo,
    persona: u.persona,
    loginOk: ok,
    ...(ok
      ? {
          features: me.features ?? [],
          permissionsCount: me.permissions?.length ?? 0,
          workspaces: menuBy.get(u.email)?.workspaces ?? [],
          menus: menuBy.get(u.email)?.menus ?? {},
        }
      : { error }),
  }));

  const sessionOf = (email) => results.find((r) => r.u.email === email && r.ok)?.api;
  const bwSouth = brightway.institutions.find((i) => i.code === 'BW-S');
  const checks = [];
  const spot = async (name, email, method, p, expected) => {
    const api = sessionOf(email);
    if (api) checks.push(await check(name, email, api, method, p, expected));
    else warn(`spot-check "${name}": no session for ${email}`);
  };
  await spot('Starter plan blocks HR', 'hr@sunrise.demo', 'GET', '/employees', '403');
  await spot(
    'Starter plan blocks payroll',
    'principal@sunrise.demo',
    'GET',
    '/payroll/runs',
    '403',
  );
  await spot('Starter plan allows academics', 'principal@sunrise.demo', 'GET', '/students', '200');
  await spot('Company org has no education', 'hr@acme.demo', 'GET', '/students', '403');
  await spot('Company org HR add-on works', 'hr@acme.demo', 'GET', '/employees', '200');
  await spot(
    'Company org payroll add-on works',
    'payroll@acme.demo',
    'GET',
    '/payroll/runs',
    '200',
  );
  await spot(
    'Org override disables communication',
    'owner@acme.demo',
    'GET',
    '/communication/templates',
    '403',
  );
  await spot('Enterprise allows payroll', 'payroll@greenwood.demo', 'GET', '/payroll/runs', '200');
  await spot('Enterprise allows hostel', 'hostel@greenwood.demo', 'GET', '/hostel/rooms', '200');
  if (bwSouth) {
    const states = await step(
      'brightway south effective features',
      async () =>
        (
          await sessionOf('admin@brightway.demo')(
            'GET',
            `/features/effective?institutionId=${bwSouth.id}`,
          )
        ).data.features,
    );
    const hostel = states?.find((f) => f.key === 'hostel');
    checks.push({
      name: 'Effective features at Brightway South show hostel disabled by override',
      as: 'admin@brightway.demo',
      method: 'GET',
      path: `/features/effective?institutionId=${bwSouth.id}`,
      expected: 'hostel disabled (INSTITUTION)',
      actual: hostel
        ? `hostel ${hostel.enabled ? 'enabled' : 'disabled'} (${hostel.source})`
        : 'n/a',
      pass: hostel?.enabled === false,
    });
    await spot(
      'Institution override disables hostel at Brightway South',
      'south.hostel@brightway.demo',
      'GET',
      `/hostel/dashboard?institutionId=${bwSouth.id}`,
      '403',
    );
  }
  await spot(
    'Hostel still enabled at Brightway North',
    'north.hostel@brightway.demo',
    'GET',
    '/hostel/rooms',
    '200',
  );
  await spot(
    'Cancelled subscription blocks modules',
    'owner@oldtown.demo',
    'GET',
    '/students',
    '403',
  );
  await spot(
    'Past-due subscription keeps modules',
    'owner@lakeside.demo',
    'GET',
    '/students',
    '200',
  );
  await spot(
    'Trial subscription grants professional modules',
    'owner@maple.demo',
    'GET',
    '/employees',
    '200',
  );

  const data = { orgs, users, checks };
  const outputs = [writeManifest(data), writeAccountsDoc(data)];
  spawnSync('pnpm', ['exec', 'prettier', '--write', '--log-level', 'warn', ...outputs], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  for (const f of outputs) log(`Wrote ${path.relative(ROOT, f)}`);

  console.log('\nCreated:', JSON.stringify(stats));
  console.log(`\nLogins: ${results.length - failed.length}/${results.length} OK`);
  for (const f of failed) console.log(`  FAIL ${f.u.email}: ${f.error}`);
  console.log('\nLicence checks:');
  for (const c of checks) {
    console.log(
      `  ${c.pass ? 'PASS' : 'FAIL'} ${c.name} — ${c.as} ${c.path} → ${c.actual} (expected ${c.expected})`,
    );
  }
  if (warnings.length) {
    console.log(`\n${warnings.length} warning(s):`);
    for (const w of warnings) console.log(`  - ${w}`);
  }
  if (failed.length || checks.some((c) => !c.pass)) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

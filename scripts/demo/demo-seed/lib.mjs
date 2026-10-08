// Shared helpers for the demo seed (scripts/demo/seed-demo.mjs).
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const API_URL = (process.env.API_URL ?? 'http://localhost:3100').replace(/\/$/, '');
export const API = `${API_URL}/api/v1`;
export const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'password123';
/** Policy-compliant password used while seeding; replaced by DEMO_PASSWORD at the end. */
export const TEMP_PASSWORD = 'Demo-Seed-Temp#2026';
export const SUPERADMIN = 'superadmin@erp.local';
export const SUPPORT = 'support@erp.local';

export const warnings = [];
export const stats = {};
export const bump = (key, n = 1) => (stats[key] = (stats[key] ?? 0) + n);
export function warn(msg) {
  warnings.push(msg);
  console.warn(`  ! ${msg}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------ Dates ------------------------------------------ */

const pad = (n) => String(n).padStart(2, '0');
export const iso = (d) => d.toISOString().slice(0, 10);
export function addDays(date, days) {
  const d = new Date(`${typeof date === 'string' ? date : iso(date)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
}
export const TODAY = process.env.DEMO_TODAY ?? iso(new Date());
const t = new Date(`${TODAY}T00:00:00Z`);
const prev = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 1, 1));
/** Previous calendar month: attendance is locked and payroll finalized for it. */
export const PREV_MONTH = {
  start: iso(prev),
  end: iso(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 0))),
  label: prev.toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
};
export const MONTH_START = `${TODAY.slice(0, 8)}01`;
const ayStart = t.getUTCMonth() >= 3 ? t.getUTCFullYear() : t.getUTCFullYear() - 1;
export const ACADEMIC_YEAR = `${ayStart}-${pad((ayStart + 1) % 100)}`;
export const AY_START = `${ayStart}-04-01`;
export const dow = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();
export function dateRange(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
const nthWeek = (date) => Math.floor((Number(date.slice(8, 10)) - 1) / 7) + 1;
/** Working days: Mon–Sat except 2nd/4th Saturday and the given holidays. */
export const workingDays = (from, to, holidays = new Set()) =>
  dateRange(from, to).filter((d) => {
    const w = dow(d);
    if (w === 0 || holidays.has(d)) return false;
    return !(w === 6 && [2, 4].includes(nthWeek(d)));
  });
export const minutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
export const ist = (date, hhmm) => `${date}T${hhmm}:00+05:30`;

/* ------------------------------------------- HTTP ------------------------------------------ */

async function raw(token, method, p, body) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${API}${p}`, { method, headers, body: payload });
  const text = res.status === 204 ? '' : await res.text();
  let json = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
  }
  return { res, json };
}

export async function login(email, password = TEMP_PASSWORD, organization) {
  for (let attempt = 0; ; attempt++) {
    const { res, json } = await raw(null, 'POST', '/auth/login', {
      email,
      password,
      ...(organization ? { organization } : {}),
    });
    if (res.ok) return json.data;
    if (res.status === 429 && attempt < 8) {
      const wait = Number(
        json.error?.details?.retryAfterSeconds ?? res.headers.get('retry-after') ?? 15,
      );
      console.log(`    (login rate-limited, waiting ${wait}s)`);
      await sleep(Math.max(1, wait) * 1000 + 250);
      continue;
    }
    const e = new Error(`login ${email}: ${res.status} ${JSON.stringify(json.error ?? json)}`);
    e.status = res.status;
    e.body = json;
    throw e;
  }
}

/**
 * Returns `api(method, path, body)`; `getToken()` is called lazily and again after a 401
 * (access tokens live 15 minutes).
 */
export function session(getToken, label) {
  let token = null;
  const api = async (method, p, body) => {
    for (let attempt = 0; ; attempt++) {
      token ??= await getToken();
      const { res, json } = await raw(token, method, p, body);
      if (res.ok) return json;
      if (res.status === 401 && attempt === 0) {
        token = null;
        continue;
      }
      if (res.status === 429 && attempt < 5) {
        await sleep(Number(res.headers.get('retry-after') ?? 5) * 1000);
        continue;
      }
      const e = new Error(
        `${label} ${method} ${p} → ${res.status} ${JSON.stringify(json.error ?? json).slice(0, 900)}`,
      );
      e.status = res.status;
      e.code = json.error?.code;
      e.body = json;
      throw e;
    }
  };
  api.label = label;
  return api;
}

/** Session of a seeded tenant user (logs in with the temporary password). */
const userSessions = new Map();
export function userSession(email) {
  if (!userSessions.has(email)) {
    userSessions.set(
      email,
      session(async () => (await login(email, TEMP_PASSWORD)).accessToken, email),
    );
  }
  return userSessions.get(email);
}

export async function all(api, p) {
  const out = [];
  for (let page = 1; ; page++) {
    const sep = p.includes('?') ? '&' : '?';
    const j = await api('GET', `${p}${sep}page=${page}&pageSize=100`);
    const rows = Array.isArray(j.data) ? j.data : [];
    out.push(...rows);
    if (!j.meta || rows.length === 0 || out.length >= j.meta.total) return out;
  }
}

/** Run a non-critical seeding step; failures become warnings so the rest still seeds. */
export async function step(label, fn) {
  try {
    return await fn();
  } catch (e) {
    warn(`${label}: ${e.message}`);
    return null;
  }
}

/** Swallow the given HTTP statuses (e.g. 409 already exists). */
export async function tolerate(statuses, fn) {
  try {
    return await fn();
  } catch (e) {
    if (statuses.includes(e.status)) return null;
    throw e;
  }
}

/* ---------------------------------------- db-admin ----------------------------------------- */

export function dbAdmin(command, input) {
  const r = spawnSync(
    'pnpm',
    ['--silent', '--filter', '@erp/api', 'exec', 'tsx', '../../scripts/demo/db-admin.ts', command],
    {
      cwd: ROOT,
      input,
      encoding: 'utf8',
      env: { ...process.env, DEMO_PASSWORD },
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (r.status !== 0) {
    throw new Error(`db-admin ${command} failed (${r.status}): ${r.stderr || r.stdout}`);
  }
  return r.stdout.trim();
}

/* ------------------------------------------ Misc ------------------------------------------- */

export function pdfBlob(title) {
  const body = `BT /F1 18 Tf 72 740 Td (${title.replace(/[()\\]/g, '')}) Tj ET`;
  const parts = [
    '%PDF-1.4\n',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ' +
      '/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj\n',
    '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n',
    `5 0 obj << /Length ${body.length} >> stream\n${body}\nendstream endobj\n`,
    'trailer << /Root 1 0 R /Size 6 >>\n%%EOF\n',
  ];
  return new Blob(parts, { type: 'application/pdf' });
}

/** Deterministic pseudo-random in [0, 1) from a string seed. */
export function rand(...seed) {
  let h = 2166136261;
  for (const ch of seed.join('|')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

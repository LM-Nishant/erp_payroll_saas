import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, type Locator, type Page } from '@playwright/test';

/**
 * User-guide capture (only when GUIDE_STEPS=<dir> is set): every button click in the e2e flows is
 * screenshotted with the clicked button outlined, and fills / option picks are logged as text
 * steps, into <dir>/steps.jsonl. scripts/user-guide/build_guide.py turns them into how-to chapters.
 */
const OUT = process.env.GUIDE_STEPS;
const users = new WeakMap<Page, string>();
let installed = false;
let seq = 0;

interface Target {
  kind: 'button' | 'option' | 'field' | 'other';
  text: string;
  icon?: string;
  dialog?: string;
  row?: string;
  path: string;
}

function current() {
  try {
    const i = test.info();
    return {
      file: i.file.split('/tests/')[1] ?? i.file,
      title: i.titlePath.slice(1),
      testId: i.testId,
    };
  } catch {
    return null;
  }
}

function log(rec: Record<string, unknown>) {
  appendFileSync(
    join(OUT!, 'steps.jsonl'),
    JSON.stringify({ ...rec, seq: ++seq, pid: process.pid }) + '\n',
  );
}

export function guideUser(page: Page, email: string) {
  users.set(page, email);
}

async function shoot(page: Page, name: string) {
  const file = `${process.pid}-${String(++seq).padStart(5, '0')}-${name}.jpg`;
  await page
    .screenshot({ path: join(OUT!, file), type: 'jpeg', quality: 55 })
    .catch(() => undefined);
  return file;
}

async function describe(loc: Locator): Promise<Target | null> {
  return loc
    .evaluate(
      (el) => {
        const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
        const dialogEl = el.closest('.v-overlay--active .v-card');
        const dialog = clean(
          dialogEl?.querySelector('.v-card-title, .v-toolbar-title')?.textContent,
        );
        const row = el.closest('tbody tr');
        const rowText = row ? clean(row.querySelector('td')?.textContent).slice(0, 60) : undefined;
        const option = el.closest('.v-menu .v-list-item, [role=option]');
        if (option)
          return { kind: 'option', text: clean(option.textContent), path: location.pathname };
        const field = el.closest('.v-field, .v-input');
        const btn = el.closest('button, a, [role=tab], [role=button], .v-btn');
        if (field && !btn?.classList.contains('v-btn')) {
          const label = clean(
            field.closest('.v-input')?.querySelector('label, .v-label')?.textContent ??
              el.getAttribute('aria-label'),
          );
          return { kind: 'field', text: label, path: location.pathname };
        }
        const target = (btn ?? el) as HTMLElement;
        const icon = [...target.querySelectorAll('i.mdi')]
          .map((i) => [...i.classList].find((c) => c.startsWith('mdi-') && c !== 'mdi'))
          .find(Boolean);
        const text =
          clean(target.textContent) ||
          clean(target.getAttribute('aria-label')) ||
          clean(target.getAttribute('title'));
        target.dataset.guidePrevOutline = target.style.outline;
        target.style.outline = '3px solid #e11d48';
        target.style.outlineOffset = '2px';
        target.scrollIntoView({ block: 'nearest' });
        return {
          kind: btn ? 'button' : 'other',
          text,
          icon,
          dialog: dialog || undefined,
          row: rowText,
          path: location.pathname,
        };
      },
      undefined,
      { timeout: 5000 },
    )
    .catch(() => null) as Promise<Target | null>;
}

async function unmark(loc: Locator) {
  await loc
    .evaluate(
      (el) => {
        const t = (el.closest('button, a, [role=tab], [role=button], .v-btn') ?? el) as HTMLElement;
        t.style.outline = t.dataset.guidePrevOutline ?? '';
        t.style.outlineOffset = '';
      },
      undefined,
      { timeout: 1000 },
    )
    .catch(() => undefined);
}

export function installStepCapture(page: Page) {
  if (!OUT || installed) return;
  installed = true;
  mkdirSync(OUT, { recursive: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proto = Object.getPrototypeOf(page.locator('body')) as any;
  const click = proto.click as (this: Locator, o?: unknown) => Promise<void>;
  const fill = proto.fill as (this: Locator, v: string, o?: unknown) => Promise<void>;
  const check = proto.check as (this: Locator, o?: unknown) => Promise<void>;
  const files = proto.setInputFiles as (this: Locator, f: unknown, o?: unknown) => Promise<void>;

  proto.click = async function (this: Locator, opts?: unknown) {
    const c = current();
    if (!c) return click.call(this, opts);
    const p = this.page();
    const t = await describe(this);
    if (t && !(t.path === '/login' && t.text === 'Continue')) {
      const base = { ...c, user: users.get(p), ...t };
      if (t.kind === 'button' || t.kind === 'other')
        log({ ...base, action: 'click', shot: await shoot(p, 'click') });
      else log({ ...base, action: t.kind === 'option' ? 'select' : 'open' });
    }
    if (t?.kind === 'button' || t?.kind === 'other') await unmark(this);
    return click.call(this, opts);
  };
  proto.fill = async function (this: Locator, value: string, opts?: unknown) {
    const c = current();
    if (c && value) {
      const t = await describe(this);
      if (t) await unmark(this);
      if (t && t.path !== '/login')
        log({
          ...c,
          user: users.get(this.page()),
          ...t,
          action: 'fill',
          value: value.slice(0, 80),
        });
    }
    return fill.call(this, value, opts);
  };
  proto.check = async function (this: Locator, opts?: unknown) {
    const c = current();
    if (c) {
      const t = await describe(this);
      if (t) await unmark(this);
      log({ ...c, user: users.get(this.page()), ...(t ?? {}), action: 'check' });
    }
    return check.call(this, opts);
  };
  proto.setInputFiles = async function (this: Locator, f: unknown, opts?: unknown) {
    const c = current();
    if (c) log({ ...c, user: users.get(this.page()), action: 'upload' });
    return files.call(this, f, opts);
  };
}

/** Screenshot of the outcome after each test of a signed-in describe block. */
export function registerResultShot(getPage: () => Page | undefined) {
  if (!OUT) return;
  // Playwright requires the fixtures argument to be destructured.
  // eslint-disable-next-line no-empty-pattern
  test.afterEach(async ({}, info) => {
    const page = getPage();
    if (!page) return;
    await page.waitForTimeout(400);
    const c = current();
    log({
      ...(c ?? {}),
      user: users.get(page),
      action: 'result',
      status: info.status,
      path: new URL(page.url()).pathname,
      shot: await shoot(page, 'result'),
    });
  });
}

/** Logs an in-app navigation ("Open <page>") step. */
export function logNav(page: Page, path: string) {
  const c = OUT ? current() : null;
  if (c) log({ ...c, user: users.get(page), action: 'nav', path });
}

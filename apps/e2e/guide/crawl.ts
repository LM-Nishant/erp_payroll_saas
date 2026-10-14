import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, type Locator, type Page } from '@playwright/test';
import { AppSession, BLOCKED_PATHS } from '../src/app';
import { user } from '../src/manifest';

/**
 * Logs in as each role, visits every workspace + menu page (and tabs), opens safe "create"
 * dialogs, and records screenshots + the action buttons seen. Output: $GUIDE_OUT/<role>/…
 */
const OUT = process.env.GUIDE_OUT ?? '/tmp/erp-guide';
const ROLES = (process.env.GUIDE_ROLES ?? '').split(',').filter(Boolean);
const LAYOUTS = (
  process.env.GUIDE_LAYOUTS ?? '/platform,/group,/institution,/hr,/employee,/portal,/assets'
).split(',');
/** Buttons that only open a form/dialog (never mutate by themselves). */
const SAFE_OPEN =
  /^(\+\s*)?(add|new|create|upload|import|apply|raise|issue|request|invite|pay\b.*upi|compose|assign|allocate|book|enrol|enroll|record expense|add expense|ad-hoc|record|collect|mark|enter|schedule|register|admit|onboard)\b/i;
const UNSAFE =
  /delete|remove|approve|reject|cancel|finali[sz]e|publish|send|verify|generate|run|compute|lock|punch|check (in|out)|submit|save|post\b|reopen|disburse|mark all|logout/i;

interface Btn {
  label: string;
  icon?: string;
  where: 'toolbar' | 'row' | 'dialog' | 'tab';
}
interface Shot {
  file: string;
  kind: 'page' | 'tab' | 'dialog' | 'form';
  title: string;
  buttons: Btn[];
  fields?: string[];
}
interface PageRec {
  layout: string;
  menu: string;
  path: string;
  heading: string;
  shots: Shot[];
}

async function buttonsIn(scope: Locator, where: Btn['where']): Promise<Btn[]> {
  const raw = await scope.locator('button:visible, a.v-btn:visible').evaluateAll((els) =>
    els.map((el) => {
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      const icon = [...el.querySelectorAll('i.mdi')]
        .map((i) => [...i.classList].find((c) => c.startsWith('mdi-') && c !== 'mdi'))
        .find(Boolean);
      const aria = el.getAttribute('aria-label') ?? el.getAttribute('title') ?? '';
      const inRow = Boolean(el.closest('tbody tr'));
      const isTab = el.classList.contains('v-tab');
      const disabled =
        (el as HTMLButtonElement).disabled || el.classList.contains('v-btn--disabled');
      return { text, icon, aria, inRow, isTab, disabled };
    }),
  );
  const seen = new Set<string>();
  const out: Btn[] = [];
  for (const b of raw) {
    let label = b.text || b.aria;
    if (!label && !b.icon) continue;
    if (/^\d+$/.test(label) || /^(first|previous|next|last) page$/i.test(label)) continue;
    if (b.icon && /chevron|menu-down|calendar$|close-circle/.test(b.icon) && !label) continue;
    label = label.slice(0, 60);
    const w: Btn['where'] = b.isTab ? 'tab' : b.inRow ? 'row' : where;
    const key = `${w}|${label}|${b.icon ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label: label + (b.disabled ? ' (disabled)' : ''), icon: b.icon, where: w });
  }
  return out;
}

async function heading(page: Page) {
  const h = page
    .locator('.v-main h1:visible, .v-main h2:visible, .v-main .text-h5:visible')
    .first();
  return ((await h.textContent({ timeout: 1500 }).catch(() => '')) ?? '').trim();
}

const activeDialog = (page: Page) =>
  page.locator('.v-overlay--active .v-overlay__content:has(.v-card)').last();

async function closeDialog(page: Page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const d = activeDialog(page);
  if (await d.isVisible().catch(() => false)) {
    const close = d.getByRole('button', { name: /^(cancel|close)$/i }).first();
    if (await close.isVisible().catch(() => false)) await close.click().catch(() => undefined);
    await page.waitForTimeout(300);
  }
}

for (const email of ROLES) {
  test(email, async ({ browser }) => {
    const u = user(email);
    const dir = join(OUT, email.split('@')[0]!);
    mkdirSync(dir, { recursive: true });
    const s = await AppSession.open(browser);
    const page = s.page;
    let n = 0;
    const snap = async (target: Page | Locator, base: string) => {
      const file = `${String(++n).padStart(3, '0')}-${base.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}.jpg`;
      await target.screenshot({ path: join(dir, file), type: 'jpeg', quality: 62 });
      return file;
    };
    const pages: PageRec[] = [];

    // Login screen (filled in) + workspace chooser.
    await page.goto('/login');
    await page.getByLabel('Email').fill(u.email);
    await page.getByLabel('Password').fill(u.password);
    const loginShot = await snap(page, 'login');
    await s.signIn(u);
    await s.settle();
    const homeShot = await snap(page, 'home');
    const homeButtons = await buttonsIn(page.locator('.v-main'), 'toolbar');
    pages.push({
      layout: 'home',
      menu: 'Sign in',
      path: '/login',
      heading: 'Sign in',
      shots: [{ file: loginShot, kind: 'page', title: 'Login screen', buttons: [] }],
    });
    pages.push({
      layout: 'home',
      menu: 'Workspace chooser',
      path: '/',
      heading: 'Choose a workspace',
      shots: [{ file: homeShot, kind: 'page', title: 'After login', buttons: homeButtons }],
    });

    const links = await page
      .locator('a[href]')
      .evaluateAll((as) => as.map((a) => new URL((a as HTMLAnchorElement).href).pathname));
    const layouts = LAYOUTS.filter(
      (l) => links.some((x) => x.startsWith(l)) || u.workspaces.some((w) => w.to.startsWith(l)),
    );

    for (const layout of layouts) {
      const entry = u.workspaces.find((w) => w.to.startsWith(layout))?.to ?? layout;
      await s.go(entry);
      if (!s.pathname().startsWith(layout)) continue;
      const items = await s.drawerItems().catch(() => []);
      for (const item of items) {
        await s.go(item.to).catch(() => undefined);
        if (BLOCKED_PATHS.includes(s.pathname())) continue;
        await page.waitForTimeout(700);
        const rec: PageRec = {
          layout,
          menu: item.title,
          path: item.to,
          heading: (await heading(page)) || item.title,
          shots: [],
        };
        const main = page.locator('.v-main');
        rec.shots.push({
          file: await snap(page, item.title),
          kind: 'page',
          title: item.title,
          buttons: await buttonsIn(main, 'toolbar'),
        });

        // Tabs (skip the first, already shown).
        const tabs = main.locator('.v-tab:visible');
        const tabCount = Math.min(await tabs.count(), 8);
        for (let i = 1; i < tabCount; i++) {
          const tab = tabs.nth(i);
          const name = ((await tab.innerText().catch(() => '')) || `Tab ${i + 1}`).trim();
          await tab.click().catch(() => undefined);
          await s.settle(400, 8000).catch(() => undefined);
          rec.shots.push({
            file: await snap(page, `${item.title}-${name}`),
            kind: 'tab',
            title: `${item.title} → ${name} tab`,
            buttons: await buttonsIn(main, 'toolbar'),
          });
        }
        if (tabCount > 1)
          await tabs
            .first()
            .click()
            .catch(() => undefined);

        // Safe create/open buttons in the page toolbar (not row actions).
        const candidates = await main
          .locator('button:visible, a.v-btn:visible')
          .evaluateAll((els) =>
            els
              .filter((el) => !el.closest('tbody tr') && !el.classList.contains('v-tab'))
              .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
              .filter(Boolean),
          );
        const openers = [...new Set(candidates)]
          .filter((t) => SAFE_OPEN.test(t) && !UNSAFE.test(t))
          .slice(0, 4);
        for (const label of openers) {
          const btn = main.getByRole('button', { name: label, exact: true }).first();
          const link = main.getByRole('link', { name: label, exact: true }).first();
          const target = (await btn.isVisible().catch(() => false)) ? btn : link;
          if (!(await target.isVisible().catch(() => false))) continue;
          if (await target.isDisabled().catch(() => false)) continue;
          const before = s.pathname();
          await target.click().catch(() => undefined);
          await page.waitForTimeout(900);
          const dlg = activeDialog(page);
          if (await dlg.isVisible().catch(() => false)) {
            const fields = await dlg
              .locator('.v-field:visible .v-label, label:visible')
              .allInnerTexts()
              .catch(() => []);
            rec.shots.push({
              file: await snap(dlg, `${item.title}-${label}`),
              kind: 'dialog',
              title: `"${label}" dialog`,
              buttons: await buttonsIn(dlg, 'dialog'),
              fields: [...new Set(fields.map((f) => f.trim()).filter(Boolean))].slice(0, 30),
            });
            await closeDialog(page);
          } else if (s.pathname() !== before) {
            await s.settle(400, 8000).catch(() => undefined);
            const fields = await main
              .locator('.v-field:visible .v-label')
              .allInnerTexts()
              .catch(() => []);
            rec.shots.push({
              file: await snap(page, `${item.title}-${label}`),
              kind: 'form',
              title: `"${label}" screen`,
              buttons: await buttonsIn(main, 'toolbar'),
              fields: [...new Set(fields.map((f) => f.trim()).filter(Boolean))].slice(0, 30),
            });
            await s.go(item.to).catch(() => undefined);
          }
        }
        pages.push(rec);
      }
    }
    writeFileSync(
      join(dir, 'pages.json'),
      JSON.stringify(
        { email: u.email, name: u.name, roles: u.roles, persona: u.persona, pages },
        null,
        2,
      ),
    );
    await s.close();
  });
}

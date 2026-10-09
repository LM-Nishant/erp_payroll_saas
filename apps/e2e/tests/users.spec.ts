import { expect, test } from '@playwright/test';
import { MENUS } from '../../web/src/navigation/menus';
import { AppSession, BLOCKED_PATHS, type ApiCall } from '../src/app';
import {
  forbiddenTitles,
  layoutsOf,
  manifest,
  org,
  unlicensedMenuItems,
  type DemoUser,
  type MenuLink,
} from '../src/manifest';

/**
 * Per-user matrix (every user in scripts/demo/demo-manifest.json, one sign-in each):
 *  1. login lands on the workspace chooser with exactly the expected workspaces;
 *  2. each workspace's left menu equals the expected menu (licensed modules only);
 *  3. every menu page opens without a guard redirect, error alert, 400/5xx or FEATURE_DISABLED
 *     answer. Optional lookups that the page handles quietly (403 PERMISSION/SCOPE_DENIED or
 *     404 on a self-service "me" endpoint, with no error alert) are tolerated. When the module is
 *     switched off for the user's own institution the page must either load cleanly (data is
 *     scoped) or surface the API block; writes are covered in licence.spec.ts;
 *  4. every page of an unlicensed module is blocked when opened by URL.
 */

/** Modules enabled where the user works (institution overrides can switch some off). */
function homeFeatures(u: DemoUser): Set<string> {
  const o = u.org ? org(u.org) : null;
  const inst = o?.institutions.find((i) => i.name === u.institution);
  return new Set(inst?.effectiveFeatures ?? u.features);
}

/** Module guarding a menu path (looked up across every layout's menu definition). */
const featureOf = (to: string) =>
  Object.values(MENUS)
    .flat()
    .find((m) => m.to === to)?.feature ?? null;

const describeCall = (c: ApiCall) =>
  `${c.status} ${c.method} ${c.path} ${c.code ?? ''} ${c.message ?? ''}`.trim();

const isFeatureBlock = (c: ApiCall) => c.status === 403 && c.code === 'FEATURE_DISABLED';

/** API failures a page may absorb silently (optional lookup / not-linked self-service record). */
const isQuietMiss = (c: ApiCall) =>
  (c.status === 403 && (c.code === 'PERMISSION_DENIED' || c.code === 'SCOPE_DENIED')) ||
  (c.status === 404 && c.code === 'NOT_FOUND');

for (const u of manifest.users.filter((x) => x.loginOk)) {
  test.describe(`${u.email} (${u.roleKey}${u.org ? ` @ ${u.org}` : ''})`, () => {
    test.describe.configure({ mode: 'serial' });
    let s: AppSession;

    test.beforeAll(async ({ browser }) => {
      s = await AppSession.open(browser);
    });
    test.afterAll(async () => {
      await s?.close();
    });

    test('signs in with the demo password and lands on its workspaces', async () => {
      test.setTimeout(180_000);
      await s.signIn(u);
      const cards = s.page.locator('.v-card .v-card-title');
      await expect(cards).toHaveText(u.workspaces.map((w) => w.title));
      if (!u.org) {
        await expect(
          s.page.getByText('You are signed in as a platform administrator'),
        ).toBeVisible();
      }
    });

    test('left menus show exactly the licensed modules', async () => {
      for (const w of layoutsOf(u)) {
        await s.go(w.to);
        expect(s.pathname(), `workspace ${w.to} opens`).not.toMatch(
          /^\/(forbidden|module-disabled|login)$/,
        );
        const items = await s.drawerItems();
        const expected = (u.menus[w.layout] ?? []) as MenuLink[];
        expect(items, `${w.layout} menu`).toEqual(
          expected.map((m) => ({ title: m.title, to: m.to })),
        );
        const titles = items.map((i) => i.title);
        for (const t of forbiddenTitles(u, w.layout)) {
          expect(titles, `${w.layout} menu must not offer unlicensed "${t}"`).not.toContain(t);
        }
      }
    });

    const pages = [
      ...new Map(
        layoutsOf(u).flatMap((w) =>
          ((u.menus[w.layout] ?? []) as MenuLink[]).map((m) => [m.to, m]),
        ),
      ).values(),
    ];

    test(`all ${pages.length} menu pages open without errors`, async () => {
      test.setTimeout(60_000 + pages.length * 15_000);
      const local = homeFeatures(u);
      const problems: string[] = [];
      for (const p of pages) {
        const mark = s.mark();
        await s.go(p.to);
        const path = s.pathname();
        const failed = await s.failedSince(mark);
        const alerts = await s.errorAlerts();
        const feature = featureOf(p.to);
        if (feature && !local.has(feature)) {
          // Licensed for the organization but switched off at the user's institution: the menu
          // may show it; an API block must be surfaced, anything else must load cleanly.
          if (failed.some(isFeatureBlock) && alerts.length === 0) {
            problems.push(`${p.to}: ${feature} block not shown in the UI`);
          }
          for (const c of failed.filter((x) => !isFeatureBlock(x) && !isQuietMiss(x))) {
            problems.push(`${p.to}: ${describeCall(c)}`);
          }
          continue;
        }
        if (/^\/(forbidden|module-disabled|login)$/.test(path)) {
          problems.push(`${p.to}: redirected to ${path}`);
        }
        for (const c of failed) {
          if (isQuietMiss(c) && alerts.length === 0) {
            test.info().annotations.push({
              type: 'quiet API miss',
              description: `${p.to}: ${describeCall(c)}`,
            });
          } else problems.push(`${p.to}: ${describeCall(c)}`);
        }
        for (const a of alerts) problems.push(`${p.to}: error alert "${a}"`);
      }
      expect(problems).toEqual([]);
    });

    const unlicensed = unlicensedMenuItems(u);
    if (unlicensed.length > 0) {
      test(`all ${unlicensed.length} unlicensed module pages are blocked by direct URL`, async () => {
        test.setTimeout(60_000 + unlicensed.length * 10_000);
        const problems: string[] = [];
        for (const m of unlicensed) {
          const mark = s.mark();
          await s.go(m.to);
          const path = s.pathname();
          if (BLOCKED_PATHS.includes(path)) continue;
          const failed = await s.failedSince(mark);
          const alerts = await s.errorAlerts();
          if (!failed.some(isFeatureBlock) || alerts.length === 0) {
            problems.push(`${m.feature} page ${m.to} opened at ${path} without a visible block`);
          }
        }
        expect(problems).toEqual([]);
      });
    }
  });
}

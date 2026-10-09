import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MENUS, WORKSPACES, type LayoutKey, type MenuItem } from '../../web/src/navigation/menus';

/**
 * The demo manifest written by `pnpm demo:seed` (scripts/demo/demo-manifest.json). Every test is
 * data-driven from it, so re-seeding with new users / organizations extends the suite.
 */
export interface MenuLink {
  title: string;
  to: string;
}

export interface DemoUser {
  email: string;
  password: string;
  name: string;
  org: string | null;
  roleKey: string;
  /** Every role assignment of the user (key + scope). */
  roles?: Array<{ key: string; scope: string; scopeName: string }>;
  institution: string | null;
  persona: string;
  loginOk: boolean;
  features: string[];
  workspaces: Array<MenuLink & { layout: LayoutKey }>;
  menus: Partial<Record<LayoutKey, MenuLink[]>>;
}

export interface DemoInstitution {
  id: string;
  name: string;
  code: string;
  effectiveFeatures: string[];
}

export interface DemoOrganization {
  id: string;
  name: string;
  slug: string;
  kind: 'EDUCATION' | 'COMPANY';
  plan: string;
  subscriptionStatus: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';
  licensedFeatures: string[];
  effectiveFeatures: string[];
  institutions: DemoInstitution[];
}

export interface DemoManifest {
  password: string;
  organizations: DemoOrganization[];
  users: DemoUser[];
}

const manifestPath =
  process.env.E2E_MANIFEST ??
  fileURLToPath(new URL('../../../scripts/demo/demo-manifest.json', import.meta.url));

export const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as DemoManifest;

export const PASSWORD = process.env.E2E_PASSWORD ?? manifest.password ?? 'password123';

export function user(email: string): DemoUser {
  const u = manifest.users.find((x) => x.email === email);
  if (!u) throw new Error(`Demo user ${email} is not in the manifest — re-run pnpm demo:seed`);
  return u;
}

export function org(slug: string): DemoOrganization {
  const o = manifest.organizations.find((x) => x.slug === slug);
  if (!o) throw new Error(`Demo organization ${slug} is not in the manifest`);
  return o;
}

/** All feature keys the web menus know about. */
export const ALL_FEATURES = [
  ...new Set(
    Object.values(MENUS)
      .flat()
      .map((m) => m.feature)
      .filter((f): f is NonNullable<MenuItem['feature']> => Boolean(f)),
  ),
];

/** Every menu item (any layout) gated by a module the user's organization does not have. */
export function unlicensedMenuItems(u: DemoUser): Array<MenuItem & { layout: LayoutKey }> {
  const has = new Set(u.features);
  const seen = new Set<string>();
  return (Object.entries(MENUS) as Array<[LayoutKey, MenuItem[]]>)
    .filter(([layout]) => layout !== 'platform')
    .flatMap(([layout, items]) => items.map((m) => ({ ...m, layout })))
    .filter((m) => m.feature && !has.has(m.feature))
    .filter((m) => (seen.has(m.to) ? false : (seen.add(m.to), true)));
}

/** Menu titles of a layout that must never show for this user (their module is not licensed). */
export function forbiddenTitles(u: DemoUser, layout: LayoutKey): string[] {
  const has = new Set(u.features);
  const visible = new Set((u.menus[layout] ?? []).map((m) => m.title));
  return MENUS[layout]
    .filter((m) => m.feature && !has.has(m.feature))
    .flatMap((m) => [m.title, ...(m.companyTitle ? [m.companyTitle] : [])])
    .filter((t) => !visible.has(t));
}

export const WORKSPACE_DEFS = WORKSPACES;

/** One entry per layout (a layout can be offered twice, e.g. portal + parent portal). */
export function layoutsOf(u: DemoUser) {
  const seen = new Set<LayoutKey>();
  return u.workspaces.filter((w) => (seen.has(w.layout) ? false : (seen.add(w.layout), true)));
}

import { expect, test } from '@playwright/test';
import { DEFAULT_TENANT_ROLES } from '../../api/src/core/authz/default-roles';
import { MENUS, type LayoutKey, type MenuItem } from '../../web/src/navigation/menus';
import { BLOCKED_PATHS } from '../src/app';
import { manifest, type DemoUser } from '../src/manifest';
import { signedIn } from '../src/session';

/**
 * Education module × every role. For each education-org demo user the expectations are computed
 * from the shipped role definitions (DEFAULT_TENANT_ROLES), independently of what /me returns:
 *  1. every education page the user's roles permit opens cleanly through the UI;
 *  2. every education page outside those permissions is blocked when opened by URL;
 *  3. create / manage controls on the education pages are shown exactly when permitted.
 * Education pages = students, admissions, academics, timetable, attendance, exams, results,
 * report cards, fees, library, hostel and transport (staff + student/parent portal).
 */

const EDU_FEATURES = new Set(['education', 'library', 'hostel', 'transport']);
const isEducation = (m: MenuItem) =>
  (m.feature !== undefined && EDU_FEATURES.has(m.feature)) || m.to.includes('/fees');

/** Permission of the layout route that wraps each workspace (the guard checks every record). */
const LAYOUT_PERMISSION: Record<LayoutKey, string | undefined> = {
  platform: 'platform.organization.view',
  group: 'group.view',
  institution: 'institution.view',
  hr: 'employee.view',
  employee: undefined,
  portal: undefined,
  assets: 'asset.view',
};

/** Route permission (staff library routes are all `library.view`; the menu can be stricter). */
const routePermission = (m: MenuItem, layout: LayoutKey) =>
  (layout === 'group' || layout === 'institution') && m.to.includes('/library')
    ? 'library.view'
    : m.permission;

const PAGES = (() => {
  const seen = new Set<string>();
  return (Object.entries(MENUS) as Array<[LayoutKey, MenuItem[]]>)
    .filter(([layout]) => layout !== 'platform')
    .flatMap(([layout, items]) => items.filter(isEducation).map((m) => ({ ...m, layout })))
    .filter((m) => (seen.has(m.to) ? false : (seen.add(m.to), true)));
})();

const ROLE_PERMISSIONS = new Map(DEFAULT_TENANT_ROLES.map((r) => [r.key, r.permissions]));

function permissionsOf(u: DemoUser): Set<string> {
  const keys = u.roles?.map((r) => r.key) ?? [u.roleKey];
  return new Set(keys.flatMap((k) => [...(ROLE_PERMISSIONS.get(k) ?? [])]));
}

/** Create / manage controls and the permissions that must all be held for them to show. */
interface Control {
  path: string;
  name: string | RegExp;
  role: 'button' | 'tab';
  needs: string[];
  /** Only checked for users whose roles are all institution-scoped. */
  institutionOnly?: boolean;
}
const CONTROLS: Control[] = [
  { path: '/institution/students', name: 'New student', role: 'button', needs: ['student.create'] },
  {
    path: '/institution/admissions',
    name: 'New application',
    role: 'button',
    needs: ['admission.manage'],
  },
  {
    path: '/institution/classes',
    name: /Add classes & sections/,
    role: 'button',
    needs: ['program.create', 'class_section.create'],
  },
  { path: '/institution/subjects', name: 'New subject', role: 'button', needs: ['subject.manage'] },
  {
    path: '/institution/timetable',
    name: 'Bell schedule',
    role: 'tab',
    needs: ['timetable.manage'],
  },
  {
    path: '/institution/exams',
    name: 'Exam term',
    role: 'button',
    needs: ['exam.manage'],
    institutionOnly: true,
  },
  { path: '/institution/fees/heads', name: 'New fee head', role: 'button', needs: ['fee.manage'] },
  {
    path: '/institution/fees/structures',
    name: 'New structure',
    role: 'button',
    needs: ['fee.manage'],
  },
  {
    path: '/institution/library/catalogue',
    name: 'Import',
    role: 'button',
    needs: ['library.manage'],
  },
];

const eduOrgs = new Set(
  manifest.organizations
    .filter((o) => o.effectiveFeatures.includes('education'))
    .map((o) => o.slug),
);
const USERS = manifest.users.filter((u) => u.loginOk && u.org && eduOrgs.has(u.org));

for (const u of USERS) {
  const perms = permissionsOf(u);
  const can = (p?: string) => !p || perms.has(p);
  const features = new Set(u.features);
  const opens = (m: (typeof PAGES)[number]) =>
    can(LAYOUT_PERMISSION[m.layout]) &&
    can(routePermission(m, m.layout)) &&
    (!m.feature || features.has(m.feature));
  const allowed = PAGES.filter(opens);
  const denied = PAGES.filter((m) => !opens(m));
  // Exam terms are institution-level records: group/org users must pick an institution first and
  // department-scoped roles (HOD, teachers) cannot see or manage their parent institution.
  const inInstitution = (u.roles ?? []).every((r) => r.scope === 'INSTITUTION');

  test.describe(`education · ${u.email} (${(u.roles ?? []).map((r) => r.key).join(', ') || u.roleKey} @ ${u.org})`, () => {
    test.describe.configure({ mode: 'serial' });
    const session = signedIn(u.email);

    test(`opens its ${allowed.length} permitted education pages`, async () => {
      test.setTimeout(60_000 + allowed.length * 15_000);
      const s = session();
      const problems: string[] = [];
      for (const p of allowed) {
        const mark = s.mark();
        await s.go(p.to);
        if (BLOCKED_PATHS.includes(s.pathname())) {
          problems.push(`${p.to} redirected to ${s.pathname()}`);
          continue;
        }
        const failed = await s.failedSince(
          mark,
          (x) =>
            (x.status === 403 && (x.code === 'PERMISSION_DENIED' || x.code === 'SCOPE_DENIED')) ||
            (x.status === 404 && x.code === 'NOT_FOUND'),
        );
        for (const f of failed)
          problems.push(`${p.to}: ${f.status} ${f.method} ${f.path} ${f.code ?? ''}`);
        for (const a of await s.errorAlerts()) problems.push(`${p.to}: alert ${a}`);
      }
      expect(problems).toEqual([]);
    });

    test(`is blocked from ${denied.length} education pages outside its roles`, async () => {
      test.setTimeout(60_000 + denied.length * 10_000);
      const s = session();
      const leaked: string[] = [];
      for (const p of denied) {
        await s.go(p.to);
        if (!BLOCKED_PATHS.includes(s.pathname())) leaked.push(`${p.to} opened at ${s.pathname()}`);
      }
      expect(leaked).toEqual([]);
    });

    const controls = CONTROLS.filter(
      (c) => allowed.some((p) => p.to === c.path) && (!c.institutionOnly || inInstitution),
    );
    if (controls.length)
      test(`shows only the ${controls.length} education write controls its roles permit`, async () => {
        const s = session();
        const wrong: string[] = [];
        for (const c of controls) {
          await s.go(c.path);
          const expected = c.needs.every(can);
          const control = s.page.getByRole(c.role, { name: c.name }).first();
          if (expected) {
            await control.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
          }
          const visible = await control.isVisible();
          if (visible !== expected)
            wrong.push(
              `${c.path} "${String(c.name)}" ${expected ? 'missing' : 'shown without ' + c.needs.join('+')}`,
            );
        }
        expect(wrong).toEqual([]);
      });
  });
}

/**
 * Direct-database helpers for the demo seed (scripts/demo/seed-demo.mjs). Everything else in
 * the demo is created through the public HTTP API; only these steps bypass it:
 *
 *   reset     TRUNCATE every tenant/data table (keeps migrations, permission catalog, plans and
 *             platform billing settings), re-sync the permission catalog and create the platform
 *             super admin + support admin.
 *   finalize  Set every user's password to the demo password (the API's own argon2id hash —
 *             the password policy would reject it through the API), unlock accounts and
 *             activate INVITED memberships.
 *   menus     Read [{ email, me }] (GET /me payloads) as JSON on stdin and print the workspaces
 *             and menu items the web app shows each user (apps/web/src/navigation/menus.ts).
 *
 * Run from apps/api so its .env (DATABASE_URL) and dependencies are used:
 *   pnpm --filter @erp/api exec tsx ../../scripts/demo/db-admin.ts <command>
 */
import { hashPassword } from '../../apps/api/src/core/auth/password';
import { syncPermissionCatalog } from '../../apps/api/src/core/authz/provisioning';
import { prisma } from '../../apps/api/src/core/db/prisma';
import {
  MENUS,
  WORKSPACES,
  visibleMenu,
  type LayoutKey,
  type OrgKind,
} from '../../apps/web/src/navigation/menus';
import { isPortalOnlyUser } from '../../apps/web/src/navigation/guard';

const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'password123';
const KEEP_TABLES = new Set([
  '_prisma_migrations',
  'permissions',
  'subscription_plans',
  'platform_billing_settings',
]);
const PLATFORM_USERS = [
  { email: 'superadmin@erp.local', name: 'Platform Super Admin', role: 'platform_super_admin' },
  { email: 'support@erp.local', name: 'Platform Support Admin', role: 'platform_support_admin' },
];

async function reset() {
  const rows = await prisma.$queryRaw<Array<{ name: string }>>`
    SELECT TABLE_NAME AS name FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`;
  const tables = rows.map((r) => r.name).filter((t) => !KEEP_TABLES.has(t));
  // One connection: FOREIGN_KEY_CHECKS is a session variable.
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
      for (const t of tables) await tx.$executeRawUnsafe(`TRUNCATE TABLE \`${t}\``);
      await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
    },
    { timeout: 300_000 },
  );
  await syncPermissionCatalog();
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  for (const p of PLATFORM_USERS) {
    const user = await prisma.user.create({
      data: { email: p.email, name: p.name, passwordHash, passwordChangedAt: new Date() },
    });
    await prisma.platformRoleAssignment.create({ data: { userId: user.id, roleKey: p.role } });
  }
  console.log(JSON.stringify({ truncated: tables.length, platformUsers: PLATFORM_USERS.length }));
}

async function finalize() {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const now = new Date();
  const users = await prisma.user.updateMany({
    where: { deletedAt: null },
    data: {
      passwordHash,
      passwordChangedAt: now,
      status: 'ACTIVE',
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });
  const memberships = await prisma.organizationMembership.updateMany({
    where: { status: 'INVITED', deletedAt: null },
    data: { status: 'ACTIVE', joinedAt: now },
  });
  console.log(JSON.stringify({ users: users.count, activatedMemberships: memberships.count }));
}

interface MeLike {
  permissions: string[];
  features: string[];
  platformRoles: string[];
  roles: Array<{ key: string }>;
  organization: { kind: OrgKind } | null;
}

async function menus() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const entries = JSON.parse(input) as Array<{ email: string; me: MeLike }>;
  const out = entries.map(({ email, me }) => {
    const perms = new Set(me.permissions);
    const features = new Set(me.features);
    const can = (p?: string) => !p || perms.has(p);
    const has = (f?: string) => !f || features.has(f);
    const kind = me.organization?.kind ?? 'EDUCATION';
    const workspaces = visibleMenu(WORKSPACES, can, has, kind).filter(
      (w) =>
        (w.layout === 'platform' || Boolean(me.organization)) &&
        !(w.layout === 'employee' && isPortalOnlyUser(me)),
    );
    const layouts = [...new Set(workspaces.map((w) => w.layout))] as LayoutKey[];
    return {
      email,
      workspaces: workspaces.map((w) => ({ layout: w.layout, title: w.title, to: w.to })),
      menus: Object.fromEntries(
        layouts.map((l) => [
          l,
          visibleMenu(MENUS[l], can, has, kind).map((m) => ({ title: m.title, to: m.to })),
        ]),
      ),
    };
  });
  process.stdout.write(JSON.stringify(out));
}

const commands: Record<string, () => Promise<void>> = { reset, finalize, menus };
const command = process.argv[2] ?? '';
const run = commands[command];
if (!run) {
  console.error(`Usage: db-admin.ts <${Object.keys(commands).join('|')}>`);
  process.exitCode = 2;
} else {
  try {
    await run();
  } finally {
    await prisma.$disconnect();
  }
}

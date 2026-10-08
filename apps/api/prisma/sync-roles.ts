/**
 * Re-sync the permission catalog and every organization's system roles with the code defaults
 * (core/authz/default-roles.ts). Run after deploying modules that add permissions or roles:
 *   pnpm --filter @erp/api db:sync-roles
 * Custom roles are untouched; system roles' permissions are reset to the defaults.
 */
import { provisionOrganizationRoles, syncPermissionCatalog } from '../src/core/authz/provisioning';
import { prisma } from '../src/core/db/prisma';

await syncPermissionCatalog();
const orgs = await prisma.organization.findMany({
  where: { deletedAt: null },
  select: { id: true, slug: true },
});
for (const org of orgs) {
  await provisionOrganizationRoles(org.id);
  console.log(`synced system roles for ${org.slug}`);
}
await prisma.$disconnect();

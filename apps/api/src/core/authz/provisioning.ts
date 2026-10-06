import { PERMISSIONS, permissionModule } from '@erp/shared';
import { prisma } from '../db/prisma';
import { DEFAULT_TENANT_ROLES } from './default-roles';

/** Upsert the permission catalog from @erp/shared. Runs at server start and in the seed. */
export async function syncPermissionCatalog(): Promise<void> {
  const existing = new Map((await prisma.permission.findMany()).map((p) => [p.code, p] as const));
  const missing = Object.entries(PERMISSIONS).filter(([code]) => !existing.has(code));
  if (missing.length > 0) {
    await prisma.permission.createMany({
      data: missing.map(([code, description]) => ({
        code,
        description,
        module: permissionModule(code),
      })),
      skipDuplicates: true,
    });
  }
  for (const [code, description] of Object.entries(PERMISSIONS)) {
    const row = existing.get(code);
    if (row && row.description !== description) {
      await prisma.permission.update({ where: { code }, data: { description } });
    }
  }
}

/**
 * Create / re-sync the default (system) roles of an organization. Idempotent; system roles'
 * permissions are reset to the code defaults (custom roles are untouched).
 */
export async function provisionOrganizationRoles(organizationId: string): Promise<void> {
  const permissionIds = new Map(
    (await prisma.permission.findMany({ select: { id: true, code: true } })).map(
      (p) => [p.code, p.id] as const,
    ),
  );
  for (const def of DEFAULT_TENANT_ROLES) {
    const role = await prisma.role.upsert({
      where: { organizationId_key: { organizationId, key: def.key } },
      create: {
        organizationId,
        key: def.key,
        name: def.name,
        description: def.description,
        isSystem: true,
      },
      update: { name: def.name, description: def.description, isSystem: true, deletedAt: null },
    });
    const desired = def.permissions
      .map((code) => permissionIds.get(code))
      .filter((id): id is string => Boolean(id));
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({
        where: { roleId: role.id, permissionId: { notIn: desired } },
      }),
      prisma.rolePermission.createMany({
        data: desired.map((permissionId) => ({ organizationId, roleId: role.id, permissionId })),
        skipDuplicates: true,
      }),
    ]);
  }
}

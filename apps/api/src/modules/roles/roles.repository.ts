import type { PageWindow } from '../../core/http/pagination';
import { tenantDb, withTenant } from '../../core/tenancy';

const include = {
  rolePermissions: { include: { permission: { select: { code: true } } } },
  _count: { select: { userRoles: true } },
} as const;

export const roleRepository = {
  async list(filter: PageWindow & { search?: string }) {
    const where = filter.search
      ? { OR: [{ name: { contains: filter.search } }, { key: { contains: filter.search } }] }
      : {};
    const db = tenantDb();
    const [items, total] = await Promise.all([
      db.role.findMany({
        where,
        include,
        orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
        ...filter,
      }),
      db.role.count({ where }),
    ]);
    return { items, total };
  },

  findById: (id: string) => tenantDb().role.findFirst({ where: { id }, include }),

  findByKey: (key: string) => tenantDb().role.findFirst({ where: { key }, select: { id: true } }),

  create: (data: {
    key: string;
    name: string;
    description: string | null;
    permissionIds: string[];
  }) =>
    tenantDb().$transaction(async (tx) => {
      const role = await tx.role.create({
        data: withTenant({
          key: data.key,
          name: data.name,
          description: data.description,
          isSystem: false,
        }),
      });
      await tx.rolePermission.createMany({
        data: data.permissionIds.map((permissionId) =>
          withTenant({ roleId: role.id, permissionId }),
        ),
      });
      return role.id;
    }),

  update: (
    id: string,
    data: { name?: string; description?: string | null; permissionIds?: string[] },
  ) =>
    tenantDb().$transaction(async (tx) => {
      const { permissionIds, ...fields } = data;
      if (Object.keys(fields).length > 0) await tx.role.update({ where: { id }, data: fields });
      if (permissionIds) {
        await tx.rolePermission.deleteMany({
          where: { roleId: id, permissionId: { notIn: permissionIds } },
        });
        await tx.rolePermission.createMany({
          data: permissionIds.map((permissionId) => withTenant({ roleId: id, permissionId })),
          skipDuplicates: true,
        });
      }
    }),

  softDelete: (id: string) =>
    tenantDb().role.update({ where: { id }, data: { deletedAt: new Date() } }),
};

import type { Prisma } from '@prisma/client';
import type { PageWindow } from '../../core/http/pagination';
import { andScope } from '../../core/authz';
import { tenantDb, withTenant } from '../../core/tenancy';

export interface GroupListFilter extends PageWindow {
  /** Authorization scope fragment from `scopeWhere` (core/authz). */
  scope?: Record<string, unknown> | undefined;
  search?: string | undefined;
}

export const groupRepository = {
  async list(filter: GroupListFilter) {
    const db = tenantDb();
    const base: Prisma.GroupWhereInput = filter.search
      ? { OR: [{ name: { contains: filter.search } }, { code: { contains: filter.search } }] }
      : {};
    const where = andScope(base, filter.scope);
    const [items, total] = await Promise.all([
      db.group.findMany({ where, skip: filter.skip, take: filter.take, orderBy: { name: 'asc' } }),
      db.group.count({ where }),
    ]);
    return { items, total };
  },
  findById: (id: string) => tenantDb().group.findUnique({ where: { id } }),
  create: (data: Omit<Prisma.GroupUncheckedCreateInput, 'organizationId'>) =>
    tenantDb().group.create({ data: withTenant(data) }),
  update: (id: string, data: Prisma.GroupUncheckedUpdateInput) =>
    tenantDb().group.update({ where: { id }, data }),
  softDelete: (id: string) =>
    tenantDb().group.update({ where: { id }, data: { deletedAt: new Date() } }),
  countInstitutions: (groupId: string) => tenantDb().institution.count({ where: { groupId } }),
};

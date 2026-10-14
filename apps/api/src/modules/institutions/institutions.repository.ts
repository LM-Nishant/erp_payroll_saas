import type { Prisma } from '@prisma/client';
import type { PageWindow } from '../../core/http/pagination';
import { andScope } from '../../core/authz';
import { tenantDb, withTenant } from '../../core/tenancy';

export interface InstitutionListFilter extends PageWindow {
  /** Authorization scope fragment from `scopeWhere` (core/authz). */
  scope?: Record<string, unknown> | undefined;
  search?: string | undefined;
  groupId?: string | undefined;
  independent?: boolean | undefined;
}

export const institutionRepository = {
  async list(filter: InstitutionListFilter) {
    const db = tenantDb();
    const base: Prisma.InstitutionWhereInput = {
      ...(filter.search
        ? { OR: [{ name: { contains: filter.search } }, { code: { contains: filter.search } }] }
        : {}),
      ...(filter.groupId ? { groupId: filter.groupId } : {}),
      ...(filter.independent === true ? { groupId: null } : {}),
      ...(filter.independent === false ? { groupId: { not: null } } : {}),
    };
    const where = andScope(base, filter.scope);
    const [items, total] = await Promise.all([
      db.institution.findMany({
        where,
        skip: filter.skip,
        take: filter.take,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
      db.institution.count({ where }),
    ]);
    return { items, total };
  },
  findById: (id: string) => tenantDb().institution.findUnique({ where: { id } }),
  create: (data: Omit<Prisma.InstitutionUncheckedCreateInput, 'organizationId'>) =>
    tenantDb().institution.create({ data: withTenant(data) }),
  update: (id: string, data: Prisma.InstitutionUncheckedUpdateInput) =>
    tenantDb().institution.update({ where: { id }, data }),
  softDelete: (id: string) =>
    tenantDb().institution.update({ where: { id }, data: { deletedAt: new Date() } }),
  async countChildren(institutionId: string) {
    const db = tenantDb();
    const [campuses, departments] = await Promise.all([
      db.campus.count({ where: { institutionId } }),
      db.department.count({ where: { institutionId } }),
    ]);
    return campuses + departments;
  },
};

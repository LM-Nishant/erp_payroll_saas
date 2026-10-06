import type { Prisma } from '@prisma/client';
import type { PageWindow } from '../../core/http/pagination';
import { andScope } from '../../core/authz';
import { tenantDb, withTenant } from '../../core/tenancy';

export interface CampusListFilter extends PageWindow {
  /** Authorization scope fragment from `scopeWhere` (core/authz). */
  scope?: Record<string, unknown> | undefined;
  search?: string | undefined;
  institutionId?: string | undefined;
}

export const campusRepository = {
  async list(filter: CampusListFilter) {
    const db = tenantDb();
    const base: Prisma.CampusWhereInput = {
      ...(filter.search
        ? { OR: [{ name: { contains: filter.search } }, { code: { contains: filter.search } }] }
        : {}),
      ...(filter.institutionId ? { institutionId: filter.institutionId } : {}),
    };
    const where = andScope(base, filter.scope);
    const [items, total] = await Promise.all([
      db.campus.findMany({ where, skip: filter.skip, take: filter.take, orderBy: { name: 'asc' } }),
      db.campus.count({ where }),
    ]);
    return { items, total };
  },
  findById: (id: string) => tenantDb().campus.findUnique({ where: { id } }),
  create: (data: Omit<Prisma.CampusUncheckedCreateInput, 'organizationId'>) =>
    tenantDb().campus.create({ data: withTenant(data) }),
  update: (id: string, data: Prisma.CampusUncheckedUpdateInput) =>
    tenantDb().campus.update({ where: { id }, data }),
  softDelete: (id: string) =>
    tenantDb().campus.update({ where: { id }, data: { deletedAt: new Date() } }),
  async countChildren(campusId: string) {
    const db = tenantDb();
    const [departments, sections] = await Promise.all([
      db.department.count({ where: { campusId } }),
      db.classSection.count({ where: { campusId } }),
    ]);
    return departments + sections;
  },
};

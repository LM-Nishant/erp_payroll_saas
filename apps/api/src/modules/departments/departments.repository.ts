import type { Prisma } from '@prisma/client';
import type { PageWindow } from '../../core/http/pagination';
import { andScope } from '../../core/authz';
import { tenantDb, withTenant } from '../../core/tenancy';

export interface DepartmentListFilter extends PageWindow {
  /** Authorization scope fragment from `scopeWhere` (core/authz). */
  scope?: Record<string, unknown> | undefined;
  search?: string | undefined;
  institutionId?: string | undefined;
  campusId?: string | undefined;
}

export const departmentRepository = {
  async list(filter: DepartmentListFilter) {
    const db = tenantDb();
    const base: Prisma.DepartmentWhereInput = {
      ...(filter.search
        ? { OR: [{ name: { contains: filter.search } }, { code: { contains: filter.search } }] }
        : {}),
      ...(filter.institutionId ? { institutionId: filter.institutionId } : {}),
      ...(filter.campusId ? { campusId: filter.campusId } : {}),
    };
    const where = andScope(base, filter.scope);
    const [items, total] = await Promise.all([
      db.department.findMany({
        where,
        skip: filter.skip,
        take: filter.take,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
      db.department.count({ where }),
    ]);
    return { items, total };
  },
  findById: (id: string) => tenantDb().department.findUnique({ where: { id } }),
  create: (data: Omit<Prisma.DepartmentUncheckedCreateInput, 'organizationId'>) =>
    tenantDb().department.create({ data: withTenant(data) }),
  update: (id: string, data: Prisma.DepartmentUncheckedUpdateInput) =>
    tenantDb().department.update({ where: { id }, data }),
  softDelete: (id: string) =>
    tenantDb().department.update({ where: { id }, data: { deletedAt: new Date() } }),
  countPrograms: (departmentId: string) => tenantDb().program.count({ where: { departmentId } }),
};

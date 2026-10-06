import type { Prisma } from '@prisma/client';
import type { PageWindow } from '../../core/http/pagination';
import { andScope } from '../../core/authz';
import { tenantDb, withTenant } from '../../core/tenancy';

export interface ClassSectionListFilter extends PageWindow {
  /** Authorization scope fragment from `scopeWhere` (core/authz). */
  scope?: Record<string, unknown> | undefined;
  search?: string | undefined;
  institutionId?: string | undefined;
  departmentId?: string | undefined;
  programId?: string | undefined;
  campusId?: string | undefined;
  academicYear?: string | undefined;
}

export const classSectionRepository = {
  async list(filter: ClassSectionListFilter) {
    const db = tenantDb();
    const base: Prisma.ClassSectionWhereInput = {
      ...(filter.search
        ? { OR: [{ name: { contains: filter.search } }, { code: { contains: filter.search } }] }
        : {}),
      ...(filter.institutionId ? { institutionId: filter.institutionId } : {}),
      ...(filter.departmentId ? { departmentId: filter.departmentId } : {}),
      ...(filter.programId ? { programId: filter.programId } : {}),
      ...(filter.campusId ? { campusId: filter.campusId } : {}),
      ...(filter.academicYear ? { academicYear: filter.academicYear } : {}),
    };
    const where = andScope(base, filter.scope);
    const [items, total] = await Promise.all([
      db.classSection.findMany({
        where,
        skip: filter.skip,
        take: filter.take,
        orderBy: [{ academicYear: 'desc' }, { name: 'asc' }],
      }),
      db.classSection.count({ where }),
    ]);
    return { items, total };
  },
  findById: (id: string) => tenantDb().classSection.findUnique({ where: { id } }),
  create: (data: Omit<Prisma.ClassSectionUncheckedCreateInput, 'organizationId'>) =>
    tenantDb().classSection.create({ data: withTenant(data) }),
  update: (id: string, data: Prisma.ClassSectionUncheckedUpdateInput) =>
    tenantDb().classSection.update({ where: { id }, data }),
  softDelete: (id: string) =>
    tenantDb().classSection.update({ where: { id }, data: { deletedAt: new Date() } }),
};

import type { Prisma } from '@prisma/client';
import type { PageWindow } from '../../core/http/pagination';
import { andScope } from '../../core/authz';
import { tenantDb, withTenant } from '../../core/tenancy';

export interface ProgramListFilter extends PageWindow {
  /** Authorization scope fragment from `scopeWhere` (core/authz). */
  scope?: Record<string, unknown> | undefined;
  search?: string | undefined;
  institutionId?: string | undefined;
  departmentId?: string | undefined;
}

export const programRepository = {
  async list(filter: ProgramListFilter) {
    const db = tenantDb();
    const base: Prisma.ProgramWhereInput = {
      ...(filter.search
        ? { OR: [{ name: { contains: filter.search } }, { code: { contains: filter.search } }] }
        : {}),
      ...(filter.institutionId ? { institutionId: filter.institutionId } : {}),
      ...(filter.departmentId ? { departmentId: filter.departmentId } : {}),
    };
    const where = andScope(base, filter.scope);
    const [items, total] = await Promise.all([
      db.program.findMany({
        where,
        skip: filter.skip,
        take: filter.take,
        orderBy: { name: 'asc' },
      }),
      db.program.count({ where }),
    ]);
    return { items, total };
  },
  findById: (id: string) => tenantDb().program.findUnique({ where: { id } }),
  create: (data: Omit<Prisma.ProgramUncheckedCreateInput, 'organizationId'>) =>
    tenantDb().program.create({ data: withTenant(data) }),
  update: (id: string, data: Prisma.ProgramUncheckedUpdateInput) =>
    tenantDb().program.update({ where: { id }, data }),
  softDelete: (id: string) =>
    tenantDb().program.update({ where: { id }, data: { deletedAt: new Date() } }),
  countClassSections: (programId: string) =>
    tenantDb().classSection.count({ where: { programId } }),
};

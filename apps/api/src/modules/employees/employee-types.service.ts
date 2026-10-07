import type {
  CreateEmployeeTypeInput,
  EmployeeTypeDto,
  UpdateEmployeeTypeInput,
} from '@erp/shared';
import type { z } from 'zod';
import type { listEmployeeTypesQuerySchema } from '@erp/shared';
import type { EmployeeType, Prisma } from '@prisma/client';
import { audit } from '../../core/audit';
import { authorize, currentPrincipal } from '../../core/authz';
import { ConflictError, NotFoundError } from '../../core/http/errors';
import { toPageWindow } from '../../core/http/pagination';
import { tenantDb, withTenant } from '../../core/tenancy';
import { toEmployeeTypeDto } from './employees.mappers';

type ListQuery = z.infer<typeof listEmployeeTypesQuerySchema>;

/**
 * Organization-defined employee types (e.g. "Consultant", "Trainee", "Probationer"). Each maps to
 * a base `category` (EmploymentType) that payroll / leave / attendance rules keep using, so
 * custom types never break statutory or policy logic. Org-wide masters guarded by
 * `designation.manage` (HR masters).
 */

const auditView = (t: EmployeeType) => ({
  code: t.code,
  name: t.name,
  category: t.category,
  status: t.status,
});

async function load(id: string) {
  const t = await tenantDb().employeeType.findUnique({ where: { id } });
  if (!t) throw new NotFoundError('Employee type');
  return t;
}

async function countsFor(ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await tenantDb().employee.groupBy({
    by: ['employeeTypeId'],
    where: { employeeTypeId: { in: ids } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.employeeTypeId ?? '', r._count._all]));
}

export const employeeTypeService = {
  async list(query: ListQuery): Promise<{ items: EmployeeTypeDto[]; total: number }> {
    const where: Prisma.EmployeeTypeWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? { OR: [{ name: { contains: query.search } }, { code: { contains: query.search } }] }
        : {}),
    };
    const db = tenantDb();
    const [rows, total] = await Promise.all([
      db.employeeType.findMany({ where, orderBy: { name: 'asc' }, ...toPageWindow(query) }),
      db.employeeType.count({ where }),
    ]);
    const counts = await countsFor(rows.map((r) => r.id));
    return { items: rows.map((r) => toEmployeeTypeDto(r, counts.get(r.id) ?? 0)), total };
  },

  async create(input: CreateEmployeeTypeInput) {
    await authorize(currentPrincipal(), 'designation.manage', {});
    const db = tenantDb();
    if (await db.employeeType.findFirst({ where: { code: input.code }, select: { id: true } })) {
      throw new ConflictError('Employee type code already exists', { field: 'code' });
    }
    const t = await db.employeeType.create({
      data: withTenant({
        code: input.code,
        name: input.name,
        category: input.category,
        description: input.description ?? null,
        status: input.status,
      }),
    });
    await audit.record({
      action: 'employee_type.create',
      entityType: 'employee_type',
      entityId: t.id,
      after: auditView(t),
    });
    return toEmployeeTypeDto(t);
  },

  async update(id: string, input: UpdateEmployeeTypeInput) {
    await authorize(currentPrincipal(), 'designation.manage', {});
    const before = await load(id);
    const db = tenantDb();
    if (input.code && input.code !== before.code) {
      const clash = await db.employeeType.findFirst({
        where: { code: input.code, id: { not: id } },
        select: { id: true },
      });
      if (clash) throw new ConflictError('Employee type code already exists', { field: 'code' });
    }
    if (input.category && input.category !== before.category) {
      const inUse = await db.employee.count({ where: { employeeTypeId: id } });
      if (inUse > 0) {
        throw new ConflictError(
          'The category of a type in use cannot change; create a new type instead',
          { employees: inUse },
        );
      }
    }
    const after = await db.employeeType.update({
      where: { id },
      data: {
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
    });
    await audit.record({
      action: 'employee_type.update',
      entityType: 'employee_type',
      entityId: id,
      before: auditView(before),
      after: auditView(after),
    });
    const counts = await countsFor([id]);
    return toEmployeeTypeDto(after, counts.get(id) ?? 0);
  },

  async remove(id: string) {
    await authorize(currentPrincipal(), 'designation.manage', {});
    const before = await load(id);
    const inUse = await tenantDb().employee.count({ where: { employeeTypeId: id } });
    if (inUse > 0) {
      throw new ConflictError('Employee type is assigned to employees; mark it inactive instead', {
        employees: inUse,
      });
    }
    await tenantDb().employeeType.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit.record({
      action: 'employee_type.delete',
      entityType: 'employee_type',
      entityId: id,
      before: auditView(before),
    });
  },
};

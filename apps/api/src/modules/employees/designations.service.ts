import type { CreateDesignationInput, DesignationDto, UpdateDesignationInput } from '@erp/shared';
import type { z } from 'zod';
import type { listDesignationsQuerySchema } from '@erp/shared';
import type { Designation, Prisma } from '@prisma/client';
import { audit } from '../../core/audit';
import {
  accessFor,
  authorize,
  can,
  currentPrincipal,
  hasPermission,
  type ResourceScope,
} from '../../core/authz';
import { ConflictError, InvalidReferenceError, NotFoundError } from '../../core/http/errors';
import { tenantDb, withTenant } from '../../core/tenancy';
import { designationInclude, toDesignationDto } from './employees.mappers';

type ListQuery = z.infer<typeof listDesignationsQuerySchema>;

/** Designations are org-wide (no group/institution), group-level or institution-specific. */
async function resourceOf(d: {
  groupId: string | null;
  institutionId: string | null;
}): Promise<ResourceScope> {
  if (d.institutionId) {
    const inst = await tenantDb().institution.findUnique({
      where: { id: d.institutionId },
      select: { id: true, groupId: true },
    });
    if (!inst) throw new InvalidReferenceError('institutionId', 'Institution');
    return { groupId: inst.groupId, institutionId: inst.id };
  }
  if (d.groupId) {
    const group = await tenantDb().group.findUnique({
      where: { id: d.groupId },
      select: { id: true },
    });
    if (!group) throw new InvalidReferenceError('groupId', 'Group');
    return { groupId: group.id };
  }
  return {};
}

/**
 * Org-wide designations are visible to anyone with `designation.view`; institution ones need
 * scope over the institution; group ones are visible to anyone holding the permission on the
 * group or on any institution inside it (institution HR picks group-level designations).
 */
async function visible(d: Designation): Promise<boolean> {
  if (!d.groupId && !d.institutionId) return true;
  const principal = currentPrincipal();
  if (await can(principal, 'designation.view', await resourceOf(d))) return true;
  if (d.institutionId || !d.groupId || !hasPermission(principal, 'designation.view')) return false;
  const access = await accessFor(principal, 'designation.view');
  if (access.institutionIds.size === 0) return false;
  const inGroup = await tenantDb().institution.count({
    where: { groupId: d.groupId, id: { in: [...access.institutionIds] } },
  });
  return inGroup > 0;
}

async function departmentOf(id: string | null | undefined) {
  if (!id) return null;
  const dept = await tenantDb().department.findUnique({
    where: { id },
    select: { id: true, institutionId: true },
  });
  if (!dept) throw new InvalidReferenceError('departmentId', 'Department');
  return dept;
}

async function load(id: string) {
  const d = await tenantDb().designation.findUnique({ where: { id }, include: designationInclude });
  if (!d || !(await visible(d))) throw new NotFoundError('Designation');
  return d;
}

const auditView = (d: Designation) => ({
  code: d.code,
  name: d.name,
  groupId: d.groupId,
  institutionId: d.institutionId,
  departmentId: d.departmentId,
  category: d.category,
  level: d.level,
  status: d.status,
});

export const designationService = {
  async list(query: ListQuery): Promise<{ items: DesignationDto[]; total: number }> {
    const where: Prisma.DesignationWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      AND: [
        ...(query.institutionId
          ? [{ OR: [{ institutionId: query.institutionId }, { institutionId: null }] }]
          : []),
        ...(query.departmentId
          ? [{ OR: [{ departmentId: query.departmentId }, { departmentId: null }] }]
          : []),
        ...(query.search
          ? [{ OR: [{ name: { contains: query.search } }, { code: { contains: query.search } }] }]
          : []),
      ],
    };
    // Designation masters are small; filter per row for scope, then page in memory.
    const rows = await tenantDb().designation.findMany({
      where,
      include: designationInclude,
      orderBy: [{ level: 'desc' }, { name: 'asc' }],
      take: 5000,
    });
    const allowed: typeof rows = [];
    for (const d of rows) if (await visible(d)) allowed.push(d);
    const start = (query.page - 1) * query.pageSize;
    return {
      items: allowed.slice(start, start + query.pageSize).map(toDesignationDto),
      total: allowed.length,
    };
  },

  async get(id: string) {
    return toDesignationDto(await load(id));
  },

  async create(rawInput: CreateDesignationInput) {
    const department = await departmentOf(rawInput.departmentId);
    const input = department
      ? { ...rawInput, institutionId: department.institutionId, groupId: null }
      : rawInput;
    const resource = await resourceOf({
      groupId: input.institutionId ? null : (input.groupId ?? null),
      institutionId: input.institutionId ?? null,
    });
    await authorize(currentPrincipal(), 'designation.manage', resource);
    const db = tenantDb();
    if (await db.designation.findFirst({ where: { code: input.code }, select: { id: true } })) {
      throw new ConflictError('Designation code already exists', { field: 'code' });
    }
    const d = await db.designation.create({
      data: withTenant({
        code: input.code,
        name: input.name,
        groupId: (resource.groupId as string | null | undefined) ?? null,
        institutionId: input.institutionId ?? null,
        departmentId: department?.id ?? null,
        category: input.category ?? null,
        level: input.level ?? null,
        description: input.description ?? null,
        status: input.status,
      }),
      include: designationInclude,
    });
    await audit.record({
      action: 'designation.create',
      entityType: 'designation',
      entityId: d.id,
      after: auditView(d),
    });
    return toDesignationDto(d);
  },

  async update(id: string, input: UpdateDesignationInput) {
    const before = await load(id);
    await authorize(currentPrincipal(), 'designation.manage', await resourceOf(before));
    const department =
      input.departmentId !== undefined ? await departmentOf(input.departmentId) : undefined;
    if (department && before.institutionId && before.institutionId !== department.institutionId) {
      throw new InvalidReferenceError('departmentId', 'Department');
    }
    if (department && !before.institutionId) {
      // An org/group-wide role tied to a department becomes specific to that institution.
      await authorize(
        currentPrincipal(),
        'designation.manage',
        await resourceOf({ groupId: null, institutionId: department.institutionId }),
      );
    }
    if (input.code && input.code !== before.code) {
      const clash = await tenantDb().designation.findFirst({
        where: { code: input.code, id: { not: id } },
        select: { id: true },
      });
      if (clash) throw new ConflictError('Designation code already exists', { field: 'code' });
    }
    const after = await tenantDb().designation.update({
      where: { id },
      data: {
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(department !== undefined ? { departmentId: department?.id ?? null } : {}),
        ...(department ? { institutionId: department.institutionId, groupId: null } : {}),
        ...(input.category !== undefined ? { category: input.category ?? null } : {}),
        ...(input.level !== undefined ? { level: input.level ?? null } : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
      include: designationInclude,
    });
    await audit.record({
      action: 'designation.update',
      entityType: 'designation',
      entityId: id,
      before: auditView(before),
      after: auditView(after),
    });
    return toDesignationDto(after);
  },

  async remove(id: string) {
    const before = await load(id);
    await authorize(currentPrincipal(), 'designation.manage', await resourceOf(before));
    const inUse = await tenantDb().employee.count({ where: { designationId: id } });
    if (inUse > 0) {
      throw new ConflictError('Designation is assigned to employees; mark it inactive instead', {
        employees: inUse,
      });
    }
    await tenantDb().designation.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit.record({
      action: 'designation.delete',
      entityType: 'designation',
      entityId: id,
      before: auditView(before),
    });
  },
};

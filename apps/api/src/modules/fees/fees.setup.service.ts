import type { Prisma } from '@prisma/client';
import type {
  CreateConcessionInput,
  CreateFeeHeadInput,
  CreateFeeStructureInput,
  CreateLateRuleInput,
  FeeInstallmentInput,
  ListLateRulesQuery,
  UpdateConcessionInput,
  UpdateFeeHeadInput,
  UpdateFeeStructureInput,
  UpdateLateRuleInput,
} from '@erp/shared';
import { audit } from '../../core/audit';
import { andScope, authorize, can, currentPrincipal, scopeWhere } from '../../core/authz';
import { isUniqueViolation } from '../../core/db/helpers';
import {
  ConflictError,
  InvalidReferenceError,
  NotFoundError,
  ValidationError,
} from '../../core/http/errors';
import {
  toOptionalListResponse,
  toOptionalPageWindow,
  toPageWindow,
} from '../../core/http/pagination';
import { tenantDb, withTenant } from '../../core/tenancy';
import { institutionScope, type Tx } from '../finance/finance.ledger';
import { fromPaise, toPaise } from '../finance/finance.logic';
import { toDate } from '../finance/finance.mappers';
import {
  toConcessionDto,
  toFeeHeadDto,
  toLateRuleDto,
  toStructureDto,
  type StructureWithInstallments,
} from './fees.mappers';

const p = () => currentPrincipal();

/** Rows with an optional institutionId: org-wide rows are visible to every holder. */
async function optionalInstitutionScope(perm: string) {
  const scope = await scopeWhere(p(), perm, 'finance');
  return scope ? { OR: [scope, { institutionId: null }] } : undefined;
}

/* ------------------------------------ Fee heads ---------------------------------------- */

export const feeHeadService = {
  async list(query: {
    page: number;
    pageSize: number;
    search?: string;
    institutionId?: string;
    category?: string;
    active?: 'true' | 'false';
  }) {
    const where: Prisma.FeeHeadWhereInput = {
      AND: [
        query.institutionId
          ? { OR: [{ institutionId: query.institutionId }, { institutionId: null }] }
          : {},
        query.search
          ? { OR: [{ name: { contains: query.search } }, { code: { contains: query.search } }] }
          : {},
        query.category ? { category: query.category } : {},
        query.active ? { active: query.active === 'true' } : {},
      ],
    };
    const scoped = andScope(where, await optionalInstitutionScope('fee.view'));
    const db = tenantDb();
    const [rows, total] = await Promise.all([
      db.feeHead.findMany({
        where: scoped,
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
        ...toPageWindow(query),
      }),
      db.feeHead.count({ where: scoped }),
    ]);
    return { items: rows.map(toFeeHeadDto), total };
  },

  async create(input: CreateFeeHeadInput) {
    const scope = input.institutionId ? await institutionScope(input.institutionId) : null;
    await authorize(p(), 'fee.manage', scope ?? {});
    const db = tenantDb();
    const dup = await db.feeHead.findFirst({
      where: { code: input.code, institutionId: input.institutionId ?? null },
    });
    if (dup) throw new ConflictError('A fee head with this code exists');
    if (input.incomeAccountId) await assertIncomeAccount(input.incomeAccountId);
    try {
      const created = await db.feeHead.create({
        data: withTenant({
          groupId: scope?.groupId ?? null,
          institutionId: scope?.institutionId ?? null,
          code: input.code,
          name: input.name,
          category: input.category,
          refundable: input.refundable,
          taxRate: input.taxRate,
          incomeAccountId: input.incomeAccountId ?? null,
          sortOrder: input.sortOrder,
          active: input.active,
        }),
      });
      await audit.record({
        action: 'fee_head.created',
        entityType: 'fee_head',
        entityId: created.id,
        after: toFeeHeadDto(created),
      });
      return toFeeHeadDto(created);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError('A fee head with this code exists');
      throw err;
    }
  },

  async update(id: string, input: UpdateFeeHeadInput) {
    const before = await loadHead(id);
    await authorize(p(), 'fee.manage', before.institutionId ? before : {});
    if (input.incomeAccountId) await assertIncomeAccount(input.incomeAccountId);
    const updated = await tenantDb().feeHead.update({ where: { id }, data: input });
    await audit.record({
      action: 'fee_head.updated',
      entityType: 'fee_head',
      entityId: id,
      before: toFeeHeadDto(before),
      after: toFeeHeadDto(updated),
    });
    return toFeeHeadDto(updated);
  },

  async remove(id: string) {
    const before = await loadHead(id);
    await authorize(p(), 'fee.manage', before.institutionId ? before : {});
    const db = tenantDb();
    const [items, lines] = await Promise.all([
      db.feeStructureItem.count({ where: { feeHeadId: id } }),
      db.feeInvoiceLine.count({ where: { feeHeadId: id } }),
    ]);
    if (items > 0 || lines > 0) {
      throw new ConflictError('Fee head is used by structures or invoices; deactivate it instead');
    }
    await db.feeHead.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit.record({
      action: 'fee_head.deleted',
      entityType: 'fee_head',
      entityId: id,
      before: toFeeHeadDto(before),
    });
  },
};

async function loadHead(id: string) {
  const head = await tenantDb().feeHead.findUnique({ where: { id } });
  if (!head) throw new NotFoundError('Fee head');
  if (head.institutionId && !(await can(p(), 'fee.view', head))) {
    throw new NotFoundError('Fee head');
  }
  return head;
}

async function assertIncomeAccount(id: string) {
  const acc = await tenantDb().ledgerAccount.findUnique({ where: { id } });
  if (!acc || acc.type !== 'INCOME' || acc.isGroup) {
    throw new InvalidReferenceError('incomeAccountId', 'Income ledger account');
  }
}

/* ------------------------------------ Late-fee rules ----------------------------------- */

async function loadLateRule(id: string) {
  const rule = await tenantDb().feeLateRule.findUnique({ where: { id } });
  if (!rule || !(await can(p(), 'fee.view', rule))) throw new NotFoundError('Late-fee rule');
  return rule;
}

export const lateRuleService = {
  async list(query: ListLateRulesQuery = {}) {
    const where = andScope(
      query.institutionId ? { institutionId: query.institutionId } : {},
      await scopeWhere(p(), 'fee.view', 'finance'),
    );
    const [rows, total] = await Promise.all([
      tenantDb().feeLateRule.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        ...toOptionalPageWindow(query),
      }),
      tenantDb().feeLateRule.count({ where }),
    ]);
    return toOptionalListResponse(rows.map(toLateRuleDto), total, query);
  },

  async create(input: CreateLateRuleInput) {
    const scope = await institutionScope(input.institutionId);
    await authorize(p(), 'fee.manage', scope);
    const created = await tenantDb().feeLateRule.create({
      data: withTenant({
        groupId: scope.groupId,
        institutionId: scope.institutionId,
        name: input.name,
        mode: input.mode,
        amount: input.amount,
        graceDays: input.graceDays,
        maxAmount: input.maxAmount ?? null,
        active: input.active,
      }),
    });
    await audit.record({
      action: 'fee_late_rule.created',
      entityType: 'fee_late_rule',
      entityId: created.id,
      after: toLateRuleDto(created),
    });
    return toLateRuleDto(created);
  },

  async update(id: string, input: UpdateLateRuleInput) {
    const before = await loadLateRule(id);
    await authorize(p(), 'fee.manage', before);
    const updated = await tenantDb().feeLateRule.update({ where: { id }, data: input });
    await audit.record({
      action: 'fee_late_rule.updated',
      entityType: 'fee_late_rule',
      entityId: id,
      before: toLateRuleDto(before),
      after: toLateRuleDto(updated),
    });
    return toLateRuleDto(updated);
  },

  async remove(id: string) {
    const before = await loadLateRule(id);
    await authorize(p(), 'fee.manage', before);
    const used = await tenantDb().feeStructure.count({ where: { lateRuleId: id } });
    if (used > 0) throw new ConflictError('Late-fee rule is used by fee structures');
    await tenantDb().feeLateRule.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit.record({
      action: 'fee_late_rule.deleted',
      entityType: 'fee_late_rule',
      entityId: id,
      before: toLateRuleDto(before),
    });
  },
};

/* ------------------------------------ Structures --------------------------------------- */

const structureInclude = {
  installments: {
    include: { items: { include: { feeHead: { select: { name: true } } } } },
    orderBy: { seq: 'asc' },
  },
} as const;

export async function loadStructure(id: string, perm = 'fee.view') {
  const s = await tenantDb().feeStructure.findUnique({ where: { id }, include: structureInclude });
  if (!s || !(await can(p(), perm, s))) throw new NotFoundError('Fee structure');
  return s;
}

async function resolveStructureTarget(
  institutionId: string,
  programId: string | null | undefined,
  classSectionId: string | null | undefined,
) {
  const scope = await institutionScope(institutionId);
  const db = tenantDb();
  let campusId: string | null = null;
  let departmentId: string | null = null;
  let program = programId ?? null;
  if (classSectionId) {
    const cs = await db.classSection.findUnique({ where: { id: classSectionId } });
    if (!cs || cs.institutionId !== institutionId) {
      throw new InvalidReferenceError('classSectionId', 'Class section');
    }
    campusId = cs.campusId;
    departmentId = cs.departmentId;
    if (program && program !== cs.programId) {
      throw new ValidationError('classSectionId does not belong to programId');
    }
    program = cs.programId;
  } else if (program) {
    const pr = await db.program.findUnique({ where: { id: program } });
    if (!pr || pr.institutionId !== institutionId) {
      throw new InvalidReferenceError('programId', 'Program');
    }
    departmentId = pr.departmentId;
  }
  return {
    ...scope,
    campusId,
    departmentId,
    programId: program,
    classSectionId: classSectionId ?? null,
  };
}

async function validateInstallments(institutionId: string, installments: FeeInstallmentInput[]) {
  const headIds = [...new Set(installments.flatMap((i) => i.items.map((it) => it.feeHeadId)))];
  const heads = await tenantDb().feeHead.findMany({
    where: { id: { in: headIds }, OR: [{ institutionId }, { institutionId: null }] },
    select: { id: true },
  });
  const known = new Set(heads.map((h) => h.id));
  for (const id of headIds) {
    if (!known.has(id)) throw new InvalidReferenceError('installments.items.feeHeadId', 'Fee head');
  }
  for (const [i, inst] of installments.entries()) {
    const seen = new Set<string>();
    for (const it of inst.items) {
      if (seen.has(it.feeHeadId)) {
        throw new ValidationError(`Installment ${i + 1} lists a fee head twice`);
      }
      seen.add(it.feeHeadId);
    }
  }
  return fromPaise(
    installments.reduce((s, i) => s + i.items.reduce((t, it) => t + toPaise(it.amount), 0), 0),
  );
}

async function writeInstallments(tx: Tx, structureId: string, installments: FeeInstallmentInput[]) {
  for (const [idx, inst] of installments.entries()) {
    const row = await tx.feeInstallment.create({
      data: withTenant({
        structureId,
        seq: idx + 1,
        label: inst.label,
        dueDate: toDate(inst.dueDate),
      }),
    });
    await tx.feeStructureItem.createMany({
      data: inst.items.map((it) =>
        withTenant({
          structureId,
          installmentId: row.id,
          feeHeadId: it.feeHeadId,
          amount: it.amount,
        }),
      ),
    });
  }
}

async function assertLateRule(lateRuleId: string | null | undefined, institutionId: string) {
  if (!lateRuleId) return;
  const rule = await tenantDb().feeLateRule.findUnique({ where: { id: lateRuleId } });
  if (!rule || rule.institutionId !== institutionId) {
    throw new InvalidReferenceError('lateRuleId', 'Late-fee rule');
  }
}

export const feeStructureService = {
  async list(query: {
    page: number;
    pageSize: number;
    search?: string;
    institutionId?: string;
    academicYear?: string;
    classSectionId?: string;
    programId?: string;
    status?: string;
  }) {
    const where: Prisma.FeeStructureWhereInput = {
      ...(query.institutionId ? { institutionId: query.institutionId } : {}),
      ...(query.academicYear ? { academicYear: query.academicYear } : {}),
      ...(query.classSectionId ? { classSectionId: query.classSectionId } : {}),
      ...(query.programId ? { programId: query.programId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? { OR: [{ name: { contains: query.search } }, { code: { contains: query.search } }] }
        : {}),
    };
    const scoped = andScope(where, await scopeWhere(p(), 'fee.view', 'finance'));
    const db = tenantDb();
    const [rows, total] = await Promise.all([
      db.feeStructure.findMany({
        where: scoped,
        include: structureInclude,
        orderBy: [{ academicYear: 'desc' }, { code: 'asc' }],
        ...toPageWindow(query),
      }),
      db.feeStructure.count({ where: scoped }),
    ]);
    return { items: rows.map((s) => toStructureDto(s as StructureWithInstallments)), total };
  },

  async get(id: string) {
    return toStructureDto((await loadStructure(id)) as StructureWithInstallments);
  },

  async create(input: CreateFeeStructureInput) {
    const target = await resolveStructureTarget(
      input.institutionId,
      input.programId,
      input.classSectionId,
    );
    await authorize(p(), 'fee.manage', target);
    await assertLateRule(input.lateRuleId, input.institutionId);
    const totalAmount = await validateInstallments(input.institutionId, input.installments);
    try {
      const created = await tenantDb().$transaction(async (tx) => {
        const s = await tx.feeStructure.create({
          data: withTenant({
            groupId: target.groupId,
            institutionId: target.institutionId,
            campusId: target.campusId,
            departmentId: target.departmentId,
            programId: target.programId,
            classSectionId: target.classSectionId,
            academicYear: input.academicYear,
            code: input.code,
            name: input.name,
            status: input.status,
            lateRuleId: input.lateRuleId ?? null,
            totalAmount,
            notes: input.notes ?? null,
          }),
        });
        await writeInstallments(tx, s.id, input.installments);
        return s;
      });
      const dto = toStructureDto((await loadStructure(created.id)) as StructureWithInstallments);
      await audit.record({
        action: 'fee_structure.created',
        entityType: 'fee_structure',
        entityId: created.id,
        after: dto,
      });
      return dto;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictError('A fee structure with this code exists for the academic year');
      }
      throw err;
    }
  },

  async update(id: string, input: UpdateFeeStructureInput) {
    const before = await loadStructure(id);
    await authorize(p(), 'fee.manage', before);
    const target =
      input.programId !== undefined || input.classSectionId !== undefined
        ? await resolveStructureTarget(
            before.institutionId,
            input.programId !== undefined ? input.programId : before.programId,
            input.classSectionId !== undefined ? input.classSectionId : before.classSectionId,
          )
        : null;
    if (target) await authorize(p(), 'fee.manage', target);
    if (input.lateRuleId) await assertLateRule(input.lateRuleId, before.institutionId);
    const db = tenantDb();
    let totalAmount: number | undefined;
    if (input.installments) {
      const invoiced = await db.feeInvoice.count({ where: { structureId: id } });
      if (invoiced > 0) {
        throw new ConflictError(
          'Invoices were generated from this structure; installments can no longer change',
        );
      }
      totalAmount = await validateInstallments(before.institutionId, input.installments);
    }
    await db.$transaction(async (tx) => {
      await tx.feeStructure.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...(input.lateRuleId !== undefined ? { lateRuleId: input.lateRuleId } : {}),
          ...(target
            ? {
                campusId: target.campusId,
                departmentId: target.departmentId,
                programId: target.programId,
                classSectionId: target.classSectionId,
              }
            : {}),
          ...(totalAmount !== undefined ? { totalAmount } : {}),
        },
      });
      if (input.installments) {
        await tx.feeStructureItem.deleteMany({ where: { structureId: id } });
        await tx.feeInstallment.deleteMany({ where: { structureId: id } });
        await writeInstallments(tx, id, input.installments);
      }
    });
    const after = toStructureDto((await loadStructure(id)) as StructureWithInstallments);
    await audit.record({
      action: 'fee_structure.updated',
      entityType: 'fee_structure',
      entityId: id,
      before: toStructureDto(before as StructureWithInstallments),
      after,
    });
    return after;
  },

  async remove(id: string) {
    const before = await loadStructure(id);
    await authorize(p(), 'fee.manage', before);
    const invoiced = await tenantDb().feeInvoice.count({ where: { structureId: id } });
    if (invoiced > 0) throw new ConflictError('Invoices exist for this structure; archive it');
    await tenantDb().feeStructure.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit.record({
      action: 'fee_structure.deleted',
      entityType: 'fee_structure',
      entityId: id,
      before: toStructureDto(before as StructureWithInstallments),
    });
  },
};

/* ------------------------------------ Concessions -------------------------------------- */

async function loadConcession(id: string) {
  const c = await tenantDb().feeConcession.findUnique({ where: { id } });
  if (!c || !(await can(p(), 'fee.view', c))) throw new NotFoundError('Concession');
  return c;
}

export const concessionService = {
  async list(query: {
    page: number;
    pageSize: number;
    search?: string;
    institutionId?: string;
    studentId?: string;
    appliesTo?: string;
  }) {
    const where: Prisma.FeeConcessionWhereInput = {
      ...(query.institutionId ? { institutionId: query.institutionId } : {}),
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.appliesTo ? { appliesTo: query.appliesTo } : {}),
      ...(query.search ? { name: { contains: query.search } } : {}),
    };
    const scoped = andScope(where, await scopeWhere(p(), 'fee.view', 'finance'));
    const db = tenantDb();
    const [rows, total] = await Promise.all([
      db.feeConcession.findMany({
        where: scoped,
        orderBy: [{ createdAt: 'desc' }],
        ...toPageWindow(query),
      }),
      db.feeConcession.count({ where: scoped }),
    ]);
    const studentIds = rows.map((r) => r.studentId).filter((v): v is string => !!v);
    const students = studentIds.length
      ? await db.student.findMany({
          where: { id: { in: studentIds } },
          select: { id: true, displayName: true },
        })
      : [];
    const names = new Map(students.map((s) => [s.id, s.displayName]));
    return {
      items: rows.map((r) => toConcessionDto(r, r.studentId ? names.get(r.studentId) : null)),
      total,
    };
  },

  async create(input: CreateConcessionInput) {
    const db = tenantDb();
    let scope: {
      groupId: string | null;
      institutionId: string;
      campusId: string | null;
      departmentId: string | null;
    };
    let studentName: string | null = null;
    if (input.appliesTo === 'STUDENT') {
      const student = await db.student.findUnique({ where: { id: input.studentId as string } });
      if (!student) throw new InvalidReferenceError('studentId', 'Student');
      if (input.institutionId && input.institutionId !== student.institutionId) {
        throw new ValidationError('studentId does not belong to institutionId');
      }
      scope = {
        groupId: student.groupId,
        institutionId: student.institutionId,
        campusId: student.campusId,
        departmentId: student.departmentId,
      };
      studentName = student.displayName;
    } else {
      const s = await institutionScope(input.institutionId as string);
      scope = { ...s, campusId: null, departmentId: null };
    }
    await authorize(p(), 'fee.concession', scope);
    if (input.feeHeadId) {
      const head = await db.feeHead.findUnique({ where: { id: input.feeHeadId } });
      if (!head || (head.institutionId && head.institutionId !== scope.institutionId)) {
        throw new InvalidReferenceError('feeHeadId', 'Fee head');
      }
    }
    const created = await db.feeConcession.create({
      data: withTenant({
        ...scope,
        name: input.name,
        kind: input.appliesTo === 'SIBLING' ? 'SIBLING' : input.kind,
        appliesTo: input.appliesTo,
        studentId: input.appliesTo === 'STUDENT' ? (input.studentId ?? null) : null,
        category: input.appliesTo === 'CATEGORY' ? (input.category ?? null) : null,
        feeHeadId: input.feeHeadId ?? null,
        valueType: input.valueType,
        value: input.value,
        academicYear: input.academicYear ?? null,
        reason: input.reason ?? null,
        active: input.active,
        approvedByUserId: p().userId ?? null,
      }),
    });
    const dto = toConcessionDto(created, studentName);
    await audit.record({
      action: 'fee_concession.created',
      entityType: 'fee_concession',
      entityId: created.id,
      after: dto,
    });
    return dto;
  },

  async update(id: string, input: UpdateConcessionInput) {
    const before = await loadConcession(id);
    await authorize(p(), 'fee.concession', before);
    if (input.valueType === 'PERCENT' || (!input.valueType && before.valueType === 'PERCENT')) {
      const v = input.value ?? Number(before.value);
      if (v > 100) throw new ValidationError('Percent must be ≤ 100');
    }
    const updated = await tenantDb().feeConcession.update({ where: { id }, data: input });
    await audit.record({
      action: 'fee_concession.updated',
      entityType: 'fee_concession',
      entityId: id,
      before: toConcessionDto(before),
      after: toConcessionDto(updated),
    });
    return toConcessionDto(updated);
  },

  async remove(id: string) {
    const before = await loadConcession(id);
    await authorize(p(), 'fee.concession', before);
    await tenantDb().feeConcession.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit.record({
      action: 'fee_concession.deleted',
      entityType: 'fee_concession',
      entityId: id,
      before: toConcessionDto(before),
    });
  },
};

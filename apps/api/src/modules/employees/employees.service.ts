import { randomUUID } from 'node:crypto';
import type {
  CreateEmployeeInput,
  EmployeeDetailDto,
  EmployeeHistoryDto,
  EmployeePersonalInput,
  ListEmployeesQuery,
  UpdateEmployeeInput,
  UpdateEmployeeProfileInput,
  UpsertEmployeeCodeSequenceInput,
} from '@erp/shared';
import type { Employee, EmployeeProfile, Prisma } from '@prisma/client';
import { DbNull, isUniqueViolation } from '../../core/db/helpers';
import { audit } from '../../core/audit';
import {
  andScope,
  authorize,
  can,
  currentPrincipal,
  findScopeHolders,
  hierarchyResource,
  hasPermission,
  scopeWhere,
} from '../../core/authz';
import { emit } from '../../core/events';
import { releaseLimit, withLimit } from '../../core/features';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  InvalidReferenceError,
  NotFoundError,
  ValidationError,
} from '../../core/http/errors';
import { toPageWindow } from '../../core/http/pagination';
import { publish } from '../../core/notifications';
import { currentOrganizationId, tenantDb, withTenant } from '../../core/tenancy';
import {
  assertDepartmentsInInstitution,
  resolveAssignment,
  type ResolvedAssignment,
} from './employees.assignment';
import {
  dateStr,
  dateStrOrNull,
  displayNameOf,
  employeeAuditView,
  employeeInclude,
  toDate,
  toDateOrNull,
  toEmployeeDto,
  todayStr,
  type EmployeeWithRefs,
} from './employees.mappers';
import { decryptSensitive, maskedOf, sealSensitivePatch } from './employees.sensitive';

type Db = ReturnType<typeof tenantDb>;
type Tx = Parameters<Parameters<Db['$transaction']>[0]>[0];

/* --------------------------------- Access helpers --------------------------------------- */

/** Load an employee visible to the caller (`employee.view` in scope) or 404. */
export async function loadVisibleEmployee(id: string): Promise<EmployeeWithRefs> {
  const employee = await tenantDb().employee.findUnique({
    where: { id },
    include: employeeInclude,
  });
  if (
    !employee ||
    !(await can(currentPrincipal(), 'employee.view', hierarchyResource.employee(employee)))
  ) {
    throw new NotFoundError('Employee');
  }
  return employee;
}

/** Load (404 when invisible) and require `permission` in the employee's scope (403). */
export async function loadEmployeeFor(id: string, permission: string): Promise<EmployeeWithRefs> {
  const employee = await loadVisibleEmployee(id);
  await authorize(currentPrincipal(), permission, hierarchyResource.employee(employee));
  return employee;
}

export const assignmentResource = (a: ResolvedAssignment) => hierarchyResource.employee(a);

/** HR users (holders of `permission`) whose scope covers the given assignment. */
export async function hrRecipients(
  resource: { groupId: string | null; institutionId: string },
  permission = 'employee.update',
): Promise<string[]> {
  return findScopeHolders({ permission, resource });
}

/** Notification fan-out helper: skips when there is nobody to notify. */
export async function notify(
  eventKey: string,
  recipients: (string | null | undefined)[],
  input: {
    title: string;
    body?: string;
    link?: string;
    institutionId?: string | null;
    data?: Record<string, unknown>;
  },
): Promise<void> {
  const ids = [...new Set(recipients.filter((r): r is string => !!r))];
  if (ids.length === 0) return;
  await publish(eventKey, { recipients: ids, ...input });
}

export async function managerUserId(managerId: string | null): Promise<string | null> {
  if (!managerId) return null;
  const m = await tenantDb().employee.findUnique({
    where: { id: managerId },
    select: { userId: true },
  });
  return m?.userId ?? null;
}

/* --------------------------------- Code numbering --------------------------------------- */

const DEFAULT_SCOPE = 'default';

function formatCode(prefix: string, padding: number, n: number) {
  return `${prefix}${String(n).padStart(padding, '0')}`;
}

/**
 * Next employee code from the institution's sequence (else the org `default` sequence; a
 * sequence `<INSTITUTION CODE>-` / 4 digits is created on first use). Skips codes already taken.
 */
export async function nextEmployeeCode(institutionId: string): Promise<string> {
  const db = tenantDb();
  let seq =
    (await db.employeeCodeSequence.findFirst({ where: { scopeKey: institutionId } })) ??
    (await db.employeeCodeSequence.findFirst({ where: { scopeKey: DEFAULT_SCOPE } }));
  if (!seq) {
    const inst = await db.institution.findUnique({
      where: { id: institutionId },
      select: { code: true },
    });
    try {
      seq = await db.employeeCodeSequence.create({
        data: withTenant({
          scopeKey: institutionId,
          prefix: `${(inst?.code ?? 'EMP').toUpperCase()}-`,
          padding: 4,
        }),
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      seq = await db.employeeCodeSequence.findFirstOrThrow({ where: { scopeKey: institutionId } });
    }
  }
  for (let attempt = 0; attempt < 50; attempt += 1) {
    // Atomic increment; the number we own is the one before the increment.
    const updated = await db.employeeCodeSequence.update({
      where: { id: seq.id },
      data: { nextNumber: { increment: 1 } },
    });
    const code = formatCode(updated.prefix, updated.padding, updated.nextNumber - 1);
    if (!(await db.employee.findFirst({ where: { employeeCode: code }, select: { id: true } }))) {
      return code;
    }
  }
  throw new ConflictError('Could not allocate a free employee code; adjust the sequence');
}

/* --------------------------------- Profile mapping -------------------------------------- */

const PERSONAL_JSON = [
  'addresses',
  'emergencyContacts',
  'family',
  'qualifications',
  'experience',
] as const;

export function toPersonal(p: EmployeeProfile | null): EmployeePersonalInput {
  if (!p) return {};
  return {
    dateOfBirth: dateStrOrNull(p.dateOfBirth),
    gender: p.gender as EmployeePersonalInput['gender'],
    maritalStatus: p.maritalStatus as EmployeePersonalInput['maritalStatus'],
    bloodGroup: p.bloodGroup as EmployeePersonalInput['bloodGroup'],
    nationality: p.nationality,
    personalEmail: p.personalEmail,
    personalPhone: p.personalPhone,
    addresses: (p.addresses ?? null) as EmployeePersonalInput['addresses'],
    emergencyContacts: (p.emergencyContacts ?? null) as EmployeePersonalInput['emergencyContacts'],
    family: (p.family ?? null) as EmployeePersonalInput['family'],
    qualifications: (p.qualifications ?? null) as EmployeePersonalInput['qualifications'],
    experience: (p.experience ?? null) as EmployeePersonalInput['experience'],
  };
}

/** Personal input → profile columns (`undefined` keeps, `null` clears). */
export function personalData(
  input: EmployeePersonalInput,
): Prisma.EmployeeProfileUncheckedUpdateInput {
  const data: Prisma.EmployeeProfileUncheckedUpdateInput = {};
  if (input.dateOfBirth !== undefined) data.dateOfBirth = toDateOrNull(input.dateOfBirth);
  for (const k of [
    'gender',
    'maritalStatus',
    'bloodGroup',
    'nationality',
    'personalEmail',
    'personalPhone',
  ] as const) {
    if (input[k] !== undefined) data[k] = input[k];
  }
  for (const k of PERSONAL_JSON) {
    const v = input[k];
    if (v !== undefined) data[k] = v === null ? DbNull : (v as Prisma.InputJsonValue);
  }
  return data;
}

export async function employeeDetail(employee: EmployeeWithRefs): Promise<EmployeeDetailDto> {
  const db = tenantDb();
  const [profile, secondary] = await Promise.all([
    db.employeeProfile.findFirst({ where: { employeeId: employee.id } }),
    db.employeeDepartment.findMany({
      where: { employeeId: employee.id, isPrimary: false, effectiveTo: null },
      select: { departmentId: true },
    }),
  ]);
  const deptIds = secondary.map((s) => s.departmentId).filter((d): d is string => !!d);
  const departments = deptIds.length
    ? await db.department.findMany({
        where: { id: { in: deptIds } },
        select: { id: true, name: true, code: true },
      })
    : [];
  return {
    ...toEmployeeDto(employee),
    profile: {
      personal: toPersonal(profile),
      sensitive: maskedOf(profile),
      hasSensitive: !!profile?.sensitiveCiphertext,
    },
    secondaryDepartments: departments,
  };
}

/* --------------------------------- History writes --------------------------------------- */

/** Open the first history rows of a new (or draft-reset) employee. */
async function openHistory(
  tx: Tx,
  employeeId: string,
  a: ResolvedAssignment,
  employmentType: Employee['employmentType'],
  from: Date,
  secondaryDepartmentIds: string[],
  movementId: string | null = null,
) {
  await tx.employeeDepartment.create({
    data: withTenant({
      employeeId,
      groupId: a.groupId,
      institutionId: a.institutionId,
      campusId: a.campusId,
      departmentId: a.departmentId,
      isPrimary: true,
      effectiveFrom: from,
      movementId,
    }),
  });
  for (const departmentId of secondaryDepartmentIds) {
    await tx.employeeDepartment.create({
      data: withTenant({
        employeeId,
        groupId: a.groupId,
        institutionId: a.institutionId,
        departmentId,
        isPrimary: false,
        effectiveFrom: from,
        movementId,
      }),
    });
  }
  await tx.employeePosition.create({
    data: withTenant({
      employeeId,
      groupId: a.groupId,
      institutionId: a.institutionId,
      designationId: a.designationId,
      employmentType,
      effectiveFrom: from,
      movementId,
    }),
  });
  if (a.reportingManagerId) {
    await tx.employeeReportingLine.create({
      data: withTenant({
        employeeId,
        managerId: a.reportingManagerId,
        effectiveFrom: from,
        movementId,
      }),
    });
  }
}

/** Drafts have no real history yet: drop and re-open it with the edited assignment. */
async function resetDraftHistory(
  tx: Tx,
  employee: Employee,
  a: ResolvedAssignment,
  secondaryDepartmentIds: string[],
) {
  await tx.employeeDepartment.deleteMany({ where: { employeeId: employee.id } });
  await tx.employeePosition.deleteMany({ where: { employeeId: employee.id } });
  await tx.employeeReportingLine.deleteMany({ where: { employeeId: employee.id } });
  await openHistory(
    tx,
    employee.id,
    a,
    employee.employmentType,
    employee.dateOfJoining ?? toDate(todayStr()),
    secondaryDepartmentIds,
  );
}

/* --------------------------------- Service ---------------------------------------------- */

/** Active custom employee type (422 when missing / inactive / another tenant's). */
async function resolveEmployeeType(id: string | null | undefined) {
  if (!id) return null;
  const type = await tenantDb().employeeType.findFirst({ where: { id, status: 'ACTIVE' } });
  if (!type) throw new InvalidReferenceError('employeeTypeId', 'Employee type');
  return type;
}

export const employeeService = {
  async list(query: ListEmployeesQuery) {
    const principal = currentPrincipal();
    const db = tenantDb();
    const where = andScope(
      {
        ...(query.search
          ? {
              OR: [
                { displayName: { contains: query.search } },
                { employeeCode: { contains: query.search } },
                { workEmail: { contains: query.search } },
              ],
            }
          : {}),
        ...(query.groupId ? { groupId: query.groupId } : {}),
        ...(query.institutionId ? { institutionId: query.institutionId } : {}),
        ...(query.campusId ? { campusId: query.campusId } : {}),
        ...(query.departmentId ? { departmentId: query.departmentId } : {}),
        ...(query.designationId ? { designationId: query.designationId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.employmentType ? { employmentType: query.employmentType } : {}),
        ...(query.employeeTypeId ? { employeeTypeId: query.employeeTypeId } : {}),
      } satisfies Prisma.EmployeeWhereInput,
      await scopeWhere(principal, 'employee.view', 'employee'),
    ) as Prisma.EmployeeWhereInput;
    const window = toPageWindow(query);
    const [items, total] = await Promise.all([
      db.employee.findMany({
        where,
        include: employeeInclude,
        orderBy: [{ displayName: 'asc' }, { employeeCode: 'asc' }],
        skip: window.skip,
        take: window.take,
      }),
      db.employee.count({ where }),
    ]);
    return { items: items.map(toEmployeeDto), total };
  },

  async get(id: string) {
    return employeeDetail(await loadVisibleEmployee(id));
  },

  async create(rawInput: CreateEmployeeInput) {
    const typed = await resolveEmployeeType(rawInput.employeeTypeId);
    const employmentType = typed?.category ?? rawInput.employmentType;
    if (!employmentType) {
      throw new ValidationError('Select an employee type or employment type', {
        fields: [{ path: 'employmentType', message: 'Required' }],
      });
    }
    const input = { ...rawInput, employmentType };
    const principal = currentPrincipal();
    const assignment = await resolveAssignment(input);
    await authorize(principal, 'employee.create', assignmentResource(assignment));
    const secondary = (input.secondaryDepartmentIds ?? []).filter(
      (d) => d !== assignment.departmentId,
    );
    await assertDepartmentsInInstitution(secondary, assignment.institutionId);
    if (input.sensitive && !hasPermission(principal, 'employee.view_sensitive')) {
      throw new ForbiddenError(
        'Setting statutory ids or bank details requires employee.view_sensitive',
        'PERMISSION_DENIED',
      );
    }
    if (input.sensitive) {
      await authorize(principal, 'employee.view_sensitive', assignmentResource(assignment));
    }
    if (input.userId) await assertLinkableUser(input.userId);
    const organizationId = currentOrganizationId();
    const id = randomUUID();
    const employeeCode = input.employeeCode ?? (await nextEmployeeCode(assignment.institutionId));
    const sealed = input.sensitive
      ? await sealSensitivePatch(organizationId, id, {}, input.sensitive)
      : null;
    const joining = toDateOrNull(input.dateOfJoining) ?? null;

    const employee = await withLimit('employees', 1, () =>
      tenantDb().$transaction(async (tx) => {
        const created = await tx.employee.create({
          data: withTenant({
            id,
            employeeCode,
            userId: input.userId ?? null,
            ...assignment,
            employmentType: input.employmentType,
            employeeTypeId: typed?.id ?? null,
            status: input.status,
            firstName: input.firstName,
            middleName: input.middleName ?? null,
            lastName: input.lastName ?? null,
            displayName: displayNameOf(input),
            workEmail: input.workEmail ?? null,
            workPhone: input.workPhone ?? null,
            dateOfJoining: joining,
            probationEndDate: toDateOrNull(input.probationEndDate) ?? null,
            noticePeriodDays: input.noticePeriodDays ?? null,
          }),
        });
        await tx.employeeProfile.create({
          data: withTenant({
            employeeId: id,
            ...(personalData(input.personal ?? {}) as object),
            ...((sealed?.data ?? {}) as object),
          }) as Prisma.EmployeeProfileUncheckedCreateInput,
        });
        await openHistory(
          tx,
          id,
          assignment,
          input.employmentType,
          joining ?? toDate(todayStr()),
          secondary,
        );
        return created;
      }),
    );
    if (employee.status === 'ONBOARDING') {
      const { ensureChecklist } = await import('./employees.lifecycle');
      await ensureChecklist(employee, 'ONBOARDING');
    }
    await audit.record({
      action: 'employee.create',
      entityType: 'employee',
      entityId: id,
      after: employeeAuditView(employee),
      metadata: sealed ? { sensitiveFieldsSet: sealed.changed } : undefined,
    });
    await emit(
      'employee.created',
      {
        employeeId: id,
        employeeCode,
        institutionId: employee.institutionId,
        status: employee.status,
        employmentType: employee.employmentType,
      },
      { institutionId: employee.institutionId },
    );
    if (employee.status === 'ACTIVE' || employee.status === 'ONBOARDING') {
      await notifyJoining(employee);
    }
    return employeeService.get(id);
  },

  async update(id: string, rawInput: UpdateEmployeeInput) {
    const before = await loadEmployeeFor(id, 'employee.update');
    const typed = rawInput.employeeTypeId
      ? await resolveEmployeeType(rawInput.employeeTypeId)
      : null;
    const input = typed
      ? {
          ...rawInput,
          employmentType:
            typed.category !== before.employmentType ? typed.category : rawInput.employmentType,
        }
      : rawInput;
    const principal = currentPrincipal();
    const assignmentKeys = [
      'institutionId',
      'campusId',
      'departmentId',
      'designationId',
      'reportingManagerId',
      'secondaryDepartmentIds',
    ] as const;
    const touchesAssignment = assignmentKeys.some(
      (k) =>
        input[k] !== undefined &&
        JSON.stringify(input[k]) !== JSON.stringify((before as Record<string, unknown>)[k]),
    );
    if (touchesAssignment && before.status !== 'DRAFT') {
      throw new AppError(
        409,
        'USE_MOVEMENT',
        'Assignment changes of a non-draft employee go through movements (POST /employees/:id/movements)',
      );
    }
    let assignment: ResolvedAssignment | null = null;
    if (touchesAssignment) {
      assignment = await resolveAssignment(
        {
          institutionId: input.institutionId ?? before.institutionId,
          campusId:
            input.campusId !== undefined
              ? input.campusId
              : input.institutionId && input.institutionId !== before.institutionId
                ? null
                : before.campusId,
          departmentId:
            input.departmentId !== undefined
              ? input.departmentId
              : input.institutionId && input.institutionId !== before.institutionId
                ? null
                : before.departmentId,
          designationId:
            input.designationId !== undefined ? input.designationId : before.designationId,
          reportingManagerId:
            input.reportingManagerId !== undefined
              ? input.reportingManagerId
              : before.reportingManagerId,
        },
        id,
      );
      await authorize(principal, 'employee.update', assignmentResource(assignment));
    }
    if (input.userId !== undefined && input.userId && input.userId !== before.userId) {
      await assertLinkableUser(input.userId);
    }
    const names = {
      firstName: input.firstName ?? before.firstName,
      middleName: input.middleName !== undefined ? input.middleName : before.middleName,
      lastName: input.lastName !== undefined ? input.lastName : before.lastName,
    };
    const data: Prisma.EmployeeUncheckedUpdateInput = {
      ...(input.employeeCode !== undefined ? { employeeCode: input.employeeCode } : {}),
      ...(input.userId !== undefined ? { userId: input.userId } : {}),
      ...(input.employmentType !== undefined ? { employmentType: input.employmentType } : {}),
      ...(input.employeeTypeId !== undefined ? { employeeTypeId: input.employeeTypeId } : {}),
      ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
      ...(input.middleName !== undefined ? { middleName: input.middleName } : {}),
      ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
      displayName: displayNameOf(names),
      ...(input.workEmail !== undefined ? { workEmail: input.workEmail } : {}),
      ...(input.workPhone !== undefined ? { workPhone: input.workPhone } : {}),
      ...(input.dateOfJoining !== undefined
        ? { dateOfJoining: toDateOrNull(input.dateOfJoining) }
        : {}),
      ...(input.probationEndDate !== undefined
        ? { probationEndDate: toDateOrNull(input.probationEndDate) }
        : {}),
      ...(input.noticePeriodDays !== undefined ? { noticePeriodDays: input.noticePeriodDays } : {}),
      ...(assignment ?? {}),
    };
    const secondary =
      input.secondaryDepartmentIds ??
      (
        await tenantDb().employeeDepartment.findMany({
          where: { employeeId: id, isPrimary: false, effectiveTo: null },
          select: { departmentId: true },
        })
      )
        .map((d) => d.departmentId)
        .filter((d): d is string => !!d);
    if (assignment) await assertDepartmentsInInstitution(secondary, assignment.institutionId);
    const after = await tenantDb().$transaction(async (tx) => {
      const updated = await tx.employee.update({ where: { id }, data });
      const draftDatesChanged =
        before.status === 'DRAFT' &&
        (input.dateOfJoining !== undefined || input.employmentType !== undefined);
      if (assignment || draftDatesChanged) {
        await resetDraftHistory(
          tx,
          updated,
          assignment ?? {
            groupId: updated.groupId,
            institutionId: updated.institutionId,
            campusId: updated.campusId,
            departmentId: updated.departmentId,
            designationId: updated.designationId,
            reportingManagerId: updated.reportingManagerId,
          },
          secondary,
        );
      } else if (input.employmentType !== undefined) {
        await tx.employeePosition.updateMany({
          where: { employeeId: id, effectiveTo: null },
          data: { employmentType: input.employmentType },
        });
      }
      return updated;
    });
    await audit.record({
      action: 'employee.update',
      entityType: 'employee',
      entityId: id,
      before: employeeAuditView(before),
      after: employeeAuditView(after),
    });
    await emit(
      'employee.updated',
      { employeeId: id, employeeCode: after.employeeCode, institutionId: after.institutionId },
      { institutionId: after.institutionId },
    );
    return employeeService.get(id);
  },

  /** Only DRAFT employees can be deleted (soft delete); others are exited. */
  async remove(id: string) {
    const before = await loadEmployeeFor(id, 'employee.delete');
    if (before.status !== 'DRAFT') {
      throw new AppError(409, 'INVALID_STATE', 'Only draft employees can be deleted; exit instead');
    }
    await tenantDb().employee.update({
      where: { id },
      data: { deletedAt: new Date(), userId: null },
    });
    await releaseLimit('employees', 1);
    await audit.record({
      action: 'employee.delete',
      entityType: 'employee',
      entityId: id,
      before: employeeAuditView(before),
    });
    await emit(
      'employee.deleted',
      { employeeId: id, employeeCode: before.employeeCode },
      { institutionId: before.institutionId },
    );
  },

  async updateProfile(id: string, input: UpdateEmployeeProfileInput) {
    const employee = await loadEmployeeFor(id, 'employee.update');
    const resource = hierarchyResource.employee(employee);
    if (input.sensitive) await authorize(currentPrincipal(), 'employee.view_sensitive', resource);
    const db = tenantDb();
    const profile = await db.employeeProfile.findFirst({ where: { employeeId: id } });
    const organizationId = currentOrganizationId();
    let changed: string[] = [];
    let sensitiveData: Prisma.EmployeeProfileUncheckedUpdateInput = {};
    if (input.sensitive) {
      const current = await decryptSensitive(organizationId, id, profile);
      const sealed = await sealSensitivePatch(organizationId, id, current, input.sensitive);
      changed = sealed.changed;
      sensitiveData = sealed.data;
    }
    const personal = personalData(input.personal ?? {});
    const beforePersonal = toPersonal(profile);
    if (profile) {
      await db.employeeProfile.update({
        where: { id: profile.id },
        data: { ...personal, ...sensitiveData },
      });
    } else {
      await db.employeeProfile.create({
        data: withTenant({
          employeeId: id,
          ...(personal as object),
          ...(sensitiveData as object),
        }) as Prisma.EmployeeProfileUncheckedCreateInput,
      });
    }
    await audit.record({
      action: 'employee.profile.update',
      entityType: 'employee',
      entityId: id,
      before: input.personal ? pick(beforePersonal, Object.keys(input.personal)) : undefined,
      after: input.personal ?? undefined,
      // Only the NAMES of changed sensitive fields — never values.
      metadata: changed.length ? { sensitiveFieldsChanged: changed } : undefined,
    });
    await emit(
      'employee.updated',
      { employeeId: id, employeeCode: employee.employeeCode, profile: true },
      { institutionId: employee.institutionId },
    );
    return employeeService.get(id);
  },

  /** Clear statutory ids / bank details. Requires `employee.view_sensitive`; always audited. */
  async revealSensitive(id: string, reason?: string | null) {
    const employee = await loadEmployeeFor(id, 'employee.view_sensitive');
    const profile = await tenantDb().employeeProfile.findFirst({ where: { employeeId: id } });
    const values = await decryptSensitive(currentOrganizationId(), id, profile);
    await audit.record({
      action: 'employee.sensitive_view',
      entityType: 'employee',
      entityId: id,
      reason: reason ?? null,
      metadata: { fields: Object.keys(values), employeeCode: employee.employeeCode },
    });
    return {
      pan: values.pan ?? null,
      aadhaar: values.aadhaar ?? null,
      uan: values.uan ?? null,
      esicNumber: values.esicNumber ?? null,
      pfNumber: values.pfNumber ?? null,
      bankAccount: values.bankAccount
        ? {
            accountHolderName: values.bankAccount.accountHolderName,
            accountNumber: values.bankAccount.accountNumber,
            ifsc: values.bankAccount.ifsc,
            bankName: values.bankAccount.bankName ?? null,
            branch: values.bankAccount.branch ?? null,
          }
        : null,
    };
  },

  async history(id: string): Promise<EmployeeHistoryDto> {
    await loadVisibleEmployee(id);
    const db = tenantDb();
    const [positions, departments, lines] = await Promise.all([
      db.employeePosition.findMany({
        where: { employeeId: id },
        include: { designation: { select: { name: true } } },
        orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      }),
      db.employeeDepartment.findMany({
        where: { employeeId: id },
        orderBy: [{ effectiveFrom: 'desc' }, { isPrimary: 'desc' }, { createdAt: 'desc' }],
      }),
      db.employeeReportingLine.findMany({
        where: { employeeId: id },
        include: { manager: { select: { id: true, employeeCode: true, displayName: true } } },
        orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      }),
    ]);
    return {
      positions: positions.map((p) => ({
        id: p.id,
        institutionId: p.institutionId,
        designationId: p.designationId,
        designationName: p.designation?.name ?? null,
        employmentType: p.employmentType,
        effectiveFrom: dateStr(p.effectiveFrom),
        effectiveTo: dateStrOrNull(p.effectiveTo),
        reason: p.reason,
        movementId: p.movementId,
      })),
      departments: departments.map((d) => ({
        id: d.id,
        groupId: d.groupId,
        institutionId: d.institutionId,
        campusId: d.campusId,
        departmentId: d.departmentId,
        isPrimary: d.isPrimary,
        effectiveFrom: dateStr(d.effectiveFrom),
        effectiveTo: dateStrOrNull(d.effectiveTo),
        movementId: d.movementId,
      })),
      reportingLines: lines.map((l) => ({
        id: l.id,
        managerId: l.managerId,
        manager: l.manager,
        effectiveFrom: dateStr(l.effectiveFrom),
        effectiveTo: dateStrOrNull(l.effectiveTo),
        movementId: l.movementId,
      })),
    };
  },

  /* ----------------------------- Code sequences ------------------------------------------ */

  async listCodeSequences() {
    const principal = currentPrincipal();
    const rows = await tenantDb().employeeCodeSequence.findMany({ orderBy: { scopeKey: 'asc' } });
    const visible = [];
    for (const r of rows) {
      const institutionId = r.scopeKey === DEFAULT_SCOPE ? null : r.scopeKey;
      if (institutionId && !(await can(principal, 'designation.view', { institutionId }))) continue;
      visible.push({
        id: r.id,
        institutionId,
        prefix: r.prefix,
        padding: r.padding,
        nextNumber: r.nextNumber,
        preview: formatCode(r.prefix, r.padding, r.nextNumber),
      });
    }
    return visible;
  },

  async upsertCodeSequence(input: UpsertEmployeeCodeSequenceInput) {
    const principal = currentPrincipal();
    if (input.institutionId) {
      const inst = await tenantDb().institution.findUnique({
        where: { id: input.institutionId },
        select: { id: true, groupId: true },
      });
      if (!inst) throw new NotFoundError('Institution');
      await authorize(principal, 'designation.manage', hierarchyResource.institution(inst));
    } else {
      // `{}` = organization-level resource: only organization-wide grants cover it.
      await authorize(principal, 'designation.manage', {});
    }
    const db = tenantDb();
    const scopeKey = input.institutionId ?? DEFAULT_SCOPE;
    const existing = await db.employeeCodeSequence.findFirst({ where: { scopeKey } });
    const row = existing
      ? await db.employeeCodeSequence.update({
          where: { id: existing.id },
          data: {
            prefix: input.prefix,
            padding: input.padding,
            ...(input.nextNumber !== undefined ? { nextNumber: input.nextNumber } : {}),
          },
        })
      : await db.employeeCodeSequence.create({
          data: withTenant({
            scopeKey,
            prefix: input.prefix,
            padding: input.padding,
            nextNumber: input.nextNumber ?? 1,
          }),
        });
    await audit.record({
      action: existing ? 'employee_code_sequence.update' : 'employee_code_sequence.create',
      entityType: 'employee_code_sequence',
      entityId: row.id,
      before: existing ?? undefined,
      after: row,
    });
    return {
      id: row.id,
      institutionId: input.institutionId,
      prefix: row.prefix,
      padding: row.padding,
      nextNumber: row.nextNumber,
      preview: formatCode(row.prefix, row.padding, row.nextNumber),
    };
  },
};

function pick(obj: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, obj[k] ?? null]));
}

/** A linked user must be a member of this organization and not linked to another employee. */
async function assertLinkableUser(userId: string): Promise<void> {
  const db = tenantDb();
  const membership = await db.organizationMembership.findFirst({
    where: { userId },
    select: { id: true },
  });
  if (!membership)
    throw new AppError(422, 'INVALID_REFERENCE', 'userId is not a member of this organization');
  const linked = await db.employee.findFirst({ where: { userId }, select: { id: true } });
  if (linked) throw new ConflictError('This user is already linked to another employee');
}

export async function notifyJoining(employee: Employee): Promise<void> {
  const recipients = [
    ...(await hrRecipients(employee)),
    await managerUserId(employee.reportingManagerId),
    employee.userId,
  ];
  await notify('employee.joined', recipients, {
    title: `New joiner: ${employee.displayName} (${employee.employeeCode})`,
    body: employee.dateOfJoining
      ? `Joining on ${dateStr(employee.dateOfJoining)}.`
      : 'Joining date to be confirmed.',
    link: `/hr/employees/${employee.id}`,
    institutionId: employee.institutionId,
    data: { employeeId: employee.id },
  });
}

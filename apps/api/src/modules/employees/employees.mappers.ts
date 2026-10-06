import type {
  DesignationDto,
  EmployeeChecklistItemDto,
  EmployeeDto,
  EmployeeMovementDto,
  EmployeeProfileChangeRequestDto,
  EmployeeSalaryRevisionDto,
  EmployeeSensitiveMaskedDto,
} from '@erp/shared';
import type {
  Designation,
  Employee,
  EmployeeChecklistItem,
  EmployeeMovement,
  EmployeeProfileChangeRequest,
  EmployeeSalaryHistory,
  Prisma,
} from '@prisma/client';

/* Date-only columns are stored as UTC midnight; the API speaks `YYYY-MM-DD`. */

export const toDate = (s: string): Date => new Date(`${s.slice(0, 10)}T00:00:00.000Z`);
export const toDateOrNull = (s: string | null | undefined): Date | null | undefined =>
  s === undefined ? undefined : s === null ? null : toDate(s);
export const dateStr = (d: Date): string => d.toISOString().slice(0, 10);
export const dateStrOrNull = (d: Date | null | undefined): string | null => (d ? dateStr(d) : null);
export const todayStr = (now = new Date()): string => dateStr(now);
/** The day before `d` (history rows end the day before the next one starts). */
export const dayBefore = (d: Date): Date => new Date(d.getTime() - 24 * 60 * 60 * 1000);

export const displayNameOf = (e: {
  firstName: string;
  middleName?: string | null;
  lastName?: string | null;
}): string => [e.firstName, e.middleName, e.lastName].filter(Boolean).join(' ');

const ref = { select: { id: true, name: true, code: true } } as const;

/** `include` used whenever an EmployeeDto is produced. */
export const employeeInclude = {
  institution: ref,
  campus: ref,
  department: ref,
  designation: ref,
  reportingManager: { select: { id: true, employeeCode: true, displayName: true } },
} satisfies Prisma.EmployeeInclude;

export type EmployeeWithRefs = Prisma.EmployeeGetPayload<{ include: typeof employeeInclude }>;

export function toEmployeeDto(e: EmployeeWithRefs): EmployeeDto {
  return {
    id: e.id,
    employeeCode: e.employeeCode,
    userId: e.userId,
    groupId: e.groupId,
    institutionId: e.institutionId,
    campusId: e.campusId,
    departmentId: e.departmentId,
    designationId: e.designationId,
    reportingManagerId: e.reportingManagerId,
    employmentType: e.employmentType,
    status: e.status,
    firstName: e.firstName,
    middleName: e.middleName,
    lastName: e.lastName,
    displayName: e.displayName,
    workEmail: e.workEmail,
    workPhone: e.workPhone,
    dateOfJoining: dateStrOrNull(e.dateOfJoining),
    probationEndDate: dateStrOrNull(e.probationEndDate),
    confirmationDate: dateStrOrNull(e.confirmationDate),
    noticePeriodDays: e.noticePeriodDays,
    resignationDate: dateStrOrNull(e.resignationDate),
    lastWorkingDate: dateStrOrNull(e.lastWorkingDate),
    exitDate: dateStrOrNull(e.exitDate),
    exitType: e.exitType,
    exitReason: e.exitReason,
    rehireCount: e.rehireCount,
    institution: e.institution,
    campus: e.campus,
    department: e.department,
    designation: e.designation,
    reportingManager: e.reportingManager,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}

/** Plain audit snapshot of the core employee columns (never includes sensitive values). */
export function employeeAuditView(e: Employee) {
  return {
    employeeCode: e.employeeCode,
    userId: e.userId,
    groupId: e.groupId,
    institutionId: e.institutionId,
    campusId: e.campusId,
    departmentId: e.departmentId,
    designationId: e.designationId,
    reportingManagerId: e.reportingManagerId,
    employmentType: e.employmentType,
    status: e.status,
    displayName: e.displayName,
    workEmail: e.workEmail,
    dateOfJoining: dateStrOrNull(e.dateOfJoining),
    exitDate: dateStrOrNull(e.exitDate),
  };
}

export const EMPTY_MASKED: EmployeeSensitiveMaskedDto = {
  pan: null,
  aadhaar: null,
  uan: null,
  esicNumber: null,
  pfNumber: null,
  bankAccount: null,
};

export function toMovementDto(m: EmployeeMovement): EmployeeMovementDto {
  return {
    id: m.id,
    employeeId: m.employeeId,
    type: m.type,
    status: m.status,
    effectiveDate: dateStr(m.effectiveDate),
    fromGroupId: m.fromGroupId,
    fromInstitutionId: m.fromInstitutionId,
    fromCampusId: m.fromCampusId,
    fromDepartmentId: m.fromDepartmentId,
    fromDesignationId: m.fromDesignationId,
    fromReportingManagerId: m.fromReportingManagerId,
    toGroupId: m.toGroupId,
    toInstitutionId: m.toInstitutionId,
    toCampusId: m.toCampusId,
    toDepartmentId: m.toDepartmentId,
    toDesignationId: m.toDesignationId,
    toReportingManagerId: m.toReportingManagerId,
    reason: m.reason,
    workflowInstanceId: m.workflowInstanceId,
    requestedByUserId: m.requestedByUserId,
    decidedComment: m.decidedComment,
    appliedAt: m.appliedAt?.toISOString() ?? null,
    createdAt: m.createdAt.toISOString(),
  };
}

export function toSalaryDto(s: EmployeeSalaryHistory): EmployeeSalaryRevisionDto {
  return {
    id: s.id,
    employeeId: s.employeeId,
    institutionId: s.institutionId,
    effectiveFrom: dateStr(s.effectiveFrom),
    currency: s.currency,
    annualCtc: Number(s.annualCtc),
    amounts: (s.amounts ?? {}) as Record<string, number>,
    salaryStructureId: s.salaryStructureId,
    revisionReason: s.revisionReason,
    previousId: s.previousId,
    createdByUserId: s.createdByUserId,
    createdAt: s.createdAt.toISOString(),
  };
}

export function toChecklistDto(c: EmployeeChecklistItem): EmployeeChecklistItemDto {
  return {
    id: c.id,
    kind: c.kind,
    key: c.key,
    title: c.title,
    source: c.source,
    status: c.status,
    notes: c.notes,
    completedAt: c.completedAt?.toISOString() ?? null,
    completedByUserId: c.completedByUserId,
  };
}

export function toChangeRequestDto(
  r: EmployeeProfileChangeRequest,
): EmployeeProfileChangeRequestDto {
  return {
    id: r.id,
    employeeId: r.employeeId,
    status: r.status,
    changes: (r.changes ?? {}) as Record<string, unknown>,
    reason: r.reason,
    workflowInstanceId: r.workflowInstanceId,
    decidedComment: r.decidedComment,
    appliedAt: r.appliedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

export function toDesignationDto(d: Designation): DesignationDto {
  return {
    id: d.id,
    code: d.code,
    name: d.name,
    groupId: d.groupId,
    institutionId: d.institutionId,
    category: d.category,
    level: d.level,
    description: d.description,
    status: d.status,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

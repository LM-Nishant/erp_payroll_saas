import { NotFoundError, InvalidReferenceError } from '../../core/http/errors';
import { can, currentPrincipal, hierarchyResource, scopeWhere } from '../../core/authz';
import { tenantDb } from '../../core/tenancy';
import type { LibraryMemberType } from '@erp/shared';
import { DEFAULT_POLICIES, type PolicyValues } from './library.logic';
import { num } from './library.mappers';

type Db = ReturnType<typeof tenantDb>;
export type Tx = Parameters<Parameters<Db['$transaction']>[0]>[0];

export const libScope = (permission = 'library.view') =>
  scopeWhere(currentPrincipal(), permission, 'library');

export const libResource = hierarchyResource.library;

export async function canLib(
  permission: string,
  row: { groupId: string | null; institutionId: string; campusId: string | null },
) {
  return can(currentPrincipal(), permission, libResource(row));
}

/** Institution (library) referenced by a create — 422 when missing / not in tenant. */
export async function resolveInstitution(institutionId: string, campusId?: string | null) {
  const inst = await tenantDb().institution.findUnique({
    where: { id: institutionId },
    select: { id: true, groupId: true, code: true, name: true },
  });
  if (!inst) throw new InvalidReferenceError('institutionId', 'Institution');
  if (campusId) {
    const campus = await tenantDb().campus.findUnique({ where: { id: campusId } });
    if (!campus || campus.institutionId !== inst.id)
      throw new InvalidReferenceError('campusId', 'Campus');
  }
  return inst;
}

export async function loadBook(id: string, permission = 'library.view') {
  const book = await tenantDb().libraryBook.findUnique({ where: { id } });
  if (!book || !(await canLib(permission, book))) throw new NotFoundError('Library book');
  return book;
}

export async function loadCopy(id: string, permission = 'library.view') {
  const copy = await tenantDb().libraryCopy.findUnique({ where: { id } });
  if (!copy || !(await canLib(permission, copy))) throw new NotFoundError('Library copy');
  return copy;
}

export async function policyFor(
  institutionId: string,
  memberType: LibraryMemberType,
  db: Db | Tx = tenantDb(),
): Promise<PolicyValues & { id: string | null }> {
  const row = await db.libraryPolicy.findFirst({ where: { institutionId, memberType } });
  if (!row) return { id: null, ...DEFAULT_POLICIES[memberType] };
  return {
    id: row.id,
    maxBooks: row.maxBooks,
    loanDays: row.loanDays,
    maxRenewals: row.maxRenewals,
    finePerDay: num(row.finePerDay),
    maxFine: num(row.maxFine),
    holdDays: row.holdDays,
  };
}

/** Member (student / employee) of a library — must belong to the library's institution. */
export interface LibraryMember {
  memberType: LibraryMemberType;
  studentId: string | null;
  employeeId: string | null;
  userId: string | null;
  name: string;
  institutionId: string;
  groupId: string | null;
  campusId: string | null;
}

export async function resolveMember(
  ref: { studentId?: string | null; employeeId?: string | null },
  institutionId?: string,
): Promise<LibraryMember> {
  if (ref.studentId) {
    const s = await tenantDb().student.findUnique({ where: { id: ref.studentId } });
    if (!s || (institutionId && s.institutionId !== institutionId))
      throw new InvalidReferenceError('studentId', 'Student');
    if (s.status !== 'ACTIVE') throw new InvalidReferenceError('studentId', 'Active student');
    return {
      memberType: 'STUDENT',
      studentId: s.id,
      employeeId: null,
      userId: s.userId,
      name: `${s.displayName} (${s.admissionNo})`,
      institutionId: s.institutionId,
      groupId: s.groupId,
      campusId: s.campusId,
    };
  }
  const e = ref.employeeId
    ? await tenantDb().employee.findUnique({ where: { id: ref.employeeId } })
    : null;
  if (!e || (institutionId && e.institutionId !== institutionId))
    throw new InvalidReferenceError('employeeId', 'Employee');
  if (e.status === 'EXITED' || e.status === 'DRAFT')
    throw new InvalidReferenceError('employeeId', 'Active employee');
  return {
    memberType: 'EMPLOYEE',
    studentId: null,
    employeeId: e.id,
    userId: e.userId,
    name: `${e.displayName} (${e.employeeCode})`,
    institutionId: e.institutionId,
    groupId: e.groupId,
    campusId: e.campusId,
  };
}

export const memberWhere = (m: { studentId: string | null; employeeId: string | null }) =>
  m.studentId ? { studentId: m.studentId } : { employeeId: m.employeeId };

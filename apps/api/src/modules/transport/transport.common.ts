import type { Prisma } from '@prisma/client';
import { accessFor, authorize, can, currentPrincipal } from '../../core/authz';
import { InvalidReferenceError, NotFoundError } from '../../core/http/errors';
import { tenantDb } from '../../core/tenancy';

/**
 * Helpers shared by the transport and hostel modules. Every row carries
 * `institutionId` (+ `groupId` where denormalised), so scope checks use those coordinates
 * directly instead of a `scopeWhere` model mapping.
 */

export interface InstitutionScoped {
  institutionId: string;
  groupId?: string | null;
}

export const num = (v: Prisma.Decimal | number | null | undefined): number =>
  v === null || v === undefined ? 0 : Number(v);
export const numOrNull = (v: Prisma.Decimal | number | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v);
export const dateStr = (d: Date): string => d.toISOString().slice(0, 10);
export const dateStrOrNull = (d: Date | null | undefined): string | null => (d ? dateStr(d) : null);
export const toDate = (s: string): Date => new Date(`${s}T00:00:00.000Z`);
export const toDateOrNull = (s: string | null | undefined): Date | null | undefined =>
  s === undefined ? undefined : s === null ? null : toDate(s);
export const isoOrNull = (d: Date | null | undefined): string | null =>
  d ? d.toISOString() : null;
export const today = (): string => dateStr(new Date());

/** Where-fragment restricting a list to the institutions where `permission` is granted. */
export async function institutionScope(permission: string): Promise<{
  institutionId?: { in: string[] };
}> {
  const access = await accessFor(currentPrincipal(), permission);
  if (access.all) return {};
  return { institutionId: { in: [...access.institutionIds] } };
}

const resource = (row: InstitutionScoped) => ({
  institutionId: row.institutionId,
  ...(row.groupId !== undefined ? { groupId: row.groupId } : {}),
});

/** Reads: out-of-scope rows look like missing rows (404). */
export async function assertVisible<T extends InstitutionScoped>(
  row: T | null | undefined,
  permission: string,
  label: string,
): Promise<T> {
  if (!row || !(await can(currentPrincipal(), permission, resource(row)))) {
    throw new NotFoundError(label);
  }
  return row;
}

/** Writes: 403 when the principal lacks `permission` in the row's scope. */
export async function authorizeRow(row: InstitutionScoped, permission: string): Promise<void> {
  await authorize(currentPrincipal(), permission, resource(row));
}

export async function resolveInstitution(institutionId: string, field = 'institutionId') {
  const inst = await tenantDb().institution.findFirst({
    where: { id: institutionId },
    select: { id: true, groupId: true, name: true },
  });
  if (!inst) throw new InvalidReferenceError(field, 'Institution');
  return inst;
}

export interface PersonRef {
  id: string;
  name: string;
  code: string | null;
  userId: string | null;
  institutionId: string;
  groupId: string | null;
  gender?: string | null;
  phone?: string | null;
}

const compact = (ids: (string | null | undefined)[]) => [
  ...new Set(ids.filter((v): v is string => !!v)),
];

export async function studentRefs(ids: (string | null | undefined)[]) {
  const unique = compact(ids);
  const map = new Map<string, PersonRef>();
  if (!unique.length) return map;
  const rows = await tenantDb().student.findMany({
    where: { id: { in: unique } },
    select: {
      id: true,
      displayName: true,
      admissionNo: true,
      userId: true,
      institutionId: true,
      groupId: true,
      gender: true,
      phone: true,
    },
  });
  for (const r of rows) {
    map.set(r.id, {
      id: r.id,
      name: r.displayName,
      code: r.admissionNo,
      userId: r.userId,
      institutionId: r.institutionId,
      groupId: r.groupId,
      gender: r.gender,
      phone: r.phone,
    });
  }
  return map;
}

export async function employeeRefs(ids: (string | null | undefined)[]) {
  const unique = compact(ids);
  const map = new Map<string, PersonRef>();
  if (!unique.length) return map;
  const rows = await tenantDb().employee.findMany({
    where: { id: { in: unique } },
    select: {
      id: true,
      displayName: true,
      employeeCode: true,
      userId: true,
      institutionId: true,
      groupId: true,
      workPhone: true,
    },
  });
  for (const r of rows) {
    map.set(r.id, {
      id: r.id,
      name: r.displayName,
      code: r.employeeCode,
      userId: r.userId,
      institutionId: r.institutionId,
      groupId: r.groupId,
      phone: r.workPhone,
    });
  }
  return map;
}

/** Validate a student / employee reference for a passenger / occupant in `institutionId`. */
export async function resolvePerson(
  kind: 'STUDENT' | 'STAFF',
  id: string,
  institutionId?: string,
): Promise<PersonRef> {
  const map = kind === 'STUDENT' ? await studentRefs([id]) : await employeeRefs([id]);
  const person = map.get(id);
  const field = kind === 'STUDENT' ? 'studentId' : 'employeeId';
  const label = kind === 'STUDENT' ? 'Student' : 'Employee';
  if (!person || (institutionId && person.institutionId !== institutionId)) {
    throw new InvalidReferenceError(field, label);
  }
  return person;
}

/** User ids of the students themselves and of their guardians (parents) who have logins. */
export async function familyUserIds(studentIds: string[]): Promise<string[]> {
  if (!studentIds.length) return [];
  const db = tenantDb();
  const [students, links] = await Promise.all([
    db.student.findMany({ where: { id: { in: studentIds } }, select: { userId: true } }),
    db.studentGuardian.findMany({
      where: { studentId: { in: studentIds } },
      select: { guardian: { select: { userId: true } } },
    }),
  ]);
  return compact([...students.map((s) => s.userId), ...links.map((l) => l.guardian.userId)]);
}

/** Guardian (parent) user ids only. */
export async function guardianUserIds(studentIds: string[]): Promise<string[]> {
  if (!studentIds.length) return [];
  const links = await tenantDb().studentGuardian.findMany({
    where: { studentId: { in: studentIds } },
    select: { guardian: { select: { userId: true } } },
  });
  return compact(links.map((l) => l.guardian.userId));
}

/**
 * Portal: the students the current user may see — themself (student login) and their wards
 * (parent login).
 */
export async function myStudentIds(): Promise<string[]> {
  const userId = currentPrincipal().userId;
  if (!userId) return [];
  const db = tenantDb();
  const [own, wards] = await Promise.all([
    db.student.findMany({ where: { userId }, select: { id: true } }),
    db.studentGuardian.findMany({ where: { guardian: { userId } }, select: { studentId: true } }),
  ]);
  return compact([...own.map((s) => s.id), ...wards.map((w) => w.studentId)]);
}

/** The current user's own employee record ids (staff self-service). */
export async function myEmployeeIds(): Promise<string[]> {
  const userId = currentPrincipal().userId;
  if (!userId) return [];
  const rows = await tenantDb().employee.findMany({ where: { userId }, select: { id: true } });
  return rows.map((r) => r.id);
}

/** Inclusive first / last day of a `YYYY-MM` period. */
export function periodBounds(period: string): { start: Date; end: Date } {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 0)) };
}

/** True when [from, to] (to open-ended when null) overlaps [start, end]. */
export function overlaps(from: Date, to: Date | null, start: Date, end: Date): boolean {
  return from <= end && (to === null || to >= start);
}

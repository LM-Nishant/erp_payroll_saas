import type { RequestHandler } from 'express';
import type { TeacherRefDto } from '@erp/shared';
import {
  accessFor,
  can,
  currentPrincipal,
  hasPermission,
  type ResourceScope,
} from '../../core/authz';
import { ForbiddenError, InvalidReferenceError, NotFoundError } from '../../core/http/errors';
import { publish } from '../../core/notifications';
import { tenantDb } from '../../core/tenancy';

/*
 * Shared access helpers for academics / timetable / exams. Teachers hold the marking
 * permissions at institution / department scope, but may only act on sections and subjects
 * they are ALLOCATED to; holders of the corresponding `.manage` permission act on any section
 * in their scope.
 */

type Db = ReturnType<typeof tenantDb>;

export type SectionRow = Awaited<ReturnType<typeof loadSection>>;

export async function loadSection(id: string, field = 'classSectionId', db: Db = tenantDb()) {
  const cs = await db.classSection.findUnique({
    where: { id },
    include: { institution: { select: { id: true, groupId: true } } },
  });
  if (!cs) throw new InvalidReferenceError(field, 'Class section');
  return cs;
}

/** Hierarchy coordinates stored on every academics row of a section. */
export function sectionCoords(cs: SectionRow) {
  return {
    groupId: cs.institution.groupId,
    institutionId: cs.institutionId,
    campusId: cs.campusId,
    departmentId: cs.departmentId,
  };
}

export function sectionResource(cs: {
  groupId?: string | null;
  institutionId: string;
  campusId: string | null;
  departmentId: string;
  institution?: { groupId: string | null };
}): ResourceScope {
  return {
    groupId: cs.groupId ?? cs.institution?.groupId ?? null,
    institutionId: cs.institutionId,
    campusId: cs.campusId,
    departmentId: cs.departmentId,
  };
}

/** Load a section and require `permission` over it (404 when out of scope). */
export async function loadVisibleSection(id: string, permission: string) {
  const cs = await tenantDb().classSection.findUnique({
    where: { id },
    include: { institution: { select: { id: true, groupId: true } } },
  });
  if (!cs || !(await can(currentPrincipal(), permission, sectionResource(cs)))) {
    throw new NotFoundError('Class section');
  }
  return cs;
}

/** Institution ids where the principal holds `permission` at any level (incl. below). */
export async function accessibleInstitutionIds(permission: string): Promise<string[] | undefined> {
  const principal = currentPrincipal();
  if (!hasPermission(principal, permission)) return [];
  const access = await accessFor(principal, permission);
  if (access.all) return undefined;
  const ids = new Set(access.institutionIds);
  const db = tenantDb();
  if (access.campusIds.size) {
    for (const c of await db.campus.findMany({
      where: { id: { in: [...access.campusIds] } },
      select: { institutionId: true },
    }))
      ids.add(c.institutionId);
  }
  if (access.departmentIds.size) {
    for (const d of await db.department.findMany({
      where: { id: { in: [...access.departmentIds] } },
      select: { institutionId: true },
    }))
      ids.add(d.institutionId);
  }
  return [...ids];
}

/** `where` fragment for institution-level rows (bell periods, exam terms, grading scales). */
export async function institutionWhere(permission: string) {
  const ids = await accessibleInstitutionIds(permission);
  return ids === undefined ? {} : { institutionId: { in: ids } };
}

export async function assertInstitutionVisible(institutionId: string, permission: string) {
  const ids = await accessibleInstitutionIds(permission);
  if (ids !== undefined && !ids.includes(institutionId)) throw new NotFoundError('Institution');
}

export async function isClassTeacher(userId: string, classSectionId: string) {
  return !!(await tenantDb().classTeacherAssignment.findFirst({
    where: { classSectionId, teacherUserId: userId },
    select: { id: true },
  }));
}

export async function isSubjectTeacher(userId: string, classSectionId: string, subjectId?: string) {
  return !!(await tenantDb().subjectAllocation.findFirst({
    where: { classSectionId, teacherUserId: userId, ...(subjectId ? { subjectId } : {}) },
    select: { id: true },
  }));
}

/**
 * Require `managePermission` over the section, or `actPermission` over it plus an allocation
 * (class teacher or any / the given subject). Returns whether the caller is a manager.
 */
export async function assertSectionActor(
  cs: SectionRow,
  actPermission: string,
  managePermission: string,
  opts: { subjectId?: string; allowClassTeacher?: boolean } = {},
): Promise<{ manager: boolean }> {
  const principal = currentPrincipal();
  const resource = sectionResource(cs);
  if (await can(principal, managePermission, resource)) return { manager: true };
  if (!(await can(principal, actPermission, resource))) {
    throw new ForbiddenError(`Permission "${actPermission}" is not granted for this section`);
  }
  const userId = principal.userId;
  const allowed =
    !!userId &&
    ((opts.allowClassTeacher !== false &&
      !opts.subjectId &&
      (await isClassTeacher(userId, cs.id))) ||
      (await isSubjectTeacher(userId, cs.id, opts.subjectId)));
  if (!allowed) {
    throw new ForbiddenError(
      'You are not allocated to this class section / subject',
      'NOT_ALLOCATED',
    );
  }
  return { manager: false };
}

/** Validate that a user is an active member of the current organization. */
export async function assertMemberUser(userId: string, field: string) {
  const membership = await tenantDb().organizationMembership.findFirst({
    where: { userId, status: 'ACTIVE' },
    select: { id: true },
  });
  if (!membership) throw new InvalidReferenceError(field, 'User');
}

/** Names / e-mails of org members, keyed by user id. */
export async function userRefs(ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((i): i is string => !!i))];
  const map = new Map<string, TeacherRefDto>();
  if (!unique.length) return map;
  const rows = await tenantDb().organizationMembership.findMany({
    where: { userId: { in: unique } },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  for (const r of rows)
    map.set(r.user.id, { id: r.user.id, name: r.user.name, email: r.user.email });
  return map;
}

/** Guardians' login user ids of the given students, keyed by student id. */
export async function guardianUserIds(studentIds: string[]) {
  const map = new Map<string, string[]>();
  if (!studentIds.length) return map;
  const links = await tenantDb().studentGuardian.findMany({
    where: { studentId: { in: studentIds } },
    include: { guardian: { select: { userId: true } } },
  });
  for (const l of links) {
    if (!l.guardian.userId) continue;
    map.set(l.studentId, [...(map.get(l.studentId) ?? []), l.guardian.userId]);
  }
  return map;
}

/**
 * Students the current principal may see via self-service: own student record and/or linked
 * wards. `studentId` narrows to one (404 if not own / ward).
 */
export async function ownStudents(studentId?: string) {
  const userId = currentPrincipal().userId;
  if (!userId) throw new NotFoundError('Student');
  const db = tenantDb();
  const [own, links] = await Promise.all([
    db.student.findMany({ where: { userId } }),
    db.studentGuardian.findMany({ where: { guardian: { userId } }, include: { student: true } }),
  ]);
  const all = [...own, ...links.map((l) => l.student)];
  const unique = [...new Map(all.map((s) => [s.id, s])).values()];
  if (studentId) {
    const match = unique.find((s) => s.id === studentId);
    if (!match) throw new NotFoundError('Student');
    return [match];
  }
  if (!unique.length) throw new NotFoundError('Student');
  return unique;
}

export const dateOnly = (d: Date) => d.toISOString().slice(0, 10);
export const toDate = (s: string) => new Date(`${s}T00:00:00.000Z`);
export const todayIso = () => new Date().toISOString().slice(0, 10);

/** Publish a notification to the distinct, non-null recipients (no-op when none). */
export async function notifyUsers(
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

/** Route guard: at least one of `permissions` must be held in some scope. */
export function requireAnyPermission(permissions: string[]): RequestHandler {
  return (_req, _res, next) => {
    const principal = currentPrincipal();
    if (!permissions.some((p) => hasPermission(principal, p))) {
      throw new ForbiddenError(`One of ${permissions.join(', ')} is required`);
    }
    next();
  };
}

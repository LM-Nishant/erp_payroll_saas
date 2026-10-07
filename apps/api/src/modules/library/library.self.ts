import { currentPrincipal } from '../../core/authz';
import { tenantDb } from '../../core/tenancy';
import { employeeIdsForUser } from '../employees/employees.assignment';
import type { LibraryMember } from './library.access';

/**
 * Library members linked to the calling user: their own student record, their wards (parents)
 * and their employee records. Used by OPAC and the self-service "My library" pages.
 */
export async function myMembers(): Promise<LibraryMember[]> {
  const userId = currentPrincipal().userId;
  if (!userId) return [];
  const db = tenantDb();
  const [own, links, employeeIds] = await Promise.all([
    db.student.findMany({ where: { userId, status: 'ACTIVE' } }),
    db.studentGuardian.findMany({
      where: { guardian: { userId } },
      include: { student: true },
      orderBy: { createdAt: 'asc' },
    }),
    employeeIdsForUser(userId),
  ]);
  const students = [...own, ...links.map((l) => l.student)].filter(
    (s, i, arr) => s.status === 'ACTIVE' && arr.findIndex((x) => x.id === s.id) === i,
  );
  const employees = employeeIds.length
    ? await db.employee.findMany({
        where: { id: { in: employeeIds }, status: { notIn: ['EXITED', 'DRAFT'] } },
      })
    : [];
  return [
    ...students.map((s): LibraryMember => ({
      memberType: 'STUDENT',
      studentId: s.id,
      employeeId: null,
      userId: s.userId,
      name: `${s.displayName} (${s.admissionNo})`,
      institutionId: s.institutionId,
      groupId: s.groupId,
      campusId: s.campusId,
    })),
    ...employees.map((e): LibraryMember => ({
      memberType: 'EMPLOYEE',
      studentId: null,
      employeeId: e.id,
      userId: e.userId,
      name: `${e.displayName} (${e.employeeCode})`,
      institutionId: e.institutionId,
      groupId: e.groupId,
      campusId: e.campusId,
    })),
  ];
}

export async function memberInstitutionIds(): Promise<string[]> {
  return [...new Set((await myMembers()).map((m) => m.institutionId))];
}

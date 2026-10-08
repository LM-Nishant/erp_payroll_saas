import type { Student } from '@prisma/client';
import { can, currentPrincipal, hasPermission, hierarchyResource } from '../../core/authz';
import { NotFoundError } from '../../core/http/errors';
import { tenantDb } from '../../core/tenancy';

/**
 * Fee access for a student: staff with `perm` on the student's hierarchy, the student
 * themself, or a linked guardian (both via fee.view_own).
 */
export async function loadFeeStudent(
  studentId: string,
  perm = 'fee.view',
): Promise<{ student: Student; self: boolean }> {
  const p = currentPrincipal();
  const student = await tenantDb().student.findUnique({ where: { id: studentId } });
  if (!student) throw new NotFoundError('Student');
  if (await can(p, perm, hierarchyResource.student(student))) return { student, self: false };
  if (p.userId && hasPermission(p, 'fee.view_own')) {
    if (student.userId === p.userId) return { student, self: true };
    const link = await tenantDb().studentGuardian.findFirst({
      where: { studentId, guardian: { userId: p.userId } },
      select: { id: true },
    });
    if (link) return { student, self: true };
  }
  throw new NotFoundError('Student');
}

/** Student ids the current user may see as "own" (self + wards). */
export async function ownStudentIds(): Promise<string[]> {
  const userId = currentPrincipal().userId;
  if (!userId) return [];
  const db = tenantDb();
  const [self, wards] = await Promise.all([
    db.student.findMany({ where: { userId }, select: { id: true } }),
    db.studentGuardian.findMany({ where: { guardian: { userId } }, select: { studentId: true } }),
  ]);
  return [...new Set([...self.map((s) => s.id), ...wards.map((w) => w.studentId)])];
}

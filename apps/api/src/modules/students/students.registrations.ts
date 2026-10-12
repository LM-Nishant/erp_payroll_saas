import { registerDocumentOwnerType } from '../../core/documents/owners';
import { registerEventType } from '../../core/events';
import { registerUsageSource } from '../../core/features/limits';
import { tenantDb } from '../../core/tenancy';
import { runAsSystem } from '../../core/queue';
import './certificates.templates';

registerDocumentOwnerType({
  type: 'student',
  resolveScope: async (id) => {
    const s = await tenantDb().student.findUnique({
      where: { id },
      select: { groupId: true, institutionId: true, campusId: true, departmentId: true },
    });
    return s;
  },
  selfAccess: {
    actions: ['view', 'download'],
    // The student themself and their linked guardians (parent portal) own the documents.
    ownedIds: async (principal) =>
      principal.userId
        ? (
            await tenantDb().student.findMany({
              where: {
                OR: [
                  { userId: principal.userId },
                  { guardians: { some: { guardian: { userId: principal.userId } } } },
                ],
              },
              select: { id: true },
            })
          ).map((s) => s.id)
        : [],
  },
});

registerDocumentOwnerType({
  type: 'admission_application',
  resolveScope: async (id) => {
    const a = await tenantDb().admissionApplication.findUnique({
      where: { id },
      select: { groupId: true, institutionId: true, departmentId: true },
    });
    return a
      ? {
          groupId: a.groupId,
          institutionId: a.institutionId,
          departmentId: a.departmentId,
          campusId: null,
        }
      : null;
  },
});

for (const [key, label] of [
  ['student.created', 'Student created'],
  ['student.updated', 'Student updated'],
  ['student.promoted', 'Student promoted'],
  ['student.withdrawn', 'Student withdrawn'],
  ['student.graduated', 'Student graduated'],
  ['admission.submitted', 'Admission submitted'],
  ['admission.approved', 'Admission approved'],
  ['admission.rejected', 'Admission rejected'],
  ['admission.enrolled', 'Admission enrolled'],
  ['student.certificate_issued', 'Transfer / character certificate issued'],
  ['student.certificate_cancelled', 'Transfer / character certificate cancelled'],
] as const)
  registerEventType({ key, label, webhook: true });

registerUsageSource('students', (organizationId) =>
  runAsSystem(organizationId, () =>
    tenantDb().student.count({ where: { status: { in: ['ACTIVE', 'INACTIVE'] } } }),
  ),
);

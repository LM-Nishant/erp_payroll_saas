import { registerDocumentOwnerType } from '../../core/documents/owners';
import { registerEventType } from '../../core/events';
import { registerUsageSource } from '../../core/features/limits';
import { registerNotificationEvent } from '../../core/notifications';
import {
  defineJob,
  defineRecurringJob,
  enqueue,
  forEachActiveOrganization,
  runAsSystem,
} from '../../core/queue';
import { tenantDb } from '../../core/tenancy';
import {
  registerReportingManagerResolver,
  registerWorkflowEntity,
} from '../../core/workflow/registry';
import { employeeIdsForUser, reportingManagerUserIds } from './employees.assignment';
import './employees.import';
import './employees.letters';
import {
  applyDueMovements,
  TRANSFER_WORKFLOW,
  transferWorkflowCallbacks,
} from './employees.movements';
import { PROFILE_CHANGE_WORKFLOW, profileChangeWorkflowCallbacks } from './employees.self-service';

/*
 * HR employee master (Layer 6) registrations — imported once from `apps/api/src/engines.ts`.
 */

/* ---- documents: employee-owned documents, self-access for the employee's own user ---- */
registerDocumentOwnerType({
  type: 'employee',
  resolveScope: async (id) => {
    const e = await tenantDb().employee.findUnique({
      where: { id },
      select: { groupId: true, institutionId: true, campusId: true, departmentId: true },
    });
    return e
      ? {
          groupId: e.groupId,
          institutionId: e.institutionId,
          campusId: e.campusId,
          departmentId: e.departmentId,
        }
      : null;
  },
  selfAccess: {
    actions: ['view', 'download'],
    ownedIds: async (principal) => (principal.userId ? employeeIdsForUser(principal.userId) : []),
  },
});

/* ---- workflow ---- */
registerWorkflowEntity({
  entityType: TRANSFER_WORKFLOW,
  label: 'Employee transfer / movement',
  linkFor: (i) => {
    const employeeId = i.context.employeeId;
    return typeof employeeId === 'string'
      ? `/hr/employees/${employeeId}?tab=movements`
      : '/hr/employees';
  },
  ...transferWorkflowCallbacks,
});
registerWorkflowEntity({
  entityType: PROFILE_CHANGE_WORKFLOW,
  label: 'Employee profile change',
  linkFor: (i) => {
    const employeeId = i.context.employeeId;
    return typeof employeeId === 'string' ? `/hr/employees/${employeeId}` : '/me/employee';
  },
  ...profileChangeWorkflowCallbacks,
});
registerReportingManagerResolver(reportingManagerUserIds);

/* ---- domain events (all webhook-deliverable) ---- */
const EVENTS: [string, string][] = [
  ['employee.created', 'Employee created'],
  ['employee.updated', 'Employee updated'],
  ['employee.deleted', 'Draft employee deleted'],
  ['employee.activated', 'Employee activated (joined)'],
  ['employee.confirmed', 'Employee confirmed after probation'],
  ['employee.resigned', 'Employee resignation recorded'],
  ['employee.exited', 'Employee exited'],
  ['employee.rehired', 'Employee rehired'],
  ['employee.transferred', 'Employee transferred'],
  ['employee.promoted', 'Employee promoted / designation changed'],
  ['employee.reassigned', 'Employee reassigned (department / manager)'],
  ['employee.salary_revised', 'Employee salary revised'],
];
for (const [key, label] of EVENTS) registerEventType({ key, label, webhook: true });

/* ---- notifications ---- */
registerNotificationEvent({
  key: 'employee.joined',
  label: 'New employee joining',
  defaultChannels: ['in_app', 'email'],
});
registerNotificationEvent({
  key: 'employee.transferred',
  label: 'Employee transferred',
  defaultChannels: ['in_app', 'email'],
});
registerNotificationEvent({
  key: 'employee.exiting',
  label: 'Employee resignation / notice period',
  defaultChannels: ['in_app', 'email'],
});
registerNotificationEvent({
  key: 'employee.exited',
  label: 'Employee exited',
  defaultChannels: ['in_app', 'email'],
});
registerNotificationEvent({
  key: 'employee.profile_change_decided',
  label: 'Profile change request decided',
  defaultChannels: ['in_app'],
});

/* ---- plan limits: active headcount (everything not exited) ---- */
registerUsageSource('employees', (organizationId) =>
  runAsSystem(organizationId, () =>
    tenantDb().employee.count({ where: { status: { not: 'EXITED' } } }),
  ),
);

/* ---- scheduled movements (future-dated transfers / promotions) ---- */
export const APPLY_MOVEMENTS_JOB = 'hr.apply_scheduled_movements';
const DAY = 24 * 60 * 60 * 1000;
defineJob<{ organizationId: string }>({
  name: APPLY_MOVEMENTS_JOB,
  attempts: 3,
  handler: async () => {
    await applyDueMovements();
  },
});
defineRecurringJob({
  name: `${APPLY_MOVEMENTS_JOB}.schedule`,
  everyMs: DAY / 4,
  handler: async () => {
    const bucket = Math.floor(Date.now() / (DAY / 4));
    await forEachActiveOrganization(async (organizationId) => {
      await enqueue(
        APPLY_MOVEMENTS_JOB,
        { organizationId },
        { jobId: `${APPLY_MOVEMENTS_JOB}:${organizationId}:${bucket}` },
      );
    });
  },
});

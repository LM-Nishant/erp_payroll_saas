import { registerEventType } from '../../core/events';
import { registerNotificationEvent } from '../../core/notifications';
import {
  defineJob,
  defineRecurringJob,
  enqueue,
  forEachActiveOrganization,
} from '../../core/queue';
import { tenantDb } from '../../core/tenancy';
import { registerWorkflowEntity } from '../../core/workflow/registry';
import { LEAVE_WORKFLOW, leaveWorkflowCallbacks } from '../leave/leave.requests';
import { runAccrual } from '../leave/leave.service';
import { computeAttendance } from './attendance.compute';
import {
  REGULARIZATION_WORKFLOW,
  regularizationWorkflowCallbacks,
} from './attendance.regularization';
import { addDays, dateToStr } from './time';

/*
 * Time office (Layer 7: attendance, leave, holidays, shifts) registrations — imported once from
 * `apps/api/src/engines.ts`.
 */

/* ---- workflows ---- */
registerWorkflowEntity({
  entityType: REGULARIZATION_WORKFLOW,
  label: 'Attendance regularization',
  linkFor: () => '/hr/attendance?tab=regularizations',
  ...regularizationWorkflowCallbacks,
});
registerWorkflowEntity({
  entityType: LEAVE_WORKFLOW,
  label: 'Leave request',
  linkFor: () => '/hr/leave',
  ...leaveWorkflowCallbacks,
});

/* ---- events ---- */
const EVENTS: [string, string][] = [
  ['attendance.regularization_requested', 'Attendance regularization requested'],
  ['attendance.regularized', 'Attendance regularized'],
  ['attendance.period_locked', 'Attendance period locked'],
  ['attendance.period_unlocked', 'Attendance period unlocked'],
  ['leave.applied', 'Leave applied'],
  ['leave.approved', 'Leave approved'],
  ['leave.rejected', 'Leave rejected'],
  ['leave.cancelled', 'Leave cancelled'],
];
for (const [key, label] of EVENTS) registerEventType({ key, label, webhook: true });

/* ---- notifications ---- */
const NOTIFICATIONS: [string, string][] = [
  ['leave.applied', 'Leave applied (to the reporting manager)'],
  ['leave.approved', 'Leave approved'],
  ['leave.rejected', 'Leave rejected'],
  ['leave.cancelled', 'Leave cancelled by HR'],
  ['attendance.regularization_decided', 'Attendance regularization decided'],
];
for (const [key, label] of NOTIFICATIONS) {
  registerNotificationEvent({ key, label, defaultChannels: ['in_app', 'email'] });
}

/* ---- jobs ---- */
const DAY = 24 * 60 * 60 * 1000;

/** Daily: recompute the last 3 days (late punches / imports) of every computable employee. */
export const RECOMPUTE_ATTENDANCE_JOB = 'attendance.daily_recompute';
defineJob<{ organizationId: string }>({
  name: RECOMPUTE_ATTENDANCE_JOB,
  attempts: 3,
  handler: async () => {
    const today = dateToStr(new Date());
    const rows = await tenantDb().employee.findMany({
      where: { status: { in: ['ACTIVE', 'ON_NOTICE'] } },
      select: { id: true },
    });
    await computeAttendance(
      rows.map((r) => r.id),
      addDays(today, -3),
      addDays(today, -1),
    );
  },
});

/** Daily: post due leave accruals (idempotent per period). */
export const LEAVE_ACCRUAL_JOB = 'leave.daily_accrual';
defineJob<{ organizationId: string }>({
  name: LEAVE_ACCRUAL_JOB,
  attempts: 3,
  handler: async () => {
    await runAccrual(dateToStr(new Date()));
  },
});

defineRecurringJob({
  name: 'time_office.daily.schedule',
  everyMs: DAY,
  handler: async () => {
    const bucket = Math.floor(Date.now() / DAY);
    await forEachActiveOrganization(async (organizationId) => {
      for (const name of [RECOMPUTE_ATTENDANCE_JOB, LEAVE_ACCRUAL_JOB]) {
        await enqueue(name, { organizationId }, { jobId: `${name}:${organizationId}:${bucket}` });
      }
    });
  },
});

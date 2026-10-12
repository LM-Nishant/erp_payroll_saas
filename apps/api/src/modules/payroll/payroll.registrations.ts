import { registerEventType } from '../../core/events';
import { registerNotificationEvent } from '../../core/notifications';
import { defineJob } from '../../core/queue';
import { registerWorkflowEntity } from '../../core/workflow/registry';
import {
  COMPUTE_BATCH_JOB,
  GENERATE_PAYSLIPS_JOB,
  PAYROLL_EVENTS,
  PAYROLL_NOTIFICATIONS,
  PAYROLL_RUN_WORKFLOW,
  REFRESH_PAYSLIP_PDFS_JOB,
  REIMBURSEMENT_WORKFLOW,
} from './payroll.constants';
import { reimbursementWorkflowCallbacks } from './payroll.loans';
import { generatePayslipsJob, refreshPayslipPdfsJob } from './payroll.payslips';
import './payroll.reports';
import {
  computeBatchJob,
  payrollRunWorkflowCallbacks,
  type ComputeBatchJob,
  type PayslipJob,
  type PayslipRefreshJob,
} from './payroll.runs';
import { SALARY_REVISION_WORKFLOW, salaryRevisionWorkflowCallbacks } from './payroll.salary';

/*
 * Payroll (Layer 8) registrations — imported once from `apps/api/src/engines.ts`. Importing
 * payroll.payslips / payroll.reports registers their PDF templates.
 */

/* ---- workflows ---- */
registerWorkflowEntity({
  entityType: SALARY_REVISION_WORKFLOW,
  label: 'Salary revision',
  ...salaryRevisionWorkflowCallbacks,
});
registerWorkflowEntity({
  entityType: PAYROLL_RUN_WORKFLOW,
  label: 'Payroll run',
  ...payrollRunWorkflowCallbacks,
});
registerWorkflowEntity({
  entityType: REIMBURSEMENT_WORKFLOW,
  label: 'Reimbursement claim',
  ...reimbursementWorkflowCallbacks,
});

/* ---- events ---- */
const EVENTS: [string, string][] = [
  [PAYROLL_EVENTS.runComputed, 'Payroll run computed'],
  [PAYROLL_EVENTS.runApproved, 'Payroll run approved'],
  [PAYROLL_EVENTS.runFinalized, 'Payroll run finalized'],
  [PAYROLL_EVENTS.runReopened, 'Payroll run reopened'],
  [PAYROLL_EVENTS.payslipPublished, 'Payslip published'],
];
for (const [key, label] of EVENTS) registerEventType({ key, label, webhook: true });

/* ---- notifications ---- */
const NOTIFICATIONS: [string, string][] = [
  [PAYROLL_NOTIFICATIONS.payslipPublished, 'Payslip published'],
  [PAYROLL_NOTIFICATIONS.form16Published, 'Form 16 published'],
  [PAYROLL_NOTIFICATIONS.runPendingApproval, 'Payroll run awaiting approval'],
  [PAYROLL_NOTIFICATIONS.runFinalized, 'Payroll run finalized'],
  [PAYROLL_NOTIFICATIONS.salaryRevised, 'Salary revised'],
  [PAYROLL_NOTIFICATIONS.reimbursementDecided, 'Reimbursement claim decided'],
];
for (const [key, label] of NOTIFICATIONS) {
  registerNotificationEvent({ key, label, defaultChannels: ['in_app', 'email'] });
}

/* ---- jobs ---- */
defineJob<ComputeBatchJob>({
  name: COMPUTE_BATCH_JOB,
  attempts: 3,
  handler: (data) => computeBatchJob(data),
});
defineJob<PayslipJob>({
  name: GENERATE_PAYSLIPS_JOB,
  attempts: 3,
  handler: (data) => generatePayslipsJob(data),
});
defineJob<PayslipRefreshJob>({
  name: REFRESH_PAYSLIP_PDFS_JOB,
  attempts: 1,
  handler: (data) => refreshPayslipPdfsJob(data),
});

/** Shared payroll keys (workflows, jobs, events, notifications). */
export const PAYROLL_RUN_WORKFLOW = 'payroll_run';
export const REIMBURSEMENT_WORKFLOW = 'reimbursement_claim';

export const COMPUTE_BATCH_JOB = 'payroll.compute_batch';
export const GENERATE_PAYSLIPS_JOB = 'payroll.generate_payslips';

export const PAYROLL_EVENTS = {
  runComputed: 'payroll.run_computed',
  runApproved: 'payroll.run_approved',
  runFinalized: 'payroll.run_finalized',
  runReopened: 'payroll.run_reopened',
  payslipPublished: 'payslip.published',
} as const;

export const PAYROLL_NOTIFICATIONS = {
  payslipPublished: 'payroll.payslip_published',
  form16Published: 'payroll.form16_published',
  runPendingApproval: 'payroll.run_pending_approval',
  runFinalized: 'payroll.run_finalized',
  salaryRevised: 'payroll.salary_revised',
  reimbursementDecided: 'payroll.reimbursement_decided',
} as const;

/** Run statuses in which computed data is frozen (mirrors the DB triggers). */
export const LOCKED_RUN_STATUSES = [
  'PENDING_APPROVAL',
  'APPROVED',
  'FINALIZED',
  'REOPENED',
  'CANCELLED',
] as const;
/** Runs that still "own" their institution + period. */
export const CLOSED_RUN_STATUSES = ['REOPENED', 'CANCELLED'];

export const COMPUTE_BATCH_SIZE = 50;

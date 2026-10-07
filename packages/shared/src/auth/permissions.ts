/**
 * Permission catalog — the single source of truth for permission codes, shared by the API
 * (authorization + DB sync) and the web app (permission-driven menus).
 *
 * Code format: `<resource>.<action>` (lower snake_case segments, dot separated; extra
 * segments allowed, e.g. `ai.action.send_message`). Later layers ADD codes here; never
 * rename or reuse a code. Codes starting with `platform.` are platform-level and can only be
 * granted through platform roles.
 */
export const PERMISSIONS = {
  // Platform (cross-tenant; platform roles only)
  'platform.organization.view': 'View all organizations on the platform',
  'platform.organization.manage': 'Create / suspend organizations',
  'platform.tenant.access': 'Open an audited support session inside a tenant',
  'platform.audit.view': 'View platform-wide audit logs',
  'platform.plan.manage': 'Create and edit subscription plans',
  'platform.subscription.manage': 'Manage organization subscriptions and invoices',
  'platform.secret.rotate_keys': 'Re-wrap tenant secrets to the active master key',

  // Organization & hierarchy
  'organization.view': 'View the organization profile',
  'organization.update': 'Update the organization profile',
  'group.view': 'View education groups',
  'group.create': 'Create education groups',
  'group.update': 'Update education groups',
  'group.delete': 'Delete education groups',
  'institution.view': 'View institutions',
  'institution.create': 'Create institutions',
  'institution.update': 'Update institutions',
  'institution.delete': 'Delete institutions',
  'campus.view': 'View campuses',
  'campus.create': 'Create campuses',
  'campus.update': 'Update campuses',
  'campus.delete': 'Delete campuses',
  'department.view': 'View departments',
  'department.create': 'Create departments',
  'department.update': 'Update departments',
  'department.delete': 'Delete departments',
  'program.view': 'View programs / courses',
  'program.create': 'Create programs / courses',
  'program.update': 'Update programs / courses',
  'program.delete': 'Delete programs / courses',
  'class_section.view': 'View classes / sections',
  'class_section.create': 'Create classes / sections',
  'class_section.update': 'Update classes / sections',
  'class_section.delete': 'Delete classes / sections',

  // Users, roles, audit
  'user.view': 'View users',
  'user.create': 'Invite / create users',
  'user.update': 'Update user profiles',
  'user.deactivate': 'Deactivate / reactivate users',
  'user.reset_password': 'Issue password reset links',
  'user.role.assign': 'Assign roles and scopes to users',
  'role.view': 'View roles and permissions',
  'role.manage': 'Create and edit custom roles',
  'audit.view': 'View audit logs',

  // Subscription, module licensing, branding, secrets
  'subscription.view': 'View the subscription plan, limits and usage',
  'billing.view': 'View subscription invoices and payment status',
  'billing.pay': 'Report UPI payments (UTR) against subscription invoices',
  'feature.view': 'View enabled modules / features',
  'feature.manage': 'Enable or disable licensed modules per group / institution',
  'branding.view': 'View branding settings',
  'branding.manage': 'Edit branding settings',
  'secret.view': 'View configured secrets (masked)',
  'secret.manage': 'Create, rotate and delete secrets',

  // Workflow, notification, communication & integration engines (Layer 5)
  'workflow.view': 'View approval workflow definitions and all approval requests in scope',
  'workflow.manage': 'Create, version and activate approval workflow definitions',
  'notification.manage': 'Configure notification rules (event → channels / recipients)',
  'communication.view': 'View communication providers, templates, campaigns and message logs',
  'communication.manage': 'Configure communication providers and message templates',
  'integration.view': 'View API clients, webhooks and integration credentials',
  'integration.manage': 'Manage API clients, webhooks and integration credentials',

  // Domain permissions used by later layers (spec §3)
  'student.view': 'View students',
  'student.create': 'Create students',
  'student.update': 'Update students',
  'student.delete': 'Delete students',
  'student.import': 'Bulk import students from CSV',
  'student.view_own': 'View own student profile (self-service)',
  'student.lifecycle': 'Promote, withdraw and graduate students',
  'admission.view': 'View admission applications',
  'admission.manage': 'Create, decide and enroll admission applications',
  'guardian.manage': 'Create and link guardians / parent logins',
  'ward.view': 'Parent / guardian access to linked children',
  'employee.view': 'View employees',
  'employee.create': 'Create employees',
  'employee.update': 'Update employees',
  'employee.delete': 'Delete draft employees',
  'employee.lifecycle': 'Run employee lifecycle actions (onboard, confirm, resign, exit, rehire)',
  'employee.transfer': 'Request transfers, promotions and designation / reporting changes',
  'employee.view_sensitive': 'Reveal statutory ids and bank details (audited)',
  'employee.import': 'Bulk import employees from CSV',
  'employee.export': 'Export employee lists',
  'employee.view_own': 'View own employee profile (self-service)',
  'employee.update_own': 'Request changes to own personal details (self-service)',
  'designation.view': 'View designations',
  'designation.manage': 'Create and update designations and employee code numbering',
  'holiday.view': 'View holiday calendars',
  'holiday.manage': 'Manage holiday calendars, holidays and weekly-off patterns',
  'shift.view': 'View shifts and shift assignments',
  'shift.manage': 'Manage shifts and shift assignments',
  'attendance.view': 'View attendance registers, punches and payroll attendance summaries',
  'attendance.manage': 'Correct attendance, recompute days and set attendance policies',
  'attendance.import': 'Import punches from biometric devices / integrations',
  'attendance.lock': 'Lock attendance periods',
  'attendance.unlock': 'Unlock locked attendance periods (audited)',
  'attendance.view_own': 'View own attendance (self-service)',
  'attendance.punch_own': 'Punch in / out (self-service web / mobile)',
  'attendance.regularize_own': 'Request regularization of own attendance (self-service)',
  'leave.view': 'View leave requests and balances',
  'leave.manage': 'Manage leave types and leave policies',
  'leave.apply': 'Apply / cancel leave on behalf of employees',
  'leave.adjust': 'Adjust / encash leave balances and run accrual / year-end',
  'leave.view_own': 'View own leave balances and requests (self-service)',
  'leave.apply_own': 'Apply for and cancel own leave (self-service)',
  'payroll.view': 'View payroll',
  'payroll.process': 'Process payroll',
  'payroll.approve': 'Approve payroll',
  'payroll.lock': 'Lock payroll',
  'salary.view': 'View salaries',
  'salary.update': 'Update salaries',
  'payroll.manage': 'Manage salary components, structures, rules and statutory settings',
  'payroll.reopen': 'Reopen a finalized payroll run (audited, creates a new revision)',
  'payroll.disburse': 'Export bank files and record payroll payments',
  'payroll.report': 'Payroll registers, statutory and group consolidated reports',
  'payroll.view_own': 'View and download own payslips and Form 16',
  'form16.manage': 'Upload and publish Form 16 documents',
  'reimbursement.claim_own': 'Submit own reimbursement claims',
  'asset.view': 'View assets',
  'asset.assign': 'Assign assets',
  'asset.return': 'Return assets',
  'asset.manage': 'Manage asset categories, the asset register, inventory and transfers',
  'asset.dispose': 'Request and approve asset disposal / write-off',
  'asset.maintain': 'Raise and manage asset maintenance tickets, AMC and service schedules',
  'asset.audit': 'Run physical asset verification audits',
  'asset.view_own': 'View, acknowledge and report issues on assets in own custody',
  'document.view': 'View documents',
  'document.upload': 'Upload documents',
  'document.delete': 'Delete documents',
  'document.download': 'Download documents (issues audited short-lived signed URLs)',
  'document.manage': 'Edit document metadata, expiry reminders and signature requests',
  'document.share': 'Grant / revoke explicit per-document access',
  'document.view_confidential': 'View CONFIDENTIAL documents in scope (RESTRICTED needs org scope)',
  'document.view_own': 'View documents owned by oneself (owner self-access, e.g. own payslips)',
  'pdf.generate': 'Generate PDFs from templates (stored as documents)',
  'message.send': 'Send messages',
  'message.schedule': 'Schedule messages',
  'ai.use': 'Use AI assistants',
  'ai.configure': 'Configure AI providers',
  'ai.action.send_message': 'Allow AI to send messages',
  // ===== AI =====
  'ai.manage': 'Manage organization AI settings (provider, model, enabled features, limits)',
  'ai.view_usage': 'View AI usage dashboards (tokens by feature / user / day)',
} as const satisfies Record<string, string>;

export type PermissionCode = keyof typeof PERMISSIONS;

export const PERMISSION_CODES = Object.keys(PERMISSIONS) as PermissionCode[];

export const PERMISSION_CODE_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

export function isPlatformPermission(code: string): boolean {
  return code.startsWith('platform.');
}

/**
 * Permissions an API client (machine integration) may NEVER hold: platform, secret,
 * integration and access-control administration.
 */
const API_CLIENT_FORBIDDEN_PREFIXES = ['platform.', 'secret.', 'integration.', 'ai.'];
const API_CLIENT_FORBIDDEN_CODES = new Set([
  'user.create',
  'user.deactivate',
  'user.reset_password',
  'role.manage',
  'user.role.assign',
  'feature.manage',
  'subscription.manage',
]);

export function isApiClientScopeAllowed(code: string): boolean {
  return (
    code in PERMISSIONS &&
    !API_CLIENT_FORBIDDEN_PREFIXES.some((p) => code.startsWith(p)) &&
    !API_CLIENT_FORBIDDEN_CODES.has(code)
  );
}

/** The `<resource>` part of a code, used as the module column of the catalog. */
export function permissionModule(code: string): string {
  return code.split('.')[0] ?? code;
}

export const SCOPE_TYPES = [
  'ORGANIZATION',
  'GROUP',
  'INSTITUTION',
  'CAMPUS',
  'DEPARTMENT',
] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];

import {
  PERMISSION_CODES,
  isPlatformPermission,
  type PermissionCode,
  type ScopeType,
} from '@erp/shared';

/**
 * Default roles from SPEC §3. Authorization never checks role NAMES — roles are just bundles
 * of permissions; checks are always `permission + scope`. Tenant roles are provisioned per
 * organization (core/authz/provisioning.ts) and can then be customised by tenant admins.
 *
 * Later layers: when you add permissions to the catalog, add them to the relevant default
 * roles here. `provisionOrganizationRoles` re-syncs system roles idempotently.
 */
export interface DefaultRoleDefinition {
  key: string;
  name: string;
  description: string;
  /** Scope type this role is normally assigned at (UI hint; not enforced). */
  typicalScope: ScopeType;
  permissions: readonly PermissionCode[];
}

const ALL_TENANT = PERMISSION_CODES.filter((c) => !isPlatformPermission(c));
const pick = (...prefixes: string[]) =>
  ALL_TENANT.filter((c) => prefixes.some((p) => c === p || c.startsWith(`${p}.`)));
const views = (...resources: string[]) => resources.map((r) => `${r}.view` as PermissionCode);
const HIERARCHY = ['group', 'institution', 'campus', 'department', 'program', 'class_section'];
const ACADEMIC_STRUCTURE_VIEW = views('organization', ...HIERARCHY);

/** Attendance / leave / holiday / shift (Layer 7). Unlocking a locked period is NOT included. */
const TIME_OFFICE = pick('holiday', 'shift', 'attendance', 'leave').filter(
  (c) => c !== 'attendance.unlock',
);
/** Self-service attendance / leave for anyone who is also an employee. */
const TIME_SELF_SERVICE = [
  'attendance.view_own',
  'attendance.punch_own',
  'attendance.regularize_own',
  'leave.view_own',
  'leave.apply_own',
] as PermissionCode[];
/** Read access used by payroll / finance (attendance summary = payroll feed). */
const TIME_VIEW = views('holiday', 'shift', 'attendance', 'leave');

/** Fees & finance administration (everything except the student/parent self-service code). */
const FEES_FINANCE = pick('fee', 'finance').filter((c) => c !== 'fee.view_own');
const FEES_FINANCE_VIEW = ['fee.view', 'finance.view'] as PermissionCode[];
/** Asset custody (view / check-out / check-in) for institution admins and HR. */
const ASSET_CUSTODY = ['asset.view', 'asset.assign', 'asset.return'] as PermissionCode[];
/** Academics, timetable, student attendance & exams. */
const ACADEMICS_MANAGE = pick('subject', 'timetable', 'student_attendance', 'exam').filter(
  (c) => !c.endsWith('.view_own'),
);
/** Teachers: marking / marks entry restricted to allocated sections in the services. */
const ACADEMICS_TEACHING = [
  'subject.view',
  'timetable.view',
  'student_attendance.view',
  'student_attendance.mark',
  'exam.view',
  'exam.marks_entry',
] as PermissionCode[];
const ACADEMICS_SELF_SERVICE = [
  'timetable.view_own',
  'student_attendance.view_own',
  'exam.view_own',
] as PermissionCode[];

/** Full administration of everything below the group/institution level. */
const INSTITUTION_ADMIN = [
  ...ACADEMIC_STRUCTURE_VIEW,
  ...pick('campus', 'department', 'program', 'class_section'),
  'institution.update',
  ...pick(
    'user',
    'student',
    'admission',
    'guardian',
    'employee',
    'document',
    'message',
    'library',
    'transport',
    'hostel',
  ).filter(
    (c) => c !== 'employee.view_sensitive' && !(/^(transport|hostel)\./.test(c) && /_own$/.test(c)),
  ),
  // Assets: admins see and hand out assets; register management sits with asset_manager.
  ...ASSET_CUSTODY,
  'designation.view',
  ...TIME_OFFICE,
  'role.view',
  'audit.view',
  'payroll.view',
  'salary.view',
  'ai.use',
  'feature.view',
  'branding.view',
  'branding.manage',
  'pdf.generate',
  'workflow.view',
  'communication.view',
  ...FEES_FINANCE,
  ...ACADEMICS_MANAGE,
] as PermissionCode[];

const GROUP_ADMIN = [
  ...INSTITUTION_ADMIN,
  'institution.create',
  'institution.delete',
  'group.update',
  'attendance.unlock',
  'feature.manage',
  'secret.view',
  'workflow.manage',
  'notification.manage',
  'communication.manage',
  'integration.view',
  'ai.manage',
  'ai.view_usage',
] as PermissionCode[];

const HR = [
  ...ACADEMIC_STRUCTURE_VIEW,
  'workflow.view',
  ...pick('employee', 'document', 'designation'),
  ...TIME_OFFICE,
  'pdf.generate',
  'user.view',
  'salary.view',
  'salary.update',
  'payroll.view',
  'payroll.report',
  'message.send',
  'ai.use',
  ...ASSET_CUSTODY,
] as PermissionCode[];

const FINANCE = [
  ...ACADEMIC_STRUCTURE_VIEW,
  'payroll.view',
  'payroll.approve',
  'payroll.lock',
  'payroll.report',
  'payroll.disburse',
  'salary.view',
  'employee.view',
  ...TIME_VIEW,
  'designation.view',
  'document.view',
  'document.download',
  'asset.view',
  'audit.view',
  'ai.use',
  'billing.view',
  'billing.pay',
  'subscription.view',
  ...FEES_FINANCE,
  'student.view',
] as PermissionCode[];

const ACADEMIC_LEAD = [
  ...ACADEMIC_STRUCTURE_VIEW,
  ...pick('student', 'program', 'class_section'),
  ...pick('admission', 'guardian'),
  'employee.view',
  'attendance.view',
  'leave.view',
  ...TIME_SELF_SERVICE,
  'user.view',
  'document.view',
  'document.download',
  'document.upload',
  'message.send',
  'message.schedule',
  'ai.use',
  ...ACADEMICS_MANAGE,
] as PermissionCode[];

const TEACHING = [
  ...ACADEMIC_STRUCTURE_VIEW,
  ...TIME_SELF_SERVICE,
  'student.view',
  'document.view',
  'document.download',
  'document.upload',
  'message.send',
  'ai.use',
  ...ACADEMICS_TEACHING,
] as PermissionCode[];

/**
 * Self-service users see only documents they OWN (owner self-access, e.g. own payslips) —
 * never every document of their institution.
 */
const SELF_SERVICE = [
  'organization.view',
  'document.view_own',
  'ai.use',
  'library.view_own',
] as PermissionCode[];
/** Portal "My transport" / "My hostel" (own record for students, wards for parents). */
const TRANSPORT_HOSTEL_SELF_SERVICE = [
  'transport.view_own',
  'hostel.view_own',
  'hostel.apply_own',
] as PermissionCode[];
const STUDENT_SELF_SERVICE = [
  ...SELF_SERVICE,
  'student.view_own',
  'fee.view_own',
  ...ACADEMICS_SELF_SERVICE,
  ...TRANSPORT_HOSTEL_SELF_SERVICE,
] as PermissionCode[];
const PARENT_SELF_SERVICE = [
  ...SELF_SERVICE,
  'ward.view',
  'fee.view_own',
  ...ACADEMICS_SELF_SERVICE,
  ...TRANSPORT_HOSTEL_SELF_SERVICE,
] as PermissionCode[];

/** Employee self-service adds the own-profile APIs (`/employees/me`). */
const EMPLOYEE_SELF_SERVICE = [
  ...SELF_SERVICE,
  'employee.view_own',
  'employee.update_own',
  ...TIME_SELF_SERVICE,
  'payroll.view_own',
  'reimbursement.claim_own',
  'asset.view_own',
] as PermissionCode[];

/** Payroll preparation (Layer 8): masters, runs, loans, Form 16; never approves its own runs. */
const PAYROLL = [
  ...ACADEMIC_STRUCTURE_VIEW,
  'employee.view',
  ...TIME_VIEW,
  'payroll.view',
  'payroll.process',
  'payroll.manage',
  'payroll.report',
  'payroll.disburse',
  'form16.manage',
  'salary.view',
  'salary.update',
  'document.view',
  'document.download',
  // Payslips / Form 16 are CONFIDENTIAL documents.
  'document.view_confidential',
  'ai.use',
] as PermissionCode[];

export const DEFAULT_TENANT_ROLES: readonly DefaultRoleDefinition[] = (
  [
    {
      key: 'group_owner',
      name: 'Group Owner',
      description: 'Owner of the education group / tenant; full tenant access',
      typicalScope: 'ORGANIZATION',
      permissions: ALL_TENANT,
    },
    {
      key: 'group_admin',
      name: 'Group Admin',
      description: 'Administers all institutions in assigned groups',
      typicalScope: 'GROUP',
      permissions: GROUP_ADMIN,
    },
    {
      key: 'group_hr',
      name: 'Group HR',
      description: 'HR across assigned groups',
      typicalScope: 'GROUP',
      permissions: HR,
    },
    {
      key: 'group_finance',
      name: 'Group Finance',
      description: 'Finance across assigned groups',
      typicalScope: 'GROUP',
      // Group finance may also reopen a finalized payroll (explicit, audited).
      permissions: [...FINANCE, 'payroll.reopen'],
    },
    {
      key: 'institution_owner',
      name: 'Institution Owner',
      description: 'Owner of assigned institutions',
      typicalScope: 'INSTITUTION',
      permissions: [
        ...INSTITUTION_ADMIN,
        'designation.manage',
        'payroll.approve',
        'payroll.lock',
        'attendance.unlock',
      ],
    },
    {
      key: 'institution_admin',
      name: 'Institution Admin',
      description: 'Administers assigned institutions only',
      typicalScope: 'INSTITUTION',
      permissions: INSTITUTION_ADMIN,
    },
    {
      key: 'principal',
      name: 'Principal',
      description: 'Academic head of an institution',
      typicalScope: 'INSTITUTION',
      permissions: [
        ...ACADEMIC_LEAD,
        'employee.update',
        'audit.view',
        'library.view',
        ...FEES_FINANCE_VIEW,
      ],
    },
    {
      key: 'vice_principal',
      name: 'Vice Principal',
      description: 'Deputy academic head',
      typicalScope: 'INSTITUTION',
      permissions: ACADEMIC_LEAD,
    },
    {
      key: 'dean',
      name: 'Dean',
      description: 'Academic head of a faculty / set of departments',
      typicalScope: 'INSTITUTION',
      permissions: ACADEMIC_LEAD,
    },
    {
      key: 'registrar',
      name: 'Registrar',
      description: 'Student records and academic administration',
      typicalScope: 'INSTITUTION',
      permissions: [...ACADEMIC_LEAD, 'document.delete'],
    },
    {
      key: 'hod',
      name: 'HOD',
      description: 'Head of department; limited to assigned departments',
      typicalScope: 'DEPARTMENT',
      permissions: ACADEMIC_LEAD,
    },
    {
      key: 'academic_coordinator',
      name: 'Academic Coordinator',
      description: 'Subjects, timetable, attendance and examinations of an institution',
      typicalScope: 'INSTITUTION',
      permissions: ACADEMIC_LEAD,
    },
    {
      key: 'teacher',
      name: 'Teacher',
      description: 'Teaching staff',
      typicalScope: 'DEPARTMENT',
      permissions: TEACHING,
    },
    {
      key: 'faculty',
      name: 'Faculty',
      description: 'Faculty member (higher education)',
      typicalScope: 'DEPARTMENT',
      permissions: TEACHING,
    },
    {
      key: 'hr_manager',
      name: 'HR Manager',
      description: 'Institution HR',
      typicalScope: 'INSTITUTION',
      permissions: HR,
    },
    {
      key: 'payroll_manager',
      name: 'Payroll Manager',
      description: 'Prepares and processes payroll',
      typicalScope: 'INSTITUTION',
      permissions: PAYROLL,
    },
    {
      key: 'finance_manager',
      name: 'Finance Manager',
      description: 'Approves and locks payroll',
      typicalScope: 'INSTITUTION',
      permissions: FINANCE,
    },
    {
      key: 'accountant',
      name: 'Accountant',
      description: 'Accounting staff',
      typicalScope: 'INSTITUTION',
      permissions: [
        ...ACADEMIC_STRUCTURE_VIEW,
        'payroll.view',
        'payroll.report',
        'salary.view',
        'document.view',
        'document.download',
        'billing.view',
        'student.view',
        'fee.view',
        'fee.manage',
        'fee.collect',
        'finance.view',
        'finance.manage',
        'finance.post',
      ],
    },
    {
      key: 'it_admin',
      name: 'IT Admin',
      description: 'User accounts and system configuration',
      typicalScope: 'INSTITUTION',
      permissions: [
        ...ACADEMIC_STRUCTURE_VIEW,
        ...pick('user'),
        'role.view',
        'audit.view',
        'ai.configure',
        'ai.manage',
        'ai.view_usage',
        'feature.view',
        'branding.view',
        ...pick('secret', 'integration', 'communication'),
      ],
    },
    {
      key: 'asset_manager',
      name: 'Asset Manager',
      description: 'Manages assets',
      typicalScope: 'INSTITUTION',
      permissions: [
        ...ACADEMIC_STRUCTURE_VIEW,
        ...pick('asset').filter((c) => c !== 'asset.view_own'),
        'employee.view',
        'document.view',
        'document.upload',
        'document.download',
        'pdf.generate',
        'workflow.view',
      ],
    },
    {
      key: 'transport_manager',
      name: 'Transport Manager',
      description: 'Manages transport',
      typicalScope: 'INSTITUTION',
      permissions: [
        ...ACADEMIC_STRUCTURE_VIEW,
        'student.view',
        'employee.view',
        'message.send',
        'transport.view',
        'transport.manage',
        'transport.allocate',
        'document.view',
        'document.upload',
        'document.download',
      ],
    },
    {
      key: 'librarian',
      name: 'Librarian',
      description: 'Manages the library',
      typicalScope: 'INSTITUTION',
      permissions: [
        ...ACADEMIC_STRUCTURE_VIEW,
        'student.view',
        'employee.view',
        ...pick('library'),
        'message.send',
        'pdf.generate',
        'document.view',
        'document.upload',
      ],
    },
    {
      key: 'hostel_manager',
      name: 'Hostel Manager',
      description: 'Manages hostels',
      typicalScope: 'INSTITUTION',
      permissions: [
        ...ACADEMIC_STRUCTURE_VIEW,
        'student.view',
        'employee.view',
        'message.send',
        ...pick('hostel').filter((c) => !c.endsWith('_own')),
      ],
    },
    {
      key: 'hostel_warden',
      name: 'Hostel Warden',
      description: 'Runs a hostel day to day: allocations, out-pass approval, visitors, roll call',
      typicalScope: 'INSTITUTION',
      permissions: [
        ...ACADEMIC_STRUCTURE_VIEW,
        'student.view',
        'message.send',
        'hostel.view',
        'hostel.manage',
        'hostel.allocate',
        'hostel.outpass_approve',
      ],
    },
    {
      key: 'student',
      name: 'Student',
      description: 'Student self-service',
      typicalScope: 'INSTITUTION',
      permissions: STUDENT_SELF_SERVICE,
    },
    {
      key: 'parent',
      name: 'Parent',
      description: 'Parent / guardian self-service',
      typicalScope: 'INSTITUTION',
      permissions: PARENT_SELF_SERVICE,
    },
    {
      key: 'employee',
      name: 'Employee',
      description: 'Employee self-service',
      typicalScope: 'INSTITUTION',
      permissions: EMPLOYEE_SELF_SERVICE,
    },
  ] satisfies DefaultRoleDefinition[]
).map((r) => ({ ...r, permissions: [...new Set(r.permissions)] }));

/** Platform roles live in code and are assigned via PlatformRoleAssignment (never per tenant). */
export interface PlatformRoleDefinition {
  key: string;
  name: string;
  /** Platform-level permissions. */
  platformPermissions: readonly PermissionCode[];
  /** Tenant permissions granted (at ORGANIZATION scope) inside an audited tenant-access session. */
  tenantAccessPermissions: readonly PermissionCode[];
}

export const PLATFORM_ROLES: readonly PlatformRoleDefinition[] = [
  {
    key: 'platform_super_admin',
    name: 'Platform Super Admin',
    platformPermissions: PERMISSION_CODES.filter(isPlatformPermission),
    tenantAccessPermissions: ALL_TENANT,
  },
  {
    key: 'platform_support_admin',
    name: 'Platform Support Admin',
    platformPermissions: ['platform.organization.view', 'platform.tenant.access'],
    tenantAccessPermissions: ALL_TENANT.filter((c) => c.endsWith('.view')),
  },
];

export const PLATFORM_ROLE_KEYS = PLATFORM_ROLES.map((r) => r.key);
export const ALL_TENANT_PERMISSIONS: readonly PermissionCode[] = ALL_TENANT;

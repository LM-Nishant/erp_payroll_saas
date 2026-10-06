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

/** Full administration of everything below the group/institution level. */
const INSTITUTION_ADMIN = [
  ...ACADEMIC_STRUCTURE_VIEW,
  ...pick('campus', 'department', 'program', 'class_section'),
  'institution.update',
  ...pick('user', 'student', 'employee', 'asset', 'document', 'message'),
  'role.view',
  'audit.view',
  'payroll.view',
  'salary.view',
  'ai.use',
  'feature.view',
  'branding.view',
  'branding.manage',
  'pdf.generate',
] as PermissionCode[];

const GROUP_ADMIN = [
  ...INSTITUTION_ADMIN,
  'institution.create',
  'institution.delete',
  'group.update',
  'feature.manage',
  'secret.view',
] as PermissionCode[];

const HR = [
  ...ACADEMIC_STRUCTURE_VIEW,
  ...pick('employee', 'document'),
  'pdf.generate',
  'user.view',
  'salary.view',
  'payroll.view',
  'message.send',
  'ai.use',
] as PermissionCode[];

const FINANCE = [
  ...ACADEMIC_STRUCTURE_VIEW,
  'payroll.view',
  'payroll.approve',
  'payroll.lock',
  'salary.view',
  'employee.view',
  'document.view',
  'document.download',
  'asset.view',
  'audit.view',
  'ai.use',
  'billing.view',
  'subscription.view',
] as PermissionCode[];

const ACADEMIC_LEAD = [
  ...ACADEMIC_STRUCTURE_VIEW,
  ...pick('student', 'program', 'class_section'),
  'employee.view',
  'user.view',
  'document.view',
  'document.download',
  'document.upload',
  'message.send',
  'message.schedule',
  'ai.use',
] as PermissionCode[];

const TEACHING = [
  ...ACADEMIC_STRUCTURE_VIEW,
  'student.view',
  'document.view',
  'document.download',
  'document.upload',
  'message.send',
  'ai.use',
] as PermissionCode[];

/**
 * Self-service users see only documents they OWN (owner self-access, e.g. own payslips) —
 * never every document of their institution.
 */
const SELF_SERVICE = ['organization.view', 'document.view_own', 'ai.use'] as PermissionCode[];

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
      permissions: FINANCE,
    },
    {
      key: 'institution_owner',
      name: 'Institution Owner',
      description: 'Owner of assigned institutions',
      typicalScope: 'INSTITUTION',
      permissions: [...INSTITUTION_ADMIN, 'payroll.approve', 'payroll.lock'],
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
      permissions: [...ACADEMIC_LEAD, 'employee.update', 'audit.view'],
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
      permissions: [
        ...ACADEMIC_STRUCTURE_VIEW,
        'employee.view',
        'payroll.view',
        'payroll.process',
        'salary.view',
        'salary.update',
        'document.view',
        'document.download',
        'ai.use',
      ],
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
        'salary.view',
        'document.view',
        'document.download',
        'billing.view',
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
        'feature.view',
        'branding.view',
        ...pick('secret'),
      ],
    },
    {
      key: 'asset_manager',
      name: 'Asset Manager',
      description: 'Manages assets',
      typicalScope: 'INSTITUTION',
      permissions: [...ACADEMIC_STRUCTURE_VIEW, ...pick('asset'), 'employee.view'],
    },
    {
      key: 'transport_manager',
      name: 'Transport Manager',
      description: 'Manages transport',
      typicalScope: 'INSTITUTION',
      permissions: [...ACADEMIC_STRUCTURE_VIEW, 'student.view', 'message.send'],
    },
    {
      key: 'librarian',
      name: 'Librarian',
      description: 'Manages the library',
      typicalScope: 'INSTITUTION',
      permissions: [...ACADEMIC_STRUCTURE_VIEW, 'student.view', 'employee.view'],
    },
    {
      key: 'hostel_manager',
      name: 'Hostel Manager',
      description: 'Manages hostels',
      typicalScope: 'INSTITUTION',
      permissions: [...ACADEMIC_STRUCTURE_VIEW, 'student.view', 'message.send'],
    },
    {
      key: 'student',
      name: 'Student',
      description: 'Student self-service',
      typicalScope: 'INSTITUTION',
      permissions: SELF_SERVICE,
    },
    {
      key: 'parent',
      name: 'Parent',
      description: 'Parent / guardian self-service',
      typicalScope: 'INSTITUTION',
      permissions: SELF_SERVICE,
    },
    {
      key: 'employee',
      name: 'Employee',
      description: 'Employee self-service',
      typicalScope: 'INSTITUTION',
      permissions: SELF_SERVICE,
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

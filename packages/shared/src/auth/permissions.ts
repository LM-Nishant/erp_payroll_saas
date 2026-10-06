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

  // Domain permissions used by later layers (spec §3)
  'student.view': 'View students',
  'student.create': 'Create students',
  'student.update': 'Update students',
  'employee.view': 'View employees',
  'employee.create': 'Create employees',
  'employee.update': 'Update employees',
  'payroll.view': 'View payroll',
  'payroll.process': 'Process payroll',
  'payroll.approve': 'Approve payroll',
  'payroll.lock': 'Lock payroll',
  'salary.view': 'View salaries',
  'salary.update': 'Update salaries',
  'asset.view': 'View assets',
  'asset.assign': 'Assign assets',
  'asset.return': 'Return assets',
  'document.view': 'View documents',
  'document.upload': 'Upload documents',
  'document.delete': 'Delete documents',
  'message.send': 'Send messages',
  'message.schedule': 'Schedule messages',
  'ai.use': 'Use AI assistants',
  'ai.configure': 'Configure AI providers',
  'ai.action.send_message': 'Allow AI to send messages',
} as const satisfies Record<string, string>;

export type PermissionCode = keyof typeof PERMISSIONS;

export const PERMISSION_CODES = Object.keys(PERMISSIONS) as PermissionCode[];

export const PERMISSION_CODE_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

export function isPlatformPermission(code: string): boolean {
  return code.startsWith('platform.');
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

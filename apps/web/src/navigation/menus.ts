import type { FeatureKey } from '@erp/shared';

export interface MenuItem {
  title: string;
  icon: string;
  to: string;
  /** Permission code required to see the item (enforced by the backend as well). */
  permission?: string;
  /** Licensed module required to see the item (`/me.features`; backend: requireFeature). */
  feature?: FeatureKey;
  /** Label used for company (non-education) organizations. */
  companyTitle?: string;
  /**
   * Hidden for company organizations (students, campuses, academics…) unless the organization
   * licenses the `education` module, which turns these items back on.
   */
  educationOnly?: boolean;
}

export type OrgKind = 'EDUCATION' | 'COMPANY';

export type LayoutKey = 'platform' | 'group' | 'institution' | 'hr' | 'employee' | 'portal';

/**
 * Menus are data-driven and filtered by the permissions AND enabled modules (features) returned
 * from GET /api/v1/me. Later layers append items with the permission code that guards their API
 * and, for licensed modules, the feature key (e.g. `feature: 'payroll'`).
 */
export const MENUS: Record<LayoutKey, MenuItem[]> = {
  platform: [
    {
      title: 'Organizations',
      icon: 'mdi-domain',
      to: '/platform/organizations',
      permission: 'platform.organization.view',
    },
    {
      title: 'Plans',
      icon: 'mdi-tag-multiple',
      to: '/platform/plans',
      permission: 'platform.plan.manage',
    },
    {
      title: 'Invoices',
      icon: 'mdi-receipt-text',
      to: '/platform/invoices',
      permission: 'platform.subscription.manage',
    },
    {
      title: 'Billing settings',
      icon: 'mdi-qrcode',
      to: '/platform/billing-settings',
      permission: 'platform.subscription.manage',
    },
  ],
  group: [
    { title: 'Dashboard', icon: 'mdi-view-dashboard', to: '/group' },
    {
      title: 'Institutions',
      companyTitle: 'Companies / branches',
      icon: 'mdi-school',
      to: '/group/institutions',
      permission: 'institution.view',
    },
    {
      title: 'Students',
      icon: 'mdi-account-school',
      to: '/group/students',
      permission: 'student.view',
      feature: 'education',
      educationOnly: true,
    },
    {
      title: 'Admissions',
      icon: 'mdi-file-account',
      to: '/group/admissions',
      permission: 'admission.view',
      feature: 'education',
      educationOnly: true,
    },
    { title: 'Users', icon: 'mdi-account-group', to: '/group/users', permission: 'user.view' },
    { title: 'Approvals', icon: 'mdi-check-decagram', to: '/group/approvals' },
    {
      title: 'Payroll summary',
      icon: 'mdi-cash-multiple',
      to: '/group/payroll',
      permission: 'payroll.report',
      feature: 'payroll',
    },
    {
      title: 'Documents',
      icon: 'mdi-file-document-multiple',
      to: '/group/documents',
      permission: 'document.view',
      feature: 'documents',
    },
    {
      title: 'Subscription',
      icon: 'mdi-card-account-details-star',
      to: '/group/subscription',
      permission: 'subscription.view',
    },
    {
      title: 'Modules',
      icon: 'mdi-puzzle',
      to: '/group/modules',
      permission: 'feature.view',
    },
    {
      title: 'Branding',
      icon: 'mdi-palette',
      to: '/group/branding',
      permission: 'branding.view',
    },
    {
      title: 'Communication',
      icon: 'mdi-email-fast',
      to: '/group/communication',
      permission: 'communication.view',
      feature: 'communication',
    },
    {
      title: 'API & webhooks',
      icon: 'mdi-api',
      to: '/group/integrations',
      permission: 'integration.view',
    },
    { title: 'Secrets', icon: 'mdi-key-chain', to: '/group/secrets', permission: 'secret.view' },
    { title: 'AI tools', icon: 'mdi-robot', to: '/group/ai', permission: 'ai.use', feature: 'ai' },
    {
      title: 'AI settings',
      icon: 'mdi-robot-outline',
      to: '/group/ai/settings',
      permission: 'ai.manage',
      feature: 'ai',
    },
    {
      title: 'AI usage',
      icon: 'mdi-chart-box-outline',
      to: '/group/ai/usage',
      permission: 'ai.view_usage',
      feature: 'ai',
    },
    {
      title: 'Library',
      icon: 'mdi-bookshelf',
      to: '/group/library',
      permission: 'library.view',
      feature: 'library',
    },
    {
      title: 'Catalogue',
      icon: 'mdi-book-open-page-variant',
      to: '/group/library/catalogue',
      permission: 'library.view',
      feature: 'library',
    },
    {
      title: 'Library reports',
      icon: 'mdi-chart-box',
      to: '/group/library/reports',
      permission: 'library.view',
      feature: 'library',
    },
  ],
  institution: [
    { title: 'Dashboard', icon: 'mdi-view-dashboard', to: '/institution' },
    {
      title: 'Departments',
      icon: 'mdi-sitemap',
      to: '/institution/departments',
      permission: 'department.view',
    },
    {
      title: 'Users',
      icon: 'mdi-account-group',
      to: '/institution/users',
      permission: 'user.view',
    },
    {
      title: 'Students',
      icon: 'mdi-account-school',
      to: '/institution/students',
      permission: 'student.view',
      feature: 'education',
      educationOnly: true,
    },
    {
      title: 'Admissions',
      icon: 'mdi-file-account',
      to: '/institution/admissions',
      permission: 'admission.view',
      feature: 'education',
      educationOnly: true,
    },
    { title: 'Approvals', icon: 'mdi-check-decagram', to: '/institution/approvals' },
    {
      title: 'Documents',
      icon: 'mdi-file-document-multiple',
      to: '/institution/documents',
      permission: 'document.view',
      feature: 'documents',
    },
    {
      title: 'Communication',
      icon: 'mdi-email-fast',
      to: '/institution/communication',
      permission: 'communication.view',
      feature: 'communication',
    },
    {
      title: 'Branding',
      icon: 'mdi-palette',
      to: '/institution/branding',
      permission: 'branding.view',
    },
    {
      title: 'Library',
      icon: 'mdi-bookshelf',
      to: '/institution/library',
      permission: 'library.view',
      feature: 'library',
    },
    {
      title: 'Catalogue',
      icon: 'mdi-book-open-page-variant',
      to: '/institution/library/catalogue',
      permission: 'library.view',
      feature: 'library',
    },
    {
      title: 'Copies',
      icon: 'mdi-book-multiple',
      to: '/institution/library/copies',
      permission: 'library.view',
      feature: 'library',
    },
    {
      title: 'Issue / Return desk',
      icon: 'mdi-barcode-scan',
      to: '/institution/library/desk',
      permission: 'library.circulate',
      feature: 'library',
    },
    {
      title: 'Reservations',
      icon: 'mdi-bookmark-multiple',
      to: '/institution/library/reservations',
      permission: 'library.view',
      feature: 'library',
    },
    {
      title: 'Library members',
      icon: 'mdi-card-account-details-outline',
      to: '/institution/library/members',
      permission: 'library.view',
      feature: 'library',
    },
    {
      title: 'Overdues & fines',
      icon: 'mdi-alarm',
      to: '/institution/library/fines',
      permission: 'library.view',
      feature: 'library',
    },
    {
      title: 'Library reports',
      icon: 'mdi-chart-box',
      to: '/institution/library/reports',
      permission: 'library.view',
      feature: 'library',
    },
    {
      title: 'Library settings',
      icon: 'mdi-cog-outline',
      to: '/institution/library/settings',
      permission: 'library.view',
      feature: 'library',
    },
  ],
  hr: [
    { title: 'Dashboard', icon: 'mdi-view-dashboard', to: '/hr' },
    {
      title: 'Employees',
      icon: 'mdi-badge-account',
      to: '/hr/employees',
      permission: 'employee.view',
      feature: 'hr',
    },
    {
      title: 'Departments',
      icon: 'mdi-sitemap',
      to: '/hr/departments',
      permission: 'department.view',
      feature: 'hr',
    },
    {
      title: 'Employee types',
      icon: 'mdi-account-tie',
      to: '/hr/employee-types',
      permission: 'designation.view',
      feature: 'hr',
    },
    {
      title: 'Designations',
      icon: 'mdi-briefcase-variant',
      to: '/hr/designations',
      permission: 'designation.view',
      feature: 'hr',
    },
    {
      title: 'Attendance',
      icon: 'mdi-calendar-check',
      to: '/hr/attendance',
      permission: 'attendance.view',
      feature: 'hr',
    },
    {
      title: 'Leave',
      icon: 'mdi-beach',
      to: '/hr/leave',
      permission: 'leave.view',
      feature: 'hr',
    },
    {
      title: 'Leave setup',
      icon: 'mdi-cog-outline',
      to: '/hr/leave-setup',
      permission: 'leave.view',
      feature: 'hr',
    },
    {
      title: 'Shifts',
      icon: 'mdi-clock-outline',
      to: '/hr/shifts',
      permission: 'shift.view',
      feature: 'hr',
    },
    {
      title: 'Holiday calendars',
      icon: 'mdi-calendar-star',
      to: '/hr/holidays',
      permission: 'holiday.view',
      feature: 'hr',
    },
    {
      title: 'Payroll runs',
      icon: 'mdi-cash-multiple',
      to: '/hr/payroll/runs',
      permission: 'payroll.view',
      feature: 'payroll',
    },
    {
      title: 'Salary components',
      icon: 'mdi-format-list-bulleted-type',
      to: '/hr/payroll/components',
      permission: 'payroll.view',
      feature: 'payroll',
    },
    {
      title: 'Salary structures',
      icon: 'mdi-file-tree',
      to: '/hr/payroll/structures',
      permission: 'payroll.view',
      feature: 'payroll',
    },
    {
      title: 'Employee salary',
      icon: 'mdi-account-cash',
      to: '/hr/payroll/salary',
      permission: 'salary.view',
      feature: 'payroll',
    },
    {
      title: 'Payslips & Form 16',
      icon: 'mdi-receipt-text',
      to: '/hr/payroll/payslips',
      permission: 'payroll.view',
      feature: 'payroll',
    },
    { title: 'Approvals', icon: 'mdi-check-decagram', to: '/hr/approvals' },
    {
      title: 'Documents',
      icon: 'mdi-file-document-multiple',
      to: '/hr/documents',
      permission: 'document.view',
      feature: 'documents',
    },
    { title: 'AI tools', icon: 'mdi-robot', to: '/hr/ai', permission: 'ai.use', feature: 'ai' },
  ],
  employee: [
    { title: 'Home', icon: 'mdi-account', to: '/employee' },
    {
      title: 'My profile',
      icon: 'mdi-card-account-details',
      to: '/employee/profile',
      permission: 'employee.view_own',
      feature: 'hr',
    },
    {
      title: 'My attendance',
      icon: 'mdi-calendar-check',
      to: '/employee/attendance',
      permission: 'attendance.view_own',
      feature: 'hr',
    },
    {
      title: 'My leave',
      icon: 'mdi-beach',
      to: '/employee/leave',
      permission: 'leave.view_own',
      feature: 'hr',
    },
    {
      title: 'My salary',
      icon: 'mdi-cash-multiple',
      to: '/employee/salary',
      permission: 'payroll.view_own',
      feature: 'payroll',
    },
    {
      title: 'My payslips',
      icon: 'mdi-receipt-text',
      to: '/employee/payslips',
      permission: 'payroll.view_own',
      feature: 'payroll',
    },
    { title: 'Approvals', icon: 'mdi-check-decagram', to: '/employee/approvals' },
    {
      title: 'Documents',
      icon: 'mdi-file-document-multiple',
      to: '/employee/documents',
      permission: 'document.view_own',
      feature: 'documents',
    },
    {
      title: 'My library',
      icon: 'mdi-bookshelf',
      to: '/employee/library',
      permission: 'library.view_own',
      feature: 'library',
    },
    {
      title: 'Library catalogue',
      icon: 'mdi-book-search',
      to: '/employee/opac',
      permission: 'library.view_own',
      feature: 'library',
    },
  ],
  portal: [
    {
      title: 'My profile',
      icon: 'mdi-account-school',
      to: '/portal/profile',
      permission: 'student.view_own',
      feature: 'education',
    },
    {
      title: 'My children',
      icon: 'mdi-human-male-child',
      to: '/portal/wards',
      permission: 'ward.view',
      feature: 'education',
    },
    {
      title: 'Documents',
      icon: 'mdi-file-document-multiple',
      to: '/portal/documents',
      permission: 'document.view_own',
      feature: 'documents',
    },
    {
      title: 'My library',
      icon: 'mdi-bookshelf',
      to: '/portal/library',
      permission: 'library.view_own',
      feature: 'library',
    },
    {
      title: 'Library catalogue',
      icon: 'mdi-book-search',
      to: '/portal/opac',
      permission: 'library.view_own',
      feature: 'library',
    },
  ],
};

/** Workspaces offered on the home page, each gated by the permission of its layout route. */
export const WORKSPACES: Array<MenuItem & { layout: LayoutKey }> = [
  {
    layout: 'platform',
    title: 'Platform',
    to: '/platform',
    icon: 'mdi-shield-crown',
    permission: 'platform.organization.view',
  },
  {
    layout: 'group',
    title: 'Group',
    companyTitle: 'Head office',
    to: '/group',
    icon: 'mdi-domain',
    permission: 'group.view',
  },
  {
    layout: 'institution',
    title: 'Institution',
    companyTitle: 'Company',
    to: '/institution',
    icon: 'mdi-school',
    permission: 'institution.view',
  },
  {
    layout: 'hr',
    title: 'HR',
    to: '/hr',
    icon: 'mdi-badge-account',
    permission: 'employee.view',
    feature: 'hr',
  },
  { layout: 'employee', title: 'Employee', to: '/employee', icon: 'mdi-account' },
  {
    layout: 'portal',
    title: 'Student / Parent',
    to: '/portal',
    icon: 'mdi-account-school',
    permission: 'student.view_own',
    feature: 'education',
  },
  {
    layout: 'portal',
    title: 'Parent portal',
    to: '/portal/wards',
    icon: 'mdi-human-male-child',
    permission: 'ward.view',
    feature: 'education',
  },
];

export function visibleMenu<T extends MenuItem>(
  items: T[],
  can: (permission?: string) => boolean,
  hasFeature: (feature?: FeatureKey) => boolean = () => true,
  kind: OrgKind = 'EDUCATION',
): T[] {
  return items
    .filter(
      (item) =>
        can(item.permission) &&
        hasFeature(item.feature) &&
        !(kind === 'COMPANY' && item.educationOnly && !hasFeature('education')),
    )
    .map((item) =>
      kind === 'COMPANY' && item.companyTitle ? { ...item, title: item.companyTitle } : item,
    );
}

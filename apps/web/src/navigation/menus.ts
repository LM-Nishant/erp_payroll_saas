import type { FeatureKey } from '@erp/shared';

export interface MenuItem {
  title: string;
  icon: string;
  to: string;
  /** Permission code required to see the item (enforced by the backend as well). */
  permission?: string;
  /** Licensed module required to see the item (`/me.features`; backend: requireFeature). */
  feature?: FeatureKey;
}

export type LayoutKey = 'platform' | 'group' | 'institution' | 'hr' | 'employee';

/**
 * Menus are data-driven and filtered by the permissions AND enabled modules (features) returned
 * from GET /api/v1/me. Later layers append items with the permission code that guards their API
 * and, for licensed modules, the feature key (e.g. `feature: 'payroll'`).
 */
export const MENUS: Record<LayoutKey, MenuItem[]> = {
  platform: [
    { title: 'Dashboard', icon: 'mdi-view-dashboard', to: '/platform' },
    {
      title: 'Organizations',
      icon: 'mdi-domain',
      to: '/platform',
      permission: 'platform.organization.view',
    },
  ],
  group: [
    { title: 'Dashboard', icon: 'mdi-view-dashboard', to: '/group' },
    {
      title: 'Institutions',
      icon: 'mdi-school',
      to: '/group/institutions',
      permission: 'institution.view',
    },
    { title: 'Users', icon: 'mdi-account-group', to: '/group/users', permission: 'user.view' },
    { title: 'Approvals', icon: 'mdi-check-decagram', to: '/group/approvals' },
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
  ],
  hr: [
    {
      title: 'Employees',
      icon: 'mdi-badge-account',
      to: '/hr/employees',
      permission: 'employee.view',
      feature: 'hr',
    },
    {
      title: 'Designations',
      icon: 'mdi-briefcase-variant',
      to: '/hr/designations',
      permission: 'designation.view',
      feature: 'hr',
    },
    { title: 'Approvals', icon: 'mdi-check-decagram', to: '/hr/approvals' },
    {
      title: 'Documents',
      icon: 'mdi-file-document-multiple',
      to: '/hr/documents',
      permission: 'document.view',
      feature: 'documents',
    },
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
    { title: 'Approvals', icon: 'mdi-check-decagram', to: '/employee/approvals' },
    {
      title: 'Documents',
      icon: 'mdi-file-document-multiple',
      to: '/employee/documents',
      permission: 'document.view_own',
      feature: 'documents',
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
  { layout: 'group', title: 'Group', to: '/group', icon: 'mdi-domain', permission: 'group.view' },
  {
    layout: 'institution',
    title: 'Institution',
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
];

export function visibleMenu<T extends MenuItem>(
  items: T[],
  can: (permission?: string) => boolean,
  hasFeature: (feature?: FeatureKey) => boolean = () => true,
): T[] {
  return items.filter((item) => can(item.permission) && hasFeature(item.feature));
}

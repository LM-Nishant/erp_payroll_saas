export interface MenuItem {
  title: string;
  icon: string;
  to: string;
  /** Permission code required to see the item (enforced by the backend as well). */
  permission?: string;
}

export type LayoutKey = 'platform' | 'group' | 'institution' | 'employee';

/**
 * Menus are data-driven and filtered by the permissions returned from GET /api/v1/me.
 * Later layers append items with the permission code that guards their API.
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
  ],
  employee: [{ title: 'Home', icon: 'mdi-account', to: '/employee' }],
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
  { layout: 'employee', title: 'Employee', to: '/employee', icon: 'mdi-account' },
];

export function visibleMenu<T extends MenuItem>(
  items: T[],
  can: (permission?: string) => boolean,
): T[] {
  return items.filter((item) => can(item.permission));
}

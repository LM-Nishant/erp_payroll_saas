export interface MenuItem {
  title: string;
  icon: string;
  to: string;
  /** Permission code required to see the item (enforced by the backend as well). */
  permission?: string;
}

export type LayoutKey = 'platform' | 'group' | 'institution' | 'employee';

/** Menus are data-driven and filtered by permission; later layers append items. */
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
  ],
  institution: [
    { title: 'Dashboard', icon: 'mdi-view-dashboard', to: '/institution' },
    {
      title: 'Departments',
      icon: 'mdi-sitemap',
      to: '/institution/departments',
      permission: 'department.view',
    },
  ],
  employee: [{ title: 'Home', icon: 'mdi-account', to: '/employee' }],
};

export function visibleMenu(items: MenuItem[], can: (permission?: string) => boolean): MenuItem[] {
  return items.filter((item) => can(item.permission));
}

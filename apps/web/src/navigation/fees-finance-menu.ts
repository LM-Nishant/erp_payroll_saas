import type { MenuItem } from './menus';

/** Fees (education only) + Finance/accounts menu entries for the group & institution layouts. */
export function feesFinanceMenu(base: '/group' | '/institution'): MenuItem[] {
  const fee = (title: string, icon: string, path: string, permission = 'fee.view'): MenuItem => ({
    title,
    icon,
    to: `${base}/fees/${path}`,
    permission,
    feature: 'finance',
    educationOnly: true,
  });
  const fin = (title: string, icon: string, path: string): MenuItem => ({
    title,
    icon,
    to: `${base}/finance/${path}`,
    permission: 'finance.view',
    feature: 'finance',
  });
  return [
    fee('Fee heads', 'mdi-cash-multiple', 'heads'),
    fee('Fee structures', 'mdi-file-tree', 'structures'),
    fee('Fee invoices', 'mdi-file-document-outline', 'invoices'),
    fee('Collect fee', 'mdi-cash-register', 'collect', 'fee.collect'),
    fee('Fee receipts', 'mdi-receipt', 'receipts'),
    fee('Concessions', 'mdi-sale', 'concessions'),
    fee('Fee defaulters', 'mdi-account-alert', 'defaulters'),
    fee('Fee reports', 'mdi-chart-box-outline', 'reports'),
    fin('Accounts', 'mdi-file-tree-outline', 'accounts'),
    fin('Vouchers', 'mdi-book-open-variant', 'vouchers'),
    fin('Expenses', 'mdi-cash-minus', 'expenses'),
    fin('Ledger', 'mdi-book-account', 'ledger'),
    fin('Trial balance', 'mdi-scale-balance', 'trial-balance'),
  ];
}

export const portalFeesMenu: MenuItem = {
  title: 'My fees',
  icon: 'mdi-cash-check',
  to: '/portal/fees',
  permission: 'fee.view_own',
  feature: 'finance',
};

import type { RouteRecordRaw } from 'vue-router';

const fees = (path: string, name: string, permission: string, page: () => Promise<unknown>) => ({
  path,
  name,
  meta: { permission, feature: 'finance' },
  component: page,
});

/** Fees + finance pages, mounted under both the group and institution layouts. */
export function feesFinanceRoutes(scope: 'group' | 'institution'): RouteRecordRaw[] {
  const n = (s: string) => `${scope}-${s}`;
  return [
    fees('fees/heads', n('fee-heads'), 'fee.view', () => import('@/pages/fees/FeeHeadsPage.vue')),
    fees(
      'fees/structures',
      n('fee-structures'),
      'fee.view',
      () => import('@/pages/fees/FeeStructuresPage.vue'),
    ),
    fees(
      'fees/invoices',
      n('fee-invoices'),
      'fee.view',
      () => import('@/pages/fees/FeeInvoicesPage.vue'),
    ),
    fees(
      'fees/collect',
      n('fee-collect'),
      'fee.collect',
      () => import('@/pages/fees/CollectFeePage.vue'),
    ),
    fees(
      'fees/upi',
      n('fee-upi-payments'),
      'fee.collect',
      () => import('@/pages/fees/UpiPaymentsPage.vue'),
    ),
    fees(
      'fees/upi-settings',
      n('fee-upi-settings'),
      'fee.view',
      () => import('@/pages/fees/UpiSettingsPage.vue'),
    ),
    fees(
      'fees/receipts',
      n('fee-receipts'),
      'fee.view',
      () => import('@/pages/fees/FeeReceiptsPage.vue'),
    ),
    fees(
      'fees/concessions',
      n('fee-concessions'),
      'fee.view',
      () => import('@/pages/fees/ConcessionsPage.vue'),
    ),
    fees(
      'fees/defaulters',
      n('fee-defaulters'),
      'fee.view',
      () => import('@/pages/fees/DefaultersPage.vue'),
    ),
    fees(
      'fees/reports',
      n('fee-reports'),
      'fee.view',
      () => import('@/pages/fees/FeeReportsPage.vue'),
    ),
    fees(
      'finance/accounts',
      n('finance-accounts'),
      'finance.view',
      () => import('@/pages/finance/AccountsPage.vue'),
    ),
    fees(
      'finance/vouchers',
      n('finance-vouchers'),
      'finance.view',
      () => import('@/pages/finance/VouchersPage.vue'),
    ),
    fees(
      'finance/expenses',
      n('finance-expenses'),
      'finance.view',
      () => import('@/pages/finance/ExpensesPage.vue'),
    ),
    {
      ...fees(
        'finance/ledger',
        n('finance-ledger'),
        'finance.view',
        () => import('@/pages/finance/FinanceReportsPage.vue'),
      ),
      meta: { permission: 'finance.view', feature: 'finance', report: 'ledger' },
    },
    {
      ...fees(
        'finance/trial-balance',
        n('finance-trial-balance'),
        'finance.view',
        () => import('@/pages/finance/FinanceReportsPage.vue'),
      ),
      meta: { permission: 'finance.view', feature: 'finance', report: 'trial_balance' },
    },
  ] as RouteRecordRaw[];
}

export const portalFeesRoute: RouteRecordRaw = {
  path: 'fees',
  name: 'portal-fees',
  meta: { permission: 'fee.view_own', feature: 'finance' },
  component: () => import('@/pages/fees/MyFeesPage.vue'),
};

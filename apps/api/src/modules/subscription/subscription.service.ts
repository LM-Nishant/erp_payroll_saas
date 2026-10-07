import type { ListInvoicesQuery, SubscriptionDto } from '@erp/shared';
import { authorize, currentPrincipal } from '../../core/authz';
import { subscriptionSummary, toInvoiceDto } from '../../core/features';
import { NotFoundError } from '../../core/http/errors';
import { toListResponse, toPageWindow } from '../../core/http/pagination';
import { currentOrganizationId } from '../../core/tenancy/context';
import { tenantDb } from '../../core/tenancy/tenant-db';

/** Tenant-facing, read-only view of the organization's own subscription and invoices. */
export const subscriptionService = {
  async get(): Promise<SubscriptionDto> {
    // Plan / limits / usage are organization-level facts: any `subscription.view` grant may read.
    const summary = await subscriptionSummary(currentOrganizationId());
    if (!summary) throw new NotFoundError('Subscription');
    return summary;
  },

  async listInvoices(query: ListInvoicesQuery) {
    // Invoices are organization-level financial data: org-wide grant required.
    await authorize(currentPrincipal(), 'billing.view', {});
    const where = query.status ? { status: query.status } : {};
    const db = tenantDb();
    const [rows, total] = await Promise.all([
      db.invoice.findMany({ where, orderBy: { periodStart: 'desc' }, ...toPageWindow(query) }),
      db.invoice.count({ where }),
    ]);
    return toListResponse(rows.map(toInvoiceDto), total, query);
  },
};

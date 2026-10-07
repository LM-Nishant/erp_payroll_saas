import type { ListInvoicesQuery, SubmitInvoicePaymentInput, SubscriptionDto } from '@erp/shared';
import { audit } from '../../core/audit';
import { authorize, currentPrincipal } from '../../core/authz';
import {
  invoicePdfFor,
  invoiceUpiPayment,
  subscriptionSummary,
  toInvoiceDto,
} from '../../core/features';
import { ConflictError, NotFoundError } from '../../core/http/errors';
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
    // Drafts are internal to the platform until issued.
    const where = query.status ? { status: query.status } : { status: { not: 'DRAFT' as const } };
    const db = tenantDb();
    const [rows, total] = await Promise.all([
      db.invoice.findMany({ where, orderBy: { periodStart: 'desc' }, ...toPageWindow(query) }),
      db.invoice.count({ where }),
    ]);
    return toListResponse(rows.map(toInvoiceDto), total, query);
  },

  async invoicePdf(id: string) {
    const inv = await loadInvoice(id);
    return { number: inv.number, pdf: await invoicePdfFor(currentOrganizationId(), inv) };
  },

  async upiPayment(id: string) {
    return invoiceUpiPayment(toInvoiceDto(await loadInvoice(id)));
  },

  /** Report a UPI payment (UTR). The platform verifies it and marks the invoice PAID. */
  async submitPayment(id: string, input: SubmitInvoicePaymentInput) {
    const principal = currentPrincipal();
    await authorize(principal, 'billing.pay', {});
    const before = await loadInvoice(id);
    if (before.status !== 'OPEN' && before.status !== 'OVERDUE')
      throw new ConflictError(`Invoice is ${before.status.toLowerCase().replace('_', ' ')}`);
    const after = await tenantDb().invoice.update({
      where: { id },
      data: {
        status: 'PAYMENT_SUBMITTED',
        submittedReference: input.reference.toUpperCase(),
        submittedNote: input.note ?? null,
        submittedAt: new Date(),
        submittedByUserId: principal.userId,
      },
    });
    await audit.record({
      action: 'invoice.payment_submitted',
      entityType: 'invoice',
      entityId: id,
      before: toInvoiceDto(before),
      after: toInvoiceDto(after),
    });
    return toInvoiceDto(after);
  },
};

async function loadInvoice(id: string) {
  await authorize(currentPrincipal(), 'billing.view', {});
  const inv = await tenantDb().invoice.findFirst({
    where: { id, status: { not: 'DRAFT' } },
    include: { subscription: { include: { plan: true } } },
  });
  if (!inv) throw new NotFoundError('Invoice');
  return inv;
}

import { idParamSchema, listInvoicesQuerySchema, submitInvoicePaymentSchema } from '@erp/shared';
import { Router } from 'express';
import { requirePermission } from '../../core/authz';
import { parseInput } from '../../core/http/validation';
import { subscriptionService } from './subscription.service';

/** /api/v1/subscription — the tenant's own plan, limits, usage and invoices (read-only). */
export const subscriptionRouter = Router();

subscriptionRouter.get('/', requirePermission('subscription.view'), async (_req, res) => {
  res.json({ data: await subscriptionService.get() });
});

subscriptionRouter.get('/invoices', requirePermission('billing.view'), async (req, res) => {
  res.json(await subscriptionService.listInvoices(parseInput(listInvoicesQuerySchema, req.query)));
});

subscriptionRouter.get('/invoices/:id/pdf', requirePermission('billing.view'), async (req, res) => {
  const { id } = parseInput(idParamSchema, req.params);
  const { number, pdf } = await subscriptionService.invoicePdf(id);
  res
    .type('application/pdf')
    .setHeader('Content-Disposition', `attachment; filename="${number}.pdf"`)
    .send(pdf);
});

subscriptionRouter.get('/invoices/:id/upi', requirePermission('billing.view'), async (req, res) => {
  const { id } = parseInput(idParamSchema, req.params);
  res.json({ data: await subscriptionService.upiPayment(id) });
});

subscriptionRouter.post(
  '/invoices/:id/payment',
  requirePermission('billing.pay'),
  async (req, res) => {
    const { id } = parseInput(idParamSchema, req.params);
    const input = parseInput(submitInvoicePaymentSchema, req.body);
    res.json({ data: await subscriptionService.submitPayment(id, input) });
  },
);

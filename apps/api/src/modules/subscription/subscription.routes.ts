import { listInvoicesQuerySchema } from '@erp/shared';
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

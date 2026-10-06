import {
  createInvoiceSchema,
  createPlanSchema,
  idParamSchema,
  idSchema,
  listInvoicesQuerySchema,
  listPlatformAuditLogsQuerySchema,
  paginationQuerySchema,
  platformAccessSchema,
  platformReasonSchema,
  setSubscriptionSchema,
  updateInvoiceSchema,
  updatePlanSchema,
} from '@erp/shared';
import { z } from 'zod';
import { Router } from 'express';
import { listAuditLogs } from '../../core/audit';
import { currentPrincipal, requirePlatformPermission } from '../../core/authz';
import { parseInput } from '../../core/http/validation';
import { listOrganizations, openTenantAccess, resolveOrganizationSlug } from '../../core/platform';
import { platformBillingService } from '../../core/features';

const invoiceParamsSchema = z.object({ id: idSchema, invoiceId: idSchema });
const actor = () => ({ userId: currentPrincipal().userId });

/** /api/v1/platform — platform-role endpoints. Never exposes tenant data directly. */
export const platformRouter = Router();

platformRouter.get(
  '/organizations',
  requirePlatformPermission('platform.organization.view'),
  async (req, res) => {
    res.json(await listOrganizations(parseInput(paginationQuerySchema, req.query)));
  },
);

/** Opens an audited, short-lived tenant-access session (the only cross-tenant path). */
platformRouter.post(
  '/organizations/:id/access',
  requirePlatformPermission('platform.tenant.access'),
  async (req, res) => {
    const { id } = parseInput(idParamSchema, req.params);
    const { reason } = parseInput(platformAccessSchema, req.body);
    const result = await openTenantAccess(currentPrincipal(), id, reason);
    res.status(201).json({
      data: {
        organization: result.organization,
        accessToken: result.accessToken,
        accessTokenExpiresAt: result.accessTokenExpiresAt.toISOString(),
        sessionExpiresAt: result.sessionExpiresAt.toISOString(),
      },
    });
  },
);

platformRouter.get(
  '/audit-logs',
  requirePlatformPermission('platform.audit.view'),
  async (req, res) => {
    const { organizationSlug, ...query } = parseInput(listPlatformAuditLogsQuerySchema, req.query);
    const organizationId = organizationSlug
      ? await resolveOrganizationSlug(organizationSlug)
      : undefined;
    res.json(await listAuditLogs(organizationId, query));
  },
);

// --- Subscription plans (global catalog) -------------------------------------------------

platformRouter.get(
  '/plans',
  requirePlatformPermission('platform.plan.manage'),
  async (_req, res) => {
    res.json({ data: await platformBillingService.listPlans() });
  },
);

platformRouter.post(
  '/plans',
  requirePlatformPermission('platform.plan.manage'),
  async (req, res) => {
    res.status(201).json({
      data: await platformBillingService.createPlan(parseInput(createPlanSchema, req.body)),
    });
  },
);

platformRouter.patch(
  '/plans/:id',
  requirePlatformPermission('platform.plan.manage'),
  async (req, res) => {
    const { id } = parseInput(idParamSchema, req.params);
    res.json({
      data: await platformBillingService.updatePlan(id, parseInput(updatePlanSchema, req.body)),
    });
  },
);

// --- Organization subscriptions & invoices (mutations via runAsPlatform) -----------------

platformRouter.get(
  '/organizations/:id/subscription',
  requirePlatformPermission('platform.subscription.manage'),
  async (req, res) => {
    const { id } = parseInput(idParamSchema, req.params);
    res.json({ data: await platformBillingService.getSubscription(id) });
  },
);

platformRouter.put(
  '/organizations/:id/subscription',
  requirePlatformPermission('platform.subscription.manage'),
  async (req, res) => {
    const { id } = parseInput(idParamSchema, req.params);
    const input = parseInput(setSubscriptionSchema, req.body);
    res.json({ data: await platformBillingService.setSubscription(actor(), id, input) });
  },
);

platformRouter.get(
  '/organizations/:id/invoices',
  requirePlatformPermission('platform.subscription.manage'),
  async (req, res) => {
    const { id } = parseInput(idParamSchema, req.params);
    res.json(
      await platformBillingService.listInvoices(id, parseInput(listInvoicesQuerySchema, req.query)),
    );
  },
);

platformRouter.post(
  '/organizations/:id/invoices',
  requirePlatformPermission('platform.subscription.manage'),
  async (req, res) => {
    const { id } = parseInput(idParamSchema, req.params);
    const input = parseInput(createInvoiceSchema, req.body);
    res.status(201).json({ data: await platformBillingService.createInvoice(actor(), id, input) });
  },
);

platformRouter.patch(
  '/organizations/:id/invoices/:invoiceId',
  requirePlatformPermission('platform.subscription.manage'),
  async (req, res) => {
    const { id, invoiceId } = parseInput(invoiceParamsSchema, req.params);
    const input = parseInput(updateInvoiceSchema, req.body);
    res.json({
      data: await platformBillingService.updateInvoice(actor(), id, invoiceId, input),
    });
  },
);

// --- Secrets master key rotation ---------------------------------------------------------

platformRouter.post(
  '/secrets/rewrap',
  requirePlatformPermission('platform.secret.rotate_keys'),
  async (req, res) => {
    const { reason } = parseInput(platformReasonSchema, req.body);
    res.json({ data: await platformBillingService.rewrapAllSecrets(actor(), reason) });
  },
);

import {
  createInvoiceSchema,
  createOrganizationSchema,
  inviteOrganizationOwnerSchema,
  listOrganizationsQuerySchema,
  setOrganizationStatusSchema,
  updateOrganizationSchema,
  createPlanSchema,
  idParamSchema,
  idSchema,
  listInvoicesQuerySchema,
  platformBillingSettingsSchema,
  platformInvoicesQuerySchema,
  listPlatformAuditLogsQuerySchema,
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
import {
  getPlatformOrganization,
  listPlatformOrganizations,
  openTenantAccess,
  resolveOrganizationSlug,
  setOrganizationStatus,
  updateOrganizationRecord,
} from '../../core/platform';
import { createOrganization, inviteOrganizationOwner } from './organizations.service';
import {
  getBillingSettings,
  platformBillingService,
  updateBillingSettings,
} from '../../core/features';

const invoiceParamsSchema = z.object({ id: idSchema, invoiceId: idSchema });
const actor = () => ({ userId: currentPrincipal().userId });

/** /api/v1/platform — platform-role endpoints. Never exposes tenant data directly. */
export const platformRouter = Router();

platformRouter.get(
  '/organizations',
  requirePlatformPermission('platform.organization.view'),
  async (req, res) => {
    res.json(await listPlatformOrganizations(parseInput(listOrganizationsQuerySchema, req.query)));
  },
);

/** Onboard a tenant: organization, default roles, subscription and first owner invite. */
platformRouter.post(
  '/organizations',
  requirePlatformPermission('platform.organization.manage'),
  async (req, res) => {
    const input = parseInput(createOrganizationSchema, req.body);
    res.status(201).json({ data: await createOrganization(actor().userId, input) });
  },
);

platformRouter.get(
  '/organizations/:id',
  requirePlatformPermission('platform.organization.view'),
  async (req, res) => {
    const { id } = parseInput(idParamSchema, req.params);
    res.json({ data: await getPlatformOrganization(id) });
  },
);

platformRouter.patch(
  '/organizations/:id',
  requirePlatformPermission('platform.organization.manage'),
  async (req, res) => {
    const { id } = parseInput(idParamSchema, req.params);
    const input = parseInput(updateOrganizationSchema, req.body);
    res.json({ data: await updateOrganizationRecord(actor().userId, id, input) });
  },
);

/** Suspend / archive / re-activate. Non-active tenants get 403 TENANT_INACTIVE. */
platformRouter.post(
  '/organizations/:id/status',
  requirePlatformPermission('platform.organization.manage'),
  async (req, res) => {
    const { id } = parseInput(idParamSchema, req.params);
    const input = parseInput(setOrganizationStatusSchema, req.body);
    res.json({ data: await setOrganizationStatus(actor().userId, id, input) });
  },
);

/** Invite an additional organization-wide owner (or retry a failed onboarding invite). */
platformRouter.post(
  '/organizations/:id/owners',
  requirePlatformPermission('platform.organization.manage'),
  async (req, res) => {
    const { id } = parseInput(idParamSchema, req.params);
    const input = parseInput(inviteOrganizationOwnerSchema, req.body);
    res.status(201).json({ data: await inviteOrganizationOwner(actor().userId, id, input) });
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

platformRouter.get(
  '/organizations/:id/invoices/:invoiceId/pdf',
  requirePlatformPermission('platform.subscription.manage'),
  async (req, res) => {
    const { id, invoiceId } = parseInput(invoiceParamsSchema, req.params);
    const { number, pdf } = await platformBillingService.invoicePdf(id, invoiceId);
    res
      .type('application/pdf')
      .setHeader('Content-Disposition', `attachment; filename="${number}.pdf"`)
      .send(pdf);
  },
);

platformRouter.get(
  '/invoices',
  requirePlatformPermission('platform.subscription.manage'),
  async (req, res) => {
    res.json(
      await platformBillingService.listAllInvoices(
        parseInput(platformInvoicesQuerySchema, req.query),
      ),
    );
  },
);

// --- Platform billing settings (seller details, UPI ID, default GST) ---------------------

platformRouter.get(
  '/billing-settings',
  requirePlatformPermission('platform.subscription.manage'),
  async (_req, res) => {
    res.json({ data: await getBillingSettings() });
  },
);

platformRouter.put(
  '/billing-settings',
  requirePlatformPermission('platform.subscription.manage'),
  async (req, res) => {
    res.json({
      data: await updateBillingSettings(parseInput(platformBillingSettingsSchema, req.body)),
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

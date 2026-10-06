import {
  idParamSchema,
  listPlatformAuditLogsQuerySchema,
  paginationQuerySchema,
  platformAccessSchema,
} from '@erp/shared';
import { Router } from 'express';
import { listAuditLogs } from '../../core/audit';
import { currentPrincipal, requirePlatformPermission } from '../../core/authz';
import { parseInput } from '../../core/http/validation';
import { listOrganizations, openTenantAccess, resolveOrganizationSlug } from '../../core/platform';

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

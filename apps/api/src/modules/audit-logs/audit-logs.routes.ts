import { listAuditLogsQuerySchema } from '@erp/shared';
import { Router } from 'express';
import { listAuditLogs } from '../../core/audit';
import { authorize, currentPrincipal } from '../../core/authz';
import { parseInput } from '../../core/http/validation';
import { currentOrganizationId } from '../../core/tenancy';

/** Tenant audit log (read-only; there is no update/delete API by design). */
export const auditLogsRouter = Router();

auditLogsRouter.get('/', async (req, res) => {
  // Audit logs are organization-level data: only org-wide `audit.view` grants cover them.
  await authorize(currentPrincipal(), 'audit.view', {});
  const query = parseInput(listAuditLogsQuerySchema, req.query);
  res.json(await listAuditLogs(currentOrganizationId(), query));
});

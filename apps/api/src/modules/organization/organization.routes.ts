import { Router } from 'express';
import { requirePermission } from '../../core/authz';
import { NotFoundError } from '../../core/http/errors';
import { currentOrganizationId, tenantDb } from '../../core/tenancy';

/** Current tenant's organization (read-only; platform admin CRUD is a later layer). */
export const organizationRouter = Router();

organizationRouter.get('/', requirePermission('organization.view'), async (_req, res) => {
  const organization = await tenantDb().organization.findUnique({
    where: { id: currentOrganizationId() },
    select: { id: true, name: true, slug: true, status: true, createdAt: true, updatedAt: true },
  });
  if (!organization) throw new NotFoundError('Organization');
  res.json({ data: organization });
});

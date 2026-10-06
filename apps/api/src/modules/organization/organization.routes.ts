import { Router } from 'express';
import { NotFoundError } from '../../core/http/errors';
import { currentOrganizationId, tenantDb } from '../../core/tenancy';

/** Current tenant's organization (read-only; platform admin CRUD arrives with auth/RBAC). */
export const organizationRouter = Router();

organizationRouter.get('/', async (_req, res) => {
  const organization = await tenantDb().organization.findUnique({
    where: { id: currentOrganizationId() },
    select: { id: true, name: true, slug: true, status: true, createdAt: true, updatedAt: true },
  });
  if (!organization) throw new NotFoundError('Organization');
  res.json({ data: organization });
});

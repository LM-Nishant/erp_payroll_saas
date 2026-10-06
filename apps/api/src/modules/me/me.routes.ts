import { Router } from 'express';
import { getMe } from '../../core/auth';
import { currentPrincipal } from '../../core/authz';

/** GET /api/v1/me — profile, roles + scopes and effective permissions (drives the web menu). */
export const meRouter = Router();

meRouter.get('/', async (_req, res) => {
  res.json({ data: await getMe(currentPrincipal()) });
});

import { brandingInputSchema, idParamSchema, resolvedBrandingQuerySchema } from '@erp/shared';
import { Router, type Request } from 'express';
import { requirePermission } from '../../core/authz';
import { parseInput } from '../../core/http/validation';
import { brandingService } from './branding.service';

/**
 * /api/v1/branding — per-level branding profiles (organization → group → institution) and the
 * resolved (inherited) branding used by PDFs, emails and the web theme.
 */
export const brandingRouter = Router();

const view = requirePermission('branding.view');
const manage = requirePermission('branding.manage');
const idOf = (req: Request) => parseInput(idParamSchema, req.params).id;
const body = (req: Request) => parseInput(brandingInputSchema, req.body);

brandingRouter.get('/resolved', view, async (req, res) => {
  res.json({
    data: await brandingService.resolved(parseInput(resolvedBrandingQuerySchema, req.query)),
  });
});

brandingRouter.get('/organization', view, async (_req, res) => {
  res.json({ data: await brandingService.get('ORGANIZATION') });
});
brandingRouter.put('/organization', manage, async (req, res) => {
  res.json({ data: await brandingService.put('ORGANIZATION', undefined, body(req)) });
});
brandingRouter.delete('/organization', manage, async (_req, res) => {
  await brandingService.remove('ORGANIZATION');
  res.status(204).end();
});

for (const [path, scopeType] of [
  ['groups', 'GROUP'],
  ['institutions', 'INSTITUTION'],
] as const) {
  brandingRouter.get(`/${path}/:id`, view, async (req, res) => {
    res.json({ data: await brandingService.get(scopeType, idOf(req)) });
  });
  brandingRouter.put(`/${path}/:id`, manage, async (req, res) => {
    const id = idOf(req);
    res.json({ data: await brandingService.put(scopeType, id, body(req)) });
  });
  brandingRouter.delete(`/${path}/:id`, manage, async (req, res) => {
    await brandingService.remove(scopeType, idOf(req));
    res.status(204).end();
  });
}

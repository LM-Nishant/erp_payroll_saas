import {
  LOGO_MAX_BYTES,
  brandingInputSchema,
  idParamSchema,
  resolvedBrandingQuerySchema,
} from '@erp/shared';
import { Router, type Request } from 'express';
import { homeLogoUrl } from '../../core/auth';
import { currentPrincipal, requirePermission } from '../../core/authz';
import { parseMultipartFile } from '../../core/http/multipart';
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

// The app-shell logo of the caller's home scope; every member may read it (no branding.view).
brandingRouter.get('/home-logo-url', async (_req, res) => {
  res.json({ data: await homeLogoUrl(currentPrincipal()) });
});

brandingRouter.get('/logo-url', view, async (req, res) => {
  res.json({
    data: await brandingService.logoUrl(parseInput(resolvedBrandingQuerySchema, req.query)),
  });
});

// Logo upload: multipart with a single `file` part (PNG/JPEG, ≤ LOGO_MAX_BYTES).
const logoFile = async (req: Request) =>
  (await parseMultipartFile(req, { maxBytes: LOGO_MAX_BYTES, maxFields: 0 })).file;

brandingRouter.post('/organization/logo', manage, async (req, res) => {
  res.status(201).json({
    data: await brandingService.uploadLogo('ORGANIZATION', undefined, await logoFile(req)),
  });
});
brandingRouter.delete('/organization/logo', manage, async (_req, res) => {
  res.json({ data: await brandingService.removeLogo('ORGANIZATION') });
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
  brandingRouter.post(`/${path}/:id/logo`, manage, async (req, res) => {
    const id = idOf(req);
    res.status(201).json({
      data: await brandingService.uploadLogo(scopeType, id, await logoFile(req)),
    });
  });
  brandingRouter.delete(`/${path}/:id/logo`, manage, async (req, res) => {
    res.json({ data: await brandingService.removeLogo(scopeType, idOf(req)) });
  });
  brandingRouter.delete(`/${path}/:id`, manage, async (req, res) => {
    await brandingService.remove(scopeType, idOf(req));
    res.status(204).end();
  });
}

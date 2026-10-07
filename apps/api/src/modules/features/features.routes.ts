import { effectiveFeaturesQuerySchema, idParamSchema, setFeatureOverrideSchema } from '@erp/shared';
import { Router } from 'express';
import { requirePermission } from '../../core/authz';
import { parseInput } from '../../core/http/validation';
import { featuresService } from './features.service';

/** /api/v1/features — module licensing state and group / institution overrides. */
export const featuresRouter = Router();

featuresRouter.get('/', requirePermission('feature.view'), async (_req, res) => {
  res.json({ data: await featuresService.overview() });
});

featuresRouter.get('/effective', requirePermission('feature.view'), async (req, res) => {
  res.json({
    data: await featuresService.effective(parseInput(effectiveFeaturesQuerySchema, req.query)),
  });
});

featuresRouter.put('/overrides', requirePermission('feature.manage'), async (req, res) => {
  res.json({
    data: await featuresService.setOverride(parseInput(setFeatureOverrideSchema, req.body)),
  });
});

featuresRouter.delete('/overrides/:id', requirePermission('feature.manage'), async (req, res) => {
  const { id } = parseInput(idParamSchema, req.params);
  await featuresService.removeOverride(id);
  res.status(204).end();
});

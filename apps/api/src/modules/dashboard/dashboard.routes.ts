import { Router } from 'express';
import { dashboardOverviewQuerySchema } from '@erp/shared';
import { parseInput } from '../../core/http/validation';
import { dashboardService } from './dashboard.service';

export const dashboardRouter = Router();

/** Date-range KPIs; each section is included only when the caller may view it. */
dashboardRouter.get('/overview', async (req, res) => {
  res.json({
    data: await dashboardService.overview(parseInput(dashboardOverviewQuerySchema, req.query)),
  });
});

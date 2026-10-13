import { z } from 'zod';
import { idSchema } from './common';
import { isoDateSchema } from './hr';

/** Longest range the overview dashboard accepts (inclusive days). */
export const DASHBOARD_MAX_RANGE_DAYS = 366;

const dayDiff = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export const dashboardOverviewQuerySchema = z
  .object({
    from: isoDateSchema,
    to: isoDateSchema,
    institutionId: idSchema.optional(),
  })
  .strict()
  .refine((q) => q.from <= q.to, { message: '"from" must be on or before "to"', path: ['to'] })
  .refine((q) => dayDiff(q.from, q.to) < DASHBOARD_MAX_RANGE_DAYS, {
    message: `Range can cover at most ${DASHBOARD_MAX_RANGE_DAYS} days`,
    path: ['to'],
  });
export type DashboardOverviewQuery = z.infer<typeof dashboardOverviewQuerySchema>;

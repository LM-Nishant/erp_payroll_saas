import {
  createHolidayCalendarSchema,
  holidayParamsSchema,
  idParamSchema,
  listHolidayCalendarsQuerySchema,
  resolveHolidaysQuerySchema,
  updateHolidayCalendarSchema,
  upsertHolidaySchema,
} from '@erp/shared';
import { Router, type Request } from 'express';
import { requirePermission } from '../../core/authz';
import { toListResponse } from '../../core/http/pagination';
import { parseInput } from '../../core/http/validation';
import { holidayService } from './holidays.service';

/** /api/v1/holidays — holiday calendars (Layer 7). Mounted behind `requireFeature('hr')`. */
export const holidaysRouter = Router();
const idOf = (req: Request) => parseInput(idParamSchema, req.params).id;

/** Effective holidays / weekly offs of an employee (own employee with `attendance.view_own`). */
holidaysRouter.get('/resolve', async (req, res) => {
  const q = parseInput(resolveHolidaysQuerySchema, req.query);
  res.json({ data: await holidayService.resolveForEmployee(q.employeeId, q.from, q.to) });
});

holidaysRouter.get('/calendars', requirePermission('holiday.view'), async (req, res) => {
  const query = parseInput(listHolidayCalendarsQuerySchema, req.query);
  const { items, total } = await holidayService.list(query);
  res.json(toListResponse(items, total, query));
});
holidaysRouter.post('/calendars', requirePermission('holiday.manage'), async (req, res) => {
  const input = parseInput(createHolidayCalendarSchema, req.body);
  res.status(201).json({ data: await holidayService.create(input) });
});
holidaysRouter.get('/calendars/:id', requirePermission('holiday.view'), async (req, res) => {
  res.json({ data: await holidayService.get(idOf(req)) });
});
holidaysRouter.patch('/calendars/:id', requirePermission('holiday.manage'), async (req, res) => {
  const input = parseInput(updateHolidayCalendarSchema, req.body);
  res.json({ data: await holidayService.update(idOf(req), input) });
});
holidaysRouter.delete('/calendars/:id', requirePermission('holiday.manage'), async (req, res) => {
  await holidayService.remove(idOf(req));
  res.status(204).end();
});
holidaysRouter.post(
  '/calendars/:id/holidays',
  requirePermission('holiday.manage'),
  async (req, res) => {
    const input = parseInput(upsertHolidaySchema, req.body);
    res.status(201).json({ data: await holidayService.upsertHoliday(idOf(req), input) });
  },
);
holidaysRouter.delete(
  '/calendars/:id/holidays/:holidayId',
  requirePermission('holiday.manage'),
  async (req, res) => {
    const { id, holidayId } = parseInput(holidayParamsSchema, req.params);
    await holidayService.removeHoliday(id, holidayId);
    res.status(204).end();
  },
);

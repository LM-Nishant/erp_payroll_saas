import {
  createShiftAssignmentSchema,
  createShiftSchema,
  idParamSchema,
  listShiftAssignmentsQuerySchema,
  listShiftsQuerySchema,
  resolveShiftQuerySchema,
  updateShiftSchema,
} from '@erp/shared';
import { Router, type Request } from 'express';
import { requirePermission } from '../../core/authz';
import { toListResponse } from '../../core/http/pagination';
import { parseInput } from '../../core/http/validation';
import { shiftService } from './shifts.service';

/** /api/v1/shifts — shift definitions + assignments (Layer 7). Behind `requireFeature('hr')`. */
export const shiftsRouter = Router();
const idOf = (req: Request) => parseInput(idParamSchema, req.params).id;

/** Effective shift of an employee on a date (own employee with `attendance.view_own`). */
shiftsRouter.get('/resolve', async (req, res) => {
  const q = parseInput(resolveShiftQuerySchema, req.query);
  res.json({ data: await shiftService.resolve(q.employeeId, q.date) });
});

shiftsRouter.get('/assignments', requirePermission('shift.view'), async (req, res) => {
  const query = parseInput(listShiftAssignmentsQuerySchema, req.query);
  const { items, total } = await shiftService.listAssignments(query);
  res.json(toListResponse(items, total, query));
});
shiftsRouter.post('/assignments', requirePermission('shift.manage'), async (req, res) => {
  const input = parseInput(createShiftAssignmentSchema, req.body);
  res.status(201).json({ data: await shiftService.createAssignment(input) });
});
shiftsRouter.delete('/assignments/:id', requirePermission('shift.manage'), async (req, res) => {
  await shiftService.removeAssignment(idOf(req));
  res.status(204).end();
});

shiftsRouter.get('/', requirePermission('shift.view'), async (req, res) => {
  const query = parseInput(listShiftsQuerySchema, req.query);
  const { items, total } = await shiftService.list(query);
  res.json(toListResponse(items, total, query));
});
shiftsRouter.post('/', requirePermission('shift.manage'), async (req, res) => {
  const input = parseInput(createShiftSchema, req.body);
  res.status(201).json({ data: await shiftService.create(input) });
});
shiftsRouter.get('/:id', requirePermission('shift.view'), async (req, res) => {
  res.json({ data: await shiftService.get(idOf(req)) });
});
shiftsRouter.patch('/:id', requirePermission('shift.manage'), async (req, res) => {
  const input = parseInput(updateShiftSchema, req.body);
  res.json({ data: await shiftService.update(idOf(req), input) });
});
shiftsRouter.delete('/:id', requirePermission('shift.manage'), async (req, res) => {
  await shiftService.remove(idOf(req));
  res.status(204).end();
});

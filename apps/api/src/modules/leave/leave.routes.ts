import {
  applyLeaveForSchema,
  applyLeaveSchema,
  cancelLeaveSchema,
  createLeavePolicySchema,
  createLeaveTypeSchema,
  idParamSchema,
  leaveAdjustmentSchema,
  leaveBalanceQuerySchema,
  leaveLedgerQuerySchema,
  leavePreviewSchema,
  listLeavePoliciesQuerySchema,
  listLeaveRequestsQuerySchema,
  listLeaveTypesQuerySchema,
  runAccrualSchema,
  runYearEndSchema,
  updateLeavePolicySchema,
  updateLeaveTypeSchema,
} from '@erp/shared';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../core/authz';
import { toListResponse } from '../../core/http/pagination';
import { parseInput } from '../../core/http/validation';
import { leaveRequestService } from './leave.requests';
import { leaveService } from './leave.service';

/** /api/v1/leave — leave types, policies, balances / ledger, requests, accrual (Layer 7). */
export const leaveRouter = Router();
const idOf = (req: Request) => parseInput(idParamSchema, req.params).id;
const myBalanceQuerySchema = z.object({ asOf: z.string().date().optional() }).strict();

/* ---- self-service ---- */

leaveRouter.get('/me/balances', async (req, res) => {
  const { asOf } = parseInput(myBalanceQuerySchema, req.query);
  res.json({ data: await leaveRequestService.myBalances(asOf) });
});
leaveRouter.get('/me/requests', async (_req, res) => {
  res.json({ data: await leaveRequestService.mine() });
});
leaveRouter.post('/me/requests', async (req, res) => {
  const input = parseInput(applyLeaveSchema, req.body);
  res.status(201).json({ data: await leaveRequestService.applyOwn(input) });
});
leaveRouter.post('/preview', async (req, res) => {
  const input = parseInput(leavePreviewSchema, req.body);
  res.json({ data: await leaveRequestService.preview(input) });
});

/* ---- leave types ---- */

leaveRouter.get('/types', async (req, res) => {
  res.json(await leaveService.listTypes(parseInput(listLeaveTypesQuerySchema, req.query)));
});
leaveRouter.post('/types', requirePermission('leave.manage'), async (req, res) => {
  const input = parseInput(createLeaveTypeSchema, req.body);
  res.status(201).json({ data: await leaveService.createType(input) });
});
leaveRouter.patch('/types/:id', requirePermission('leave.manage'), async (req, res) => {
  const input = parseInput(updateLeaveTypeSchema, req.body);
  res.json({ data: await leaveService.updateType(idOf(req), input) });
});

/* ---- policies ---- */

leaveRouter.get('/policies', requirePermission('leave.view'), async (req, res) => {
  res.json(await leaveService.listPolicies(parseInput(listLeavePoliciesQuerySchema, req.query)));
});
leaveRouter.post('/policies', requirePermission('leave.manage'), async (req, res) => {
  const input = parseInput(createLeavePolicySchema, req.body);
  res.status(201).json({ data: await leaveService.createPolicy(input) });
});
leaveRouter.get('/policies/:id', requirePermission('leave.view'), async (req, res) => {
  res.json({ data: await leaveService.getPolicy(idOf(req)) });
});
leaveRouter.patch('/policies/:id', requirePermission('leave.manage'), async (req, res) => {
  const input = parseInput(updateLeavePolicySchema, req.body);
  res.json({ data: await leaveService.updatePolicy(idOf(req), input) });
});

/* ---- balances / ledger ---- */

leaveRouter.get('/balances', async (req, res) => {
  const q = parseInput(leaveBalanceQuerySchema, req.query);
  res.json({ data: await leaveService.balances(q.employeeId, q.asOf) });
});
leaveRouter.get('/ledger', async (req, res) => {
  const query = parseInput(leaveLedgerQuerySchema, req.query);
  const { items, total } = await leaveService.ledger(query);
  res.json(toListResponse(items, total, query));
});
leaveRouter.post('/adjustments', requirePermission('leave.adjust'), async (req, res) => {
  const input = parseInput(leaveAdjustmentSchema, req.body);
  res.status(201).json({ data: await leaveService.adjust(input) });
});

/* ---- requests ---- */

leaveRouter.get('/requests', requirePermission('leave.view'), async (req, res) => {
  const query = parseInput(listLeaveRequestsQuerySchema, req.query);
  const { items, total } = await leaveRequestService.list(query);
  res.json(toListResponse(items, total, query));
});
leaveRouter.post('/requests', requirePermission('leave.apply'), async (req, res) => {
  const input = parseInput(applyLeaveForSchema, req.body);
  res.status(201).json({ data: await leaveRequestService.applyFor(input) });
});
leaveRouter.get('/requests/:id', async (req, res) => {
  res.json({ data: await leaveRequestService.get(idOf(req)) });
});
leaveRouter.post('/requests/:id/cancel', async (req, res) => {
  const { reason } = parseInput(cancelLeaveSchema, req.body);
  res.json({ data: await leaveRequestService.cancel(idOf(req), reason) });
});

/* ---- accrual / year-end ---- */

leaveRouter.post('/accrual/run', requirePermission('leave.manage'), async (req, res) => {
  const { asOf } = parseInput(runAccrualSchema, req.body ?? {});
  res.json({ data: await leaveService.runAccrual(asOf) });
});
leaveRouter.post('/year-end', requirePermission('leave.manage'), async (req, res) => {
  const { year } = parseInput(runYearEndSchema, req.body);
  res.json({ data: await leaveService.runYearEnd(year) });
});

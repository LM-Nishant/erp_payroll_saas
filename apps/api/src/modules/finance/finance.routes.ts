import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  createAccountSchema,
  createExpenseSchema,
  createVendorSchema,
  createVoucherSchema,
  feeCancelSchema,
  financeReportQuerySchema,
  financeReportSchema,
  idParamSchema,
  listExpensesQuerySchema,
  listVouchersQuerySchema,
  paginationQuerySchema,
  updateAccountSchema,
  updateVendorSchema,
} from '@erp/shared';
import { requirePermission } from '../../core/authz';
import { toListResponse } from '../../core/http/pagination';
import { parseInput } from '../../core/http/validation';
import { sendTable } from './finance.export';
import {
  accountService,
  expenseService,
  financeReportService,
  vendorService,
  voucherService,
} from './finance.service';

const idOf = (req: Request) => parseInput(idParamSchema, req.params).id;
const listVendorsQuerySchema = paginationQuerySchema
  .extend({ institutionId: z.string().uuid().optional() })
  .strict();
const listAccountsQuerySchema = z
  .object({ includeInactive: z.enum(['true', 'false']).optional() })
  .strict();

export const financeRouter = Router();

/* ---- chart of accounts ---- */
financeRouter.get('/accounts', requirePermission('finance.view'), async (req, res) => {
  const q = parseInput(listAccountsQuerySchema, req.query);
  res.json({ data: await accountService.list({ includeInactive: q.includeInactive === 'true' }) });
});
financeRouter.post('/accounts', requirePermission('finance.manage'), async (req, res) => {
  res
    .status(201)
    .json({ data: await accountService.create(parseInput(createAccountSchema, req.body)) });
});
financeRouter.patch('/accounts/:id', requirePermission('finance.manage'), async (req, res) => {
  res.json({
    data: await accountService.update(idOf(req), parseInput(updateAccountSchema, req.body)),
  });
});
financeRouter.delete('/accounts/:id', requirePermission('finance.manage'), async (req, res) => {
  await accountService.remove(idOf(req));
  res.status(204).end();
});

/* ---- vouchers ---- */
financeRouter.get('/vouchers', requirePermission('finance.view'), async (req, res) => {
  const query = parseInput(listVouchersQuerySchema, req.query);
  const { items, total } = await voucherService.list(query);
  res.json(toListResponse(items, total, query));
});
financeRouter.get('/vouchers/:id', requirePermission('finance.view'), async (req, res) => {
  res.json({ data: await voucherService.get(idOf(req)) });
});
financeRouter.post('/vouchers', requirePermission('finance.manage'), async (req, res) => {
  res
    .status(201)
    .json({ data: await voucherService.create(parseInput(createVoucherSchema, req.body)) });
});
financeRouter.post('/vouchers/:id/post', requirePermission('finance.post'), async (req, res) => {
  res.json({ data: await voucherService.post(idOf(req)) });
});
financeRouter.post('/vouchers/:id/cancel', requirePermission('finance.post'), async (req, res) => {
  res.json({
    data: await voucherService.cancel(idOf(req), parseInput(feeCancelSchema, req.body)),
  });
});

/* ---- vendors ---- */
financeRouter.get('/vendors', requirePermission('finance.view'), async (req, res) => {
  const query = parseInput(listVendorsQuerySchema, req.query);
  const { items, total } = await vendorService.list(query);
  res.json(toListResponse(items, total, query));
});
financeRouter.post('/vendors', requirePermission('finance.manage'), async (req, res) => {
  res
    .status(201)
    .json({ data: await vendorService.create(parseInput(createVendorSchema, req.body)) });
});
financeRouter.patch('/vendors/:id', requirePermission('finance.manage'), async (req, res) => {
  res.json({
    data: await vendorService.update(idOf(req), parseInput(updateVendorSchema, req.body)),
  });
});

/* ---- expenses ---- */
financeRouter.get('/expenses', requirePermission('finance.view'), async (req, res) => {
  const query = parseInput(listExpensesQuerySchema, req.query);
  const { items, total } = await expenseService.list(query);
  res.json(toListResponse(items, total, query));
});
financeRouter.post('/expenses', requirePermission('finance.manage'), async (req, res) => {
  res
    .status(201)
    .json({ data: await expenseService.create(parseInput(createExpenseSchema, req.body)) });
});
financeRouter.post(
  '/expenses/:id/cancel',
  requirePermission('finance.manage'),
  async (req, res) => {
    res.json({
      data: await expenseService.cancel(idOf(req), parseInput(feeCancelSchema, req.body)),
    });
  },
);

/* ---- reports ---- */
financeRouter.get('/reports/:key', requirePermission('finance.view'), async (req, res) => {
  const key = parseInput(z.object({ key: financeReportSchema }), req.params).key;
  const q = parseInput(financeReportQuerySchema, req.query);
  const table = await financeReportService.build(key, q);
  await sendTable(res, table, q.format, { kind: key, institutionId: q.institutionId });
});

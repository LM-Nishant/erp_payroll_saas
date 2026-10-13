import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  createAdhocInvoiceSchema,
  createConcessionSchema,
  createFeeHeadSchema,
  createFeeStructureSchema,
  createLateRuleSchema,
  defaultersQuerySchema,
  feeCancelSchema,
  feeReportQuerySchema,
  feeReportSchema,
  feeUpiSettingSchema,
  feeUpiSettingsQuerySchema,
  generateInvoicesSchema,
  idParamSchema,
  listConcessionsQuerySchema,
  listFeeHeadsQuerySchema,
  listFeeInvoicesQuerySchema,
  listFeeStructuresQuerySchema,
  listPaymentsQuerySchema,
  listUpiPaymentsQuerySchema,
  recordPaymentSchema,
  refundPaymentSchema,
  rejectUpiPaymentSchema,
  sendRemindersSchema,
  studentChargeSchema,
  submitUpiPaymentSchema,
  updateConcessionSchema,
  updateFeeHeadSchema,
  updateFeeStructureSchema,
  updateLateRuleSchema,
  updateNumberSeriesSchema,
  upiIntentSchema,
} from '@erp/shared';
import { audit } from '../../core/audit';
import { authorize, currentPrincipal, requirePermission } from '../../core/authz';
import { toListResponse } from '../../core/http/pagination';
import { parseInput } from '../../core/http/validation';
import { logger } from '../../core/logger';
import { runAsSystem } from '../../core/queue';
import { tenantDb, withTenant } from '../../core/tenancy';
import { institutionScope } from '../finance/finance.ledger';
import { sendTable } from '../finance/finance.export';
import { loadFeeStudent } from './fees.access';
import { feeDuesService } from './fees.dues.service';
import { resolveProviderGateway } from './fees.gateway';
import { createStudentCharge, feeInvoiceService } from './fees.invoices.service';
import { feePaymentService, handleGatewayEvent } from './fees.payments.service';
import { feeUpiService } from './fees.upi.service';
import {
  concessionService,
  feeHeadService,
  feeStructureService,
  lateRuleService,
} from './fees.setup.service';

const idOf = (req: Request) => parseInput(idParamSchema, req.params).id;
const institutionQuerySchema = z.object({ institutionId: z.string().uuid().optional() }).strict();

export const feesRouter = Router();

/* ---- portal (self / wards) — before /:id style routes ---- */
feesRouter.get('/me', requirePermission('fee.view_own'), async (_req, res) => {
  res.json({ data: await feeDuesService.me() });
});
feesRouter.get('/my-wards', requirePermission('fee.view_own'), async (_req, res) => {
  res.json({ data: await feeDuesService.myWards() });
});
feesRouter.get('/students/:id/summary', async (req, res) => {
  res.json({ data: await feeDuesService.studentSummary(idOf(req)) });
});

/* ---- fee heads ---- */
feesRouter.get('/heads', requirePermission('fee.view'), async (req, res) => {
  const q = parseInput(listFeeHeadsQuerySchema, req.query);
  const { items, total } = await feeHeadService.list(q);
  res.json(toListResponse(items, total, q));
});
feesRouter.post('/heads', requirePermission('fee.manage'), async (req, res) => {
  res
    .status(201)
    .json({ data: await feeHeadService.create(parseInput(createFeeHeadSchema, req.body)) });
});
feesRouter.patch('/heads/:id', requirePermission('fee.manage'), async (req, res) => {
  res.json({
    data: await feeHeadService.update(idOf(req), parseInput(updateFeeHeadSchema, req.body)),
  });
});
feesRouter.delete('/heads/:id', requirePermission('fee.manage'), async (req, res) => {
  await feeHeadService.remove(idOf(req));
  res.status(204).end();
});

/* ---- late-fee rules ---- */
feesRouter.get('/late-rules', requirePermission('fee.view'), async (req, res) => {
  res.json({ data: await lateRuleService.list(parseInput(institutionQuerySchema, req.query)) });
});
feesRouter.post('/late-rules', requirePermission('fee.manage'), async (req, res) => {
  res
    .status(201)
    .json({ data: await lateRuleService.create(parseInput(createLateRuleSchema, req.body)) });
});
feesRouter.patch('/late-rules/:id', requirePermission('fee.manage'), async (req, res) => {
  res.json({
    data: await lateRuleService.update(idOf(req), parseInput(updateLateRuleSchema, req.body)),
  });
});
feesRouter.delete('/late-rules/:id', requirePermission('fee.manage'), async (req, res) => {
  await lateRuleService.remove(idOf(req));
  res.status(204).end();
});

/* ---- structures ---- */
feesRouter.get('/structures', requirePermission('fee.view'), async (req, res) => {
  const q = parseInput(listFeeStructuresQuerySchema, req.query);
  const { items, total } = await feeStructureService.list(q);
  res.json(toListResponse(items, total, q));
});
feesRouter.post('/structures', requirePermission('fee.manage'), async (req, res) => {
  res.status(201).json({
    data: await feeStructureService.create(parseInput(createFeeStructureSchema, req.body)),
  });
});
feesRouter.get('/structures/:id', requirePermission('fee.view'), async (req, res) => {
  res.json({ data: await feeStructureService.get(idOf(req)) });
});
feesRouter.patch('/structures/:id', requirePermission('fee.manage'), async (req, res) => {
  res.json({
    data: await feeStructureService.update(
      idOf(req),
      parseInput(updateFeeStructureSchema, req.body),
    ),
  });
});
feesRouter.delete('/structures/:id', requirePermission('fee.manage'), async (req, res) => {
  await feeStructureService.remove(idOf(req));
  res.status(204).end();
});

/* ---- concessions ---- */
feesRouter.get('/concessions', requirePermission('fee.view'), async (req, res) => {
  const q = parseInput(listConcessionsQuerySchema, req.query);
  const { items, total } = await concessionService.list(q);
  res.json(toListResponse(items, total, q));
});
feesRouter.post('/concessions', requirePermission('fee.concession'), async (req, res) => {
  res.status(201).json({
    data: await concessionService.create(parseInput(createConcessionSchema, req.body)),
  });
});
feesRouter.patch('/concessions/:id', requirePermission('fee.concession'), async (req, res) => {
  res.json({
    data: await concessionService.update(idOf(req), parseInput(updateConcessionSchema, req.body)),
  });
});
feesRouter.delete('/concessions/:id', requirePermission('fee.concession'), async (req, res) => {
  await concessionService.remove(idOf(req));
  res.status(204).end();
});

/* ---- invoices ---- */
feesRouter.post('/invoices/generate', requirePermission('fee.manage'), async (req, res) => {
  res.json({
    data: await feeInvoiceService.generate(parseInput(generateInvoicesSchema, req.body)),
  });
});
feesRouter.post('/charges', requirePermission('fee.manage'), async (req, res) => {
  const input = parseInput(studentChargeSchema, req.body);
  await loadFeeStudent(input.studentId, 'fee.manage');
  res.status(201).json({ data: await createStudentCharge(input) });
});
feesRouter.get('/invoices', requirePermission('fee.view'), async (req, res) => {
  const q = parseInput(listFeeInvoicesQuerySchema, req.query);
  const { items, total } = await feeInvoiceService.list(q);
  res.json(toListResponse(items, total, q));
});
feesRouter.post('/invoices', requirePermission('fee.manage'), async (req, res) => {
  res.status(201).json({
    data: await feeInvoiceService.createAdhoc(parseInput(createAdhocInvoiceSchema, req.body)),
  });
});
feesRouter.get('/invoices/:id', async (req, res) => {
  res.json({ data: await feeInvoiceService.get(idOf(req)) });
});
feesRouter.post('/invoices/:id/cancel', requirePermission('fee.manage'), async (req, res) => {
  res.json({
    data: await feeInvoiceService.cancel(idOf(req), parseInput(feeCancelSchema, req.body)),
  });
});

/* ---- payments / receipts ---- */
feesRouter.get('/payments', requirePermission('fee.view'), async (req, res) => {
  const q = parseInput(listPaymentsQuerySchema, req.query);
  const { items, total } = await feePaymentService.list(q);
  res.json(toListResponse(items, total, q));
});
feesRouter.post('/payments', requirePermission('fee.collect'), async (req, res) => {
  res
    .status(201)
    .json({ data: await feePaymentService.record(parseInput(recordPaymentSchema, req.body)) });
});
feesRouter.get('/payments/:id', async (req, res) => {
  res.json({ data: await feePaymentService.get(idOf(req)) });
});
feesRouter.get('/payments/:id/receipt', async (req, res) => {
  const pdf = await feePaymentService.receiptPdf(idOf(req));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${pdf.fileName}"`);
  res.send(pdf.body);
});
feesRouter.post('/payments/:id/cancel', requirePermission('fee.refund'), async (req, res) => {
  res.json({
    data: await feePaymentService.cancel(idOf(req), parseInput(feeCancelSchema, req.body)),
  });
});
feesRouter.post('/payments/:id/refund', requirePermission('fee.refund'), async (req, res) => {
  res.json({
    data: await feePaymentService.refund(idOf(req), parseInput(refundPaymentSchema, req.body)),
  });
});

/* ---- UPI collection (the only way fees are paid) ---- */
feesRouter.get('/upi/settings', requirePermission('fee.view'), async (req, res) => {
  const q = parseInput(feeUpiSettingsQuerySchema, req.query);
  res.json({ data: await feeUpiService.listSettings(q) });
});
feesRouter.put('/upi/settings', requirePermission('fee.manage'), async (req, res) => {
  res.json({ data: await feeUpiService.saveSetting(parseInput(feeUpiSettingSchema, req.body)) });
});
/** Payer (student / guardian / staff): QR + upi:// link for the selected invoices. */
feesRouter.post('/upi/intent', async (req, res) => {
  res.json({ data: await feeUpiService.intent(parseInput(upiIntentSchema, req.body)) });
});
/** Payer reports the UTR of a completed UPI transfer. */
feesRouter.post('/upi/payments', async (req, res) => {
  res
    .status(201)
    .json({ data: await feeUpiService.submit(parseInput(submitUpiPaymentSchema, req.body)) });
});
feesRouter.get('/upi/payments', requirePermission('fee.collect'), async (req, res) => {
  const q = parseInput(listUpiPaymentsQuerySchema, req.query);
  const { items, total } = await feeUpiService.list(q);
  res.json(toListResponse(items, total, q));
});
feesRouter.post('/upi/payments/:id/verify', requirePermission('fee.collect'), async (req, res) => {
  res.json({ data: await feeUpiService.verify(idOf(req)) });
});
feesRouter.post('/upi/payments/:id/reject', requirePermission('fee.collect'), async (req, res) => {
  res.json({
    data: await feeUpiService.reject(idOf(req), parseInput(rejectUpiPaymentSchema, req.body)),
  });
});

/* ---- dues, reminders, late fees ---- */
feesRouter.get('/defaulters', requirePermission('fee.view'), async (req, res) => {
  const q = parseInput(defaultersQuerySchema, req.query);
  const { items, total } = await feeDuesService.defaulters(q);
  res.json(toListResponse(items, total, q));
});
feesRouter.post('/reminders/send', requirePermission('fee.manage'), async (req, res) => {
  res.json({ data: await feeDuesService.sendReminders(parseInput(sendRemindersSchema, req.body)) });
});
feesRouter.post('/late-fees/apply', requirePermission('fee.manage'), async (req, res) => {
  res.json({
    data: await feeDuesService.applyLateFees(parseInput(institutionQuerySchema, req.body ?? {})),
  });
});

/* ---- reports ---- */
feesRouter.get('/reports/:key', requirePermission('fee.view'), async (req, res) => {
  const key = parseInput(z.object({ key: feeReportSchema }), req.params).key;
  const q = parseInput(feeReportQuerySchema, req.query);
  const table = await feeDuesService.report(key, q);
  await sendTable(res, table, q.format, { kind: `fee_${key}`, institutionId: q.institutionId });
});

/* ---- number series ---- */
feesRouter.get('/number-series', requirePermission('fee.manage'), async (req, res) => {
  const { institutionId } = parseInput(institutionQuerySchema, req.query);
  const rows = await tenantDb().financeNumberSeries.findMany({
    where: institutionId ? { institutionId } : {},
    orderBy: [{ institutionId: 'asc' }, { kind: 'asc' }],
  });
  res.json({
    data: rows.map((r) => ({
      id: r.id,
      institutionId: r.institutionId,
      kind: r.kind,
      prefix: r.prefix,
      nextValue: r.nextValue,
      padding: r.padding,
    })),
  });
});
feesRouter.put('/number-series', requirePermission('fee.manage'), async (req, res) => {
  const input = parseInput(updateNumberSeriesSchema, req.body);
  await authorize(currentPrincipal(), 'fee.manage', await institutionScope(input.institutionId));
  const db = tenantDb();
  const existing = await db.financeNumberSeries.findFirst({
    where: { institutionId: input.institutionId, kind: input.kind },
  });
  const data = {
    prefix: input.prefix,
    ...(input.nextValue !== undefined ? { nextValue: input.nextValue } : {}),
    ...(input.padding !== undefined ? { padding: input.padding } : {}),
  };
  const row = existing
    ? await db.financeNumberSeries.update({ where: { id: existing.id }, data })
    : await db.financeNumberSeries.create({
        data: withTenant({ institutionId: input.institutionId, kind: input.kind, ...data }),
      });
  await audit.record({
    action: 'finance_number_series.updated',
    entityType: 'finance_number_series',
    entityId: row.id,
    before: existing ?? undefined,
    after: row,
  });
  res.json({ data: row });
});

/**
 * Public gateway webhook: `POST /api/v1/fees/webhooks/:provider/:organizationId`. The HMAC
 * signature (header `x-gateway-signature` / `x-razorpay-signature`) is the credential.
 */
export const feesWebhookRouter = Router();
feesWebhookRouter.post('/:provider/:organizationId', async (req, res) => {
  const params = parseInput(
    z.object({ provider: z.string().min(1).max(32), organizationId: z.string().uuid() }).strict(),
    req.params,
  );
  const raw =
    (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
  const signature =
    (req.headers['x-gateway-signature'] as string | undefined) ??
    (req.headers['x-razorpay-signature'] as string | undefined);
  const result = await runAsSystem(params.organizationId, async () => {
    const gateway = await resolveProviderGateway(params.provider, null);
    if (!gateway) return 'unknown';
    const event = gateway.verifyWebhook(raw, signature);
    if (!event) return 'invalid';
    try {
      await handleGatewayEvent(event);
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'Fee gateway webhook handling failed');
    }
    return 'ok';
  }).catch(() => 'unknown');
  if (result === 'invalid') {
    res.status(401).json({ error: { code: 'INVALID_SIGNATURE', message: 'Invalid signature' } });
    return;
  }
  res.json({ data: { received: result === 'ok' } });
});

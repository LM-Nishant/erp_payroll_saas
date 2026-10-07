import { Router, type Request, type Response } from 'express';
import {
  acknowledgeAssignmentSchema,
  assetDashboardQuerySchema,
  assetDepreciationQuerySchema,
  assetLabelsSchema,
  assetReportQuerySchema,
  checkinAssetSchema,
  checkoutAssetSchema,
  createAssetAuditSchema,
  createAssetCategorySchema,
  createAssetDisposalSchema,
  createAssetMaintenanceSchema,
  createAssetSchema,
  createAssetTransferSchema,
  createInventoryItemSchema,
  decideAssetDisposalSchema,
  idParamSchema,
  inventoryTransactionSchema,
  listAssetAssignmentsQuerySchema,
  listAssetAuditItemsQuerySchema,
  listAssetAuditsQuerySchema,
  listAssetCategoriesQuerySchema,
  listAssetDisposalsQuerySchema,
  listAssetMaintenanceQuerySchema,
  listAssetsQuerySchema,
  listAssetTransfersQuerySchema,
  listInventoryItemsQuerySchema,
  paginationQuerySchema,
  reportAssetIssueSchema,
  updateAssetCategorySchema,
  updateAssetMaintenanceSchema,
  updateAssetSchema,
  updateInventoryItemSchema,
  verifyAssetAuditItemSchema,
} from '@erp/shared';
import { requirePermission } from '../../core/authz';
import { parseMultipartFile } from '../../core/http/multipart';
import { toListResponse } from '../../core/http/pagination';
import { parseInput } from '../../core/http/validation';
import { custodyService } from './assets.custody';
import { inventoryService } from './assets.inventory';
import { parseDate } from './assets.logic';
import { auditService, disposalService, maintenanceService } from './assets.maintenance';
import { exportAssetReport } from './assets.reports';
import { INVOICE_MAX_BYTES, assetService, categoryService } from './assets.service';

const idOf = (req: Request) => parseInput(idParamSchema, req.params).id;

function sendFile(res: Response, file: { fileName: string; contentType: string; body: Buffer }) {
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
  res.send(file.body);
}

export const assetsRouter = Router();
const r = assetsRouter;

/* ---- employee self-service ("My assets") ---- */
r.get('/my', requirePermission('asset.view_own'), async (_req, res) => {
  res.json({ data: await custodyService.myAssets() });
});
r.post('/my/:id/acknowledge', requirePermission('asset.view_own'), async (req, res) => {
  res.json({
    data: await custodyService.acknowledge(
      idOf(req),
      parseInput(acknowledgeAssignmentSchema, req.body ?? {}),
    ),
  });
});
r.post('/my/:id/issue', requirePermission('asset.view_own'), async (req, res) => {
  res.status(201).json({
    data: await custodyService.reportIssue(idOf(req), parseInput(reportAssetIssueSchema, req.body)),
  });
});

/* ---- dashboard / reports / labels ---- */
r.get('/dashboard', requirePermission('asset.view'), async (req, res) => {
  res.json({
    data: await assetService.dashboard(parseInput(assetDashboardQuerySchema, req.query)),
  });
});
r.get('/reports', requirePermission('asset.view'), async (req, res) => {
  const out = await exportAssetReport(parseInput(assetReportQuerySchema, req.query));
  if ('body' in out) sendFile(res, out);
  else res.json({ data: out });
});
/** QR label sheet PDF: `?assetIds=a,b` or `?institutionId=…[&categoryId=…]`. */
r.get('/labels', requirePermission('asset.view'), async (req, res) => {
  const q = { ...req.query } as Record<string, unknown>;
  if (typeof q.assetIds === 'string') q.assetIds = q.assetIds.split(',').filter(Boolean);
  sendFile(res, await assetService.labels(parseInput(assetLabelsSchema, q)));
});

/* ---- categories ---- */
r.get('/categories', requirePermission('asset.view'), async (req, res) => {
  const query = parseInput(listAssetCategoriesQuerySchema, req.query);
  const { items, total } = await categoryService.list(query);
  res.json(toListResponse(items, total, query));
});
r.post('/categories', requirePermission('asset.manage'), async (req, res) => {
  res
    .status(201)
    .json({ data: await categoryService.create(parseInput(createAssetCategorySchema, req.body)) });
});
r.get('/categories/:id', requirePermission('asset.view'), async (req, res) => {
  res.json({ data: await categoryService.get(idOf(req)) });
});
r.patch('/categories/:id', requirePermission('asset.manage'), async (req, res) => {
  res.json({
    data: await categoryService.update(idOf(req), parseInput(updateAssetCategorySchema, req.body)),
  });
});
r.delete('/categories/:id', requirePermission('asset.manage'), async (req, res) => {
  await categoryService.remove(idOf(req));
  res.status(204).end();
});

/* ---- custody ---- */
r.get('/assignments', requirePermission('asset.view'), async (req, res) => {
  const query = parseInput(listAssetAssignmentsQuerySchema, req.query);
  const { items, total } = await custodyService.listAssignments(query);
  res.json(toListResponse(items, total, query));
});
/** Handover form: the custodian (asset.view_own) or anyone who can view the asset. */
r.get('/assignments/:id/handover', async (req, res) => {
  res.json({ data: await custodyService.handoverUrl(idOf(req)) });
});
r.get('/transfers', requirePermission('asset.view'), async (req, res) => {
  const query = parseInput(listAssetTransfersQuerySchema, req.query);
  const { items, total } = await custodyService.listTransfers(query);
  res.json(toListResponse(items, total, query));
});
r.post('/transfers/:id/cancel', requirePermission('asset.assign'), async (req, res) => {
  res.json({ data: await custodyService.cancelTransfer(idOf(req)) });
});

/* ---- maintenance ---- */
r.get('/maintenance', requirePermission('asset.view'), async (req, res) => {
  const query = parseInput(listAssetMaintenanceQuerySchema, req.query);
  const { items, total } = await maintenanceService.list(query);
  res.json(toListResponse(items, total, query));
});
r.post('/maintenance', requirePermission('asset.maintain'), async (req, res) => {
  res.status(201).json({
    data: await maintenanceService.create(parseInput(createAssetMaintenanceSchema, req.body)),
  });
});
r.get('/maintenance/:id', requirePermission('asset.view'), async (req, res) => {
  res.json({ data: await maintenanceService.get(idOf(req)) });
});
r.patch('/maintenance/:id', requirePermission('asset.maintain'), async (req, res) => {
  res.json({
    data: await maintenanceService.update(
      idOf(req),
      parseInput(updateAssetMaintenanceSchema, req.body),
    ),
  });
});

/* ---- disposal / write-off ---- */
r.get('/disposals', requirePermission('asset.view'), async (req, res) => {
  const query = parseInput(listAssetDisposalsQuerySchema, req.query);
  const { items, total } = await disposalService.list(query);
  res.json(toListResponse(items, total, query));
});
r.post('/disposals', requirePermission('asset.dispose'), async (req, res) => {
  res
    .status(201)
    .json({ data: await disposalService.create(parseInput(createAssetDisposalSchema, req.body)) });
});
r.post('/disposals/:id/approve', requirePermission('asset.dispose'), async (req, res) => {
  const { comment } = parseInput(decideAssetDisposalSchema, req.body ?? {});
  res.json({ data: await disposalService.decide(idOf(req), true, comment ?? null) });
});
r.post('/disposals/:id/reject', requirePermission('asset.dispose'), async (req, res) => {
  const { comment } = parseInput(decideAssetDisposalSchema, req.body ?? {});
  res.json({ data: await disposalService.decide(idOf(req), false, comment ?? null) });
});
r.post('/disposals/:id/cancel', requirePermission('asset.dispose'), async (req, res) => {
  res.json({ data: await disposalService.cancel(idOf(req)) });
});

/* ---- physical verification ---- */
r.get('/audits', requirePermission('asset.audit'), async (req, res) => {
  const query = parseInput(listAssetAuditsQuerySchema, req.query);
  const { items, total } = await auditService.list(query);
  res.json(toListResponse(items, total, query));
});
r.post('/audits', requirePermission('asset.audit'), async (req, res) => {
  res
    .status(201)
    .json({ data: await auditService.create(parseInput(createAssetAuditSchema, req.body)) });
});
r.get('/audits/:id', requirePermission('asset.audit'), async (req, res) => {
  res.json({ data: await auditService.get(idOf(req)) });
});
r.get('/audits/:id/items', requirePermission('asset.audit'), async (req, res) => {
  const query = parseInput(listAssetAuditItemsQuerySchema, req.query);
  const { items, total } = await auditService.listItems(idOf(req), query);
  res.json(toListResponse(items, total, query));
});
r.post('/audits/:id/verify', requirePermission('asset.audit'), async (req, res) => {
  res.json({
    data: await auditService.verify(idOf(req), parseInput(verifyAssetAuditItemSchema, req.body)),
  });
});
r.post('/audits/:id/complete', requirePermission('asset.audit'), async (req, res) => {
  res.json({ data: await auditService.complete(idOf(req)) });
});
r.post('/audits/:id/cancel', requirePermission('asset.audit'), async (req, res) => {
  res.json({ data: await auditService.cancel(idOf(req)) });
});

/* ---- consumables / inventory ---- */
r.get('/inventory', requirePermission('asset.view'), async (req, res) => {
  const query = parseInput(listInventoryItemsQuerySchema, req.query);
  const { items, total } = await inventoryService.list(query);
  res.json(toListResponse(items, total, query));
});
r.post('/inventory', requirePermission('asset.manage'), async (req, res) => {
  res
    .status(201)
    .json({ data: await inventoryService.create(parseInput(createInventoryItemSchema, req.body)) });
});
r.get('/inventory/:id', requirePermission('asset.view'), async (req, res) => {
  res.json({ data: await inventoryService.get(idOf(req)) });
});
r.patch('/inventory/:id', requirePermission('asset.manage'), async (req, res) => {
  res.json({
    data: await inventoryService.update(idOf(req), parseInput(updateInventoryItemSchema, req.body)),
  });
});
r.delete('/inventory/:id', requirePermission('asset.manage'), async (req, res) => {
  await inventoryService.remove(idOf(req));
  res.status(204).end();
});
r.get('/inventory/:id/transactions', requirePermission('asset.view'), async (req, res) => {
  const query = parseInput(paginationQuerySchema, req.query);
  const { items, total } = await inventoryService.transactions(idOf(req), query);
  res.json(toListResponse(items, total, query));
});
r.post('/inventory/:id/transactions', requirePermission('asset.manage'), async (req, res) => {
  res.status(201).json({
    data: await inventoryService.transact(
      idOf(req),
      parseInput(inventoryTransactionSchema, req.body),
    ),
  });
});

/* ---- asset register ---- */
r.get('/', requirePermission('asset.view'), async (req, res) => {
  const query = parseInput(listAssetsQuerySchema, req.query);
  const { items, total } = await assetService.list(query);
  res.json(toListResponse(items, total, query));
});
r.post('/', requirePermission('asset.manage'), async (req, res) => {
  res
    .status(201)
    .json({ data: await assetService.create(parseInput(createAssetSchema, req.body)) });
});
r.get('/:id', requirePermission('asset.view'), async (req, res) => {
  res.json({ data: await assetService.get(idOf(req)) });
});
r.patch('/:id', requirePermission('asset.manage'), async (req, res) => {
  res.json({ data: await assetService.update(idOf(req), parseInput(updateAssetSchema, req.body)) });
});
r.delete('/:id', requirePermission('asset.manage'), async (req, res) => {
  await assetService.remove(idOf(req));
  res.status(204).end();
});
r.post('/:id/invoice', requirePermission('asset.manage'), async (req, res) => {
  const { file } = await parseMultipartFile(req, { maxBytes: INVOICE_MAX_BYTES, maxFields: 2 });
  res.status(201).json({ data: await assetService.uploadInvoice(idOf(req), file) });
});
r.get('/:id/invoice', requirePermission('asset.view'), async (req, res) => {
  res.json({ data: await assetService.invoiceUrl(idOf(req)) });
});
r.get('/:id/depreciation', requirePermission('asset.view'), async (req, res) => {
  const { asOf } = parseInput(assetDepreciationQuerySchema, req.query);
  res.json({
    data: await assetService.depreciation(idOf(req), asOf ? parseDate(asOf) : undefined),
  });
});
r.post('/:id/checkout', requirePermission('asset.assign'), async (req, res) => {
  res.status(201).json({
    data: await custodyService.checkout(idOf(req), parseInput(checkoutAssetSchema, req.body)),
  });
});
r.post('/:id/checkin', requirePermission('asset.assign'), async (req, res) => {
  res.json({
    data: await custodyService.checkin(idOf(req), parseInput(checkinAssetSchema, req.body)),
  });
});
r.post('/:id/transfer', requirePermission('asset.assign'), async (req, res) => {
  res.status(201).json({
    data: await custodyService.requestTransfer(
      idOf(req),
      parseInput(createAssetTransferSchema, req.body),
    ),
  });
});

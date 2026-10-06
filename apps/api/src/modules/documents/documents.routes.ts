import {
  completeUploadSchema,
  createDocumentGrantSchema,
  createSignatureRequestSchema,
  deleteDocumentQuerySchema,
  documentListQuerySchema,
  documentSubParamsSchema,
  documentVersionParamsSchema,
  downloadUrlSchema,
  expiringDocumentsQuerySchema,
  idParamSchema,
  restoreVersionSchema,
  updateDocumentSchema,
  updateSignatureSchema,
  uploadIdParamsSchema,
  versionFieldsSchema,
} from '@erp/shared';
import { Router, type Request } from 'express';
import { env } from '../../core/config/env';
import { documentEngine } from '../../core/documents';
import { jsonField, parseMultipartFile } from '../../core/http/multipart';
import { toListResponse } from '../../core/http/pagination';
import { parseInput } from '../../core/http/validation';

/**
 * /api/v1/documents — document engine API. Authorization happens per document inside the
 * engine (RBAC + scope + confidentiality, explicit grants, owner self-access), so these routes
 * deliberately do not use a single `requirePermission` guard. Mounted behind
 * `requireFeature('documents')`.
 */
export const documentsRouter = Router();

const idOf = (req: Request) => parseInput(idParamSchema, req.params).id;
const multipart = (req: Request) =>
  parseMultipartFile(req, { maxBytes: env.STORAGE_MAX_UPLOAD_BYTES });

documentsRouter.get('/', async (req, res) => {
  const query = parseInput(documentListQuerySchema, req.query);
  const { items, total } = await documentEngine.list(query);
  res.json(toListResponse(items, total, query));
});

documentsRouter.get('/expiring', async (req, res) => {
  const query = parseInput(expiringDocumentsQuerySchema, req.query);
  const { items, total } = await documentEngine.expiring(query);
  res.json(toListResponse(items, total, query));
});

// Direct upload through the API: multipart `file` + `metadata` (JSON).
documentsRouter.post('/files', async (req, res) => {
  const { file, fields } = await multipart(req);
  const metadata = jsonField(fields, 'metadata') as Record<string, unknown>;
  const document = await documentEngine.attach({
    ownerType: typeof metadata.ownerType === 'string' ? metadata.ownerType : 'organization',
    ownerId: typeof metadata.ownerId === 'string' ? metadata.ownerId : undefined,
    module: 'documents',
    metadata,
    file,
  });
  res.status(201).json({ data: document });
});

// Signed-URL upload flow: request → PUT to the URL → complete.
documentsRouter.post('/uploads', async (req, res) => {
  res.status(201).json({ data: await documentEngine.requestUpload(req.body) });
});
documentsRouter.post('/uploads/:uploadId/complete', async (req, res) => {
  const { uploadId } = parseInput(uploadIdParamsSchema, req.params);
  const input = parseInput(completeUploadSchema, req.body ?? {});
  res.status(201).json({ data: await documentEngine.completeUpload(uploadId, input) });
});

documentsRouter.get('/:id', async (req, res) => {
  res.json({ data: await documentEngine.get(idOf(req)) });
});
documentsRouter.patch('/:id', async (req, res) => {
  res.json({
    data: await documentEngine.update(idOf(req), parseInput(updateDocumentSchema, req.body)),
  });
});
documentsRouter.delete('/:id', async (req, res) => {
  const { reason } = parseInput(deleteDocumentQuerySchema, req.query);
  await documentEngine.remove(idOf(req), reason);
  res.status(204).end();
});

documentsRouter.get('/:id/versions', async (req, res) => {
  res.json({ data: await documentEngine.versions(idOf(req)) });
});
documentsRouter.post('/:id/versions', async (req, res) => {
  const id = idOf(req);
  const { file, fields } = await multipart(req);
  const { reason } = parseInput(versionFieldsSchema, fields);
  res.status(201).json({ data: await documentEngine.addVersion(id, file, { reason }) });
});
documentsRouter.post('/:id/versions/uploads', async (req, res) => {
  res.status(201).json({ data: await documentEngine.requestVersionUpload(idOf(req), req.body) });
});
documentsRouter.post('/:id/versions/:versionId/restore', async (req, res) => {
  const { id, versionId } = parseInput(documentVersionParamsSchema, req.params);
  const { reason } = parseInput(restoreVersionSchema, req.body ?? {});
  res.status(201).json({ data: await documentEngine.restoreVersion(id, versionId, reason) });
});

// Every call issues a fresh short-lived signed URL and writes a `document.download` audit row.
documentsRouter.post('/:id/download-url', async (req, res) => {
  const input = parseInput(downloadUrlSchema, req.body ?? {});
  res.status(201).json({ data: await documentEngine.downloadUrl(idOf(req), input) });
});

documentsRouter.get('/:id/permissions', async (req, res) => {
  res.json({ data: await documentEngine.listGrants(idOf(req)) });
});
documentsRouter.post('/:id/permissions', async (req, res) => {
  const id = idOf(req);
  const input = parseInput(createDocumentGrantSchema, req.body);
  res.status(201).json({ data: await documentEngine.createGrant(id, input) });
});
documentsRouter.delete('/:id/permissions/:subId', async (req, res) => {
  const { id, subId } = parseInput(documentSubParamsSchema, req.params);
  await documentEngine.deleteGrant(id, subId);
  res.status(204).end();
});

documentsRouter.get('/:id/signatures', async (req, res) => {
  res.json({ data: await documentEngine.listSignatures(idOf(req)) });
});
documentsRouter.post('/:id/signatures', async (req, res) => {
  const id = idOf(req);
  const input = parseInput(createSignatureRequestSchema, req.body);
  res.status(201).json({ data: await documentEngine.requestSignature(id, input) });
});
documentsRouter.patch('/:id/signatures/:subId', async (req, res) => {
  const { id, subId } = parseInput(documentSubParamsSchema, req.params);
  const input = parseInput(updateSignatureSchema, req.body);
  res.json({ data: await documentEngine.updateSignature(id, subId, input) });
});

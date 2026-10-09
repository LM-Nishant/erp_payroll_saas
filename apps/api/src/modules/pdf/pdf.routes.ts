import { idParamSchema } from '@erp/shared';
import { Router } from 'express';
import { requirePermission } from '../../core/authz';
import { documentEngine } from '../../core/documents';
import { parseInput } from '../../core/http/validation';
import { generatePdf, pdfTemplates, regenerateStoredPdf } from '../../core/pdf';

/**
 * /api/v1/pdf — template catalogue and generation. Generated PDFs are stored as documents
 * (scope-checked `pdf.generate` + `document.upload` in the owner's scope).
 */
export const pdfRouter = Router();

pdfRouter.get('/templates', requirePermission('pdf.generate'), (_req, res) => {
  res.json({ data: pdfTemplates() });
});

pdfRouter.post('/generate', requirePermission('pdf.generate'), async (req, res) => {
  res.status(201).json({ data: await generatePdf(req.body) });
});

/**
 * Re-render a stored generated PDF (letters, handover forms, …) with the CURRENT branding as a
 * new version of the same document. Requires `pdf.generate` in the document's scope and the
 * document engine's `upload_version` right; documents without a stored template input → 409.
 */
pdfRouter.post('/documents/:id/regenerate', requirePermission('pdf.generate'), async (req, res) => {
  const { documentId, version } = await regenerateStoredPdf(
    parseInput(idParamSchema, req.params).id,
  );
  res.status(201).json({ data: { document: await documentEngine.get(documentId), version } });
});

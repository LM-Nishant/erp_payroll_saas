import { Router } from 'express';
import { requirePermission } from '../../core/authz';
import { generatePdf, pdfTemplates } from '../../core/pdf';

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

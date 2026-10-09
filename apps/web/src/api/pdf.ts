import type { DocumentDto, DocumentVersionDto } from '@erp/shared';
import { apiFetch } from './client';

/**
 * Stored generated PDFs (letters, handover forms, …) keep their template input, so they can be
 * re-rendered with the CURRENT branding (logo, colours, letterhead) as a new document version.
 */
export function canRegeneratePdf(doc: DocumentDto, can: (permission: string) => boolean): boolean {
  return (
    doc.metadata?.pdfRegeneratable === true &&
    doc.allowedActions.includes('upload_version') &&
    can('pdf.generate')
  );
}

export async function regeneratePdf(
  doc: DocumentDto,
): Promise<{ document: DocumentDto; version: DocumentVersionDto }> {
  return (
    await apiFetch<{ data: { document: DocumentDto; version: DocumentVersionDto } }>(
      `/api/v1/pdf/documents/${doc.id}/regenerate`,
      { method: 'POST', body: '{}' },
    )
  ).data;
}

export const REGENERATE_CONFIRM =
  'Regenerate this PDF with the current logo and branding? It is saved as a new version; ' +
  'earlier versions stay in the document history.';

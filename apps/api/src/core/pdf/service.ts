import {
  generatePdfSchema,
  type DocumentDto,
  type DocumentVersionDto,
  type ResolvedBrandingDto,
} from '@erp/shared';
import type { Prisma } from '@prisma/client';
import { audit } from '../audit';
import { authorize, currentPrincipal } from '../authz';
import { resolveBranding } from '../branding';
import { AppError, NotFoundError } from '../http/errors';
import { parseInput } from '../http/validation';
import { documentEngine } from '../documents/service';
import { PDF_INPUT_METADATA_KEY } from '../documents/mappers';
import { tenantDb } from '../tenancy/tenant-db';
import { resolveDocumentOwner, toResourceScope, type OwnerScope } from '../documents/owners';
import { currentOrganizationId } from '../tenancy/context';
import { interpolateBlocks, toPdfBranding, type PdfBranding, type PdfDocumentModel } from './model';
import { pdfRenderer } from './renderer';
import { pdfTemplate, pdfTemplateVersionExists, type PdfTemplateContext } from './templates';

const LOGO_MIME = new Set(['image/png', 'image/jpeg']);

/** Resolved branding for an owner scope (institution → group → organization). */
export async function brandingForScope(scope: OwnerScope): Promise<ResolvedBrandingDto> {
  const organizationId = currentOrganizationId();
  const target = scope.institutionId
    ? { scopeType: 'INSTITUTION' as const, targetId: scope.institutionId }
    : scope.groupId
      ? { scopeType: 'GROUP' as const, targetId: scope.groupId }
      : { scopeType: 'ORGANIZATION' as const, targetId: organizationId };
  return resolveBranding(organizationId, {
    ...target,
    groupId: scope.groupId,
    institutionId: scope.institutionId,
  });
}

/** Branding for rendering: resolved values + the logo bytes (trusted read through the engine). */
export async function pdfBrandingForScope(scope: OwnerScope): Promise<PdfBranding> {
  const resolved = await brandingForScope(scope);
  let logo: PdfBranding['logo'] = null;
  if (resolved.logoFileId) {
    const current = await documentEngine.readCurrentVersion(resolved.logoFileId);
    if (current && LOGO_MIME.has(current.version.mimeType)) {
      logo = { mimeType: current.version.mimeType, body: current.body };
    }
  }
  return toPdfBranding(resolved, logo);
}

/** Render a registered template to bytes without storing it (previews / module composition). */
export async function renderPdfTemplate(
  templateKey: string,
  data: unknown,
  scope: OwnerScope,
  options: { version?: number; now?: Date } = {},
): Promise<{ model: PdfDocumentModel; body: Buffer; title: string; templateVersion: number }> {
  const template = pdfTemplate(templateKey, options.version);
  const input = parseInput(template.inputSchema, data);
  const branding = await pdfBrandingForScope(scope);
  const now = options.now ?? new Date();
  const ctx: PdfTemplateContext = { branding, now, today: now.toISOString().slice(0, 10) };
  const vars = { ...(input as Record<string, unknown>), branding, today: ctx.today };
  const title = template.title(input, ctx);
  const model: PdfDocumentModel = {
    title,
    author: branding.displayName,
    branding,
    blocks: interpolateBlocks(template.build(input, ctx), vars),
  };
  return {
    model,
    body: await pdfRenderer().render(model),
    title,
    templateVersion: template.version,
  };
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'document';

/**
 * Generate a PDF from a template and store it as a document of the given owner. Requires
 * `pdf.generate` AND `document.upload` in the owner's scope (plus confidential access when
 * applicable — enforced by the document engine).
 */
export async function generatePdf(raw: unknown): Promise<DocumentDto> {
  const input = parseInput(generatePdfSchema, raw);
  const principal = currentPrincipal();
  const template = pdfTemplate(input.templateKey);
  const owner = await resolveDocumentOwner(input.ownerType, input.ownerId);
  await authorize(principal, 'pdf.generate', toResourceScope(owner.scope));
  const rendered = await renderPdfTemplate(template.key, input.data, owner.scope, {
    version: template.version,
  });
  const title = input.title ?? rendered.title;
  const data = parseInput(template.inputSchema, input.data);
  return documentEngine.attach({
    ownerType: owner.ownerType,
    ownerId: owner.ownerId,
    module: 'pdf',
    metadata: {
      title,
      category: input.category ?? template.defaultCategory,
      documentType: input.documentType ?? template.defaultDocumentType,
      ...(input.confidentiality ? { confidentiality: input.confidentiality } : {}),
    },
    file: {
      fileName: input.fileName ?? `${slug(title)}.pdf`,
      mimeType: 'application/pdf',
      body: rendered.body,
    },
    extra: storedPdfMetadata(template.key, rendered, data),
  });
}

type RenderedPdf = Awaited<ReturnType<typeof renderPdfTemplate>>;

/**
 * Document metadata for a stored generated PDF: template provenance, the branding it was
 * rendered with and the (validated) template input, so the file can be re-rendered later —
 * e.g. after the logo changes — without recomputing anything. The input is never exposed in
 * document DTOs (see documents/mappers).
 */
export function storedPdfMetadata(
  templateKey: string,
  rendered: Pick<RenderedPdf, 'templateVersion' | 'model'>,
  input: unknown,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...extra,
    templateKey,
    templateVersion: rendered.templateVersion,
    renderer: pdfRenderer().id,
    branding: {
      displayName: rendered.model.branding.displayName,
      primaryColor: rendered.model.branding.primaryColor,
      logoFileId: rendered.model.branding.logoFileId,
    },
    [PDF_INPUT_METADATA_KEY]: input,
  };
}

export interface RegenerateStoredPdfOptions {
  /**
   * Template input to render. Defaults to the input persisted with the document; modules pass
   * one rebuilt from their authoritative data for documents stored before inputs were kept.
   */
  input?: unknown;
  /**
   * Called only when the document has no persisted input (stored before inputs were kept):
   * rebuild it from the module's authoritative data, or return null to refuse.
   */
  fallbackInput?: () => Promise<unknown>;
  /** Template key for legacy documents whose metadata does not record one. */
  templateKey?: string;
  reason?: string;
  /**
   * `principal` (default): requires `pdf.generate` in the document's scope AND the document
   * engine's `upload_version` right. `caller`: the module already authorized the action.
   */
  authorization?: 'principal' | 'caller';
}

/**
 * Re-render a stored generated PDF with the CURRENT branding (logo, colours, letterhead) and
 * store it as a NEW VERSION of the same document — history, audit trail, grants and download
 * links are preserved. Content comes from the persisted template input (never recalculated).
 */
export async function regenerateStoredPdf(
  documentId: string,
  options: RegenerateStoredPdfOptions = {},
): Promise<{ documentId: string; version: DocumentVersionDto }> {
  const authorization = options.authorization ?? 'principal';
  if (authorization === 'principal') {
    // 404 for invisible documents (no existence leak) before any scope check.
    await documentEngine.get(documentId);
  }
  const doc = await tenantDb().document.findFirst({
    where: { id: documentId },
    include: { currentVersion: true },
  });
  if (!doc) throw new NotFoundError('Document');
  if (doc.deletedAt || doc.status !== 'ACTIVE') {
    throw new AppError(409, 'INVALID_STATE', 'Only active documents can be regenerated');
  }
  const meta = (doc.metadata as Record<string, unknown> | null) ?? {};
  const templateKey =
    typeof meta.templateKey === 'string' ? meta.templateKey : (options.templateKey ?? null);
  if (!templateKey) {
    throw new AppError(
      409,
      'NOT_REGENERATABLE',
      'This document was not generated from a PDF template (e.g. an uploaded file) and cannot be regenerated',
    );
  }
  let input = options.input ?? meta[PDF_INPUT_METADATA_KEY];
  if ((input === undefined || input === null) && options.fallbackInput) {
    input = await options.fallbackInput();
  }
  if (input === undefined || input === null) {
    throw new AppError(
      409,
      'REGENERATE_INPUT_MISSING',
      'This document was generated before its content was stored for regeneration; generate a new one instead',
    );
  }
  const scope = {
    groupId: doc.groupId,
    institutionId: doc.institutionId,
    campusId: doc.campusId,
    departmentId: doc.departmentId,
  };
  if (authorization === 'principal') {
    await authorize(currentPrincipal(), 'pdf.generate', toResourceScope(scope));
  }
  // Keep the recorded template version (its input schema matches the stored input).
  const recorded = typeof meta.templateVersion === 'number' ? meta.templateVersion : undefined;
  const version =
    recorded !== undefined && pdfTemplateVersionExists(templateKey, recorded)
      ? recorded
      : undefined;
  const template = pdfTemplate(templateKey, version);
  const data = parseInput(template.inputSchema, input);
  const rendered = await renderPdfTemplate(templateKey, data, scope, { version: template.version });
  const fileName = doc.currentVersion?.fileName ?? `${slug(doc.title)}.pdf`;
  const created = await documentEngine.addVersion(
    doc.id,
    { fileName, mimeType: 'application/pdf', body: rendered.body },
    {
      reason: options.reason ?? 'Regenerated with the current branding',
      authorization,
    },
  );
  const { [PDF_INPUT_METADATA_KEY]: _previousInput, ...rest } = meta;
  await tenantDb().document.update({
    where: { id: doc.id },
    data: {
      metadata: {
        ...storedPdfMetadata(templateKey, rendered, data, rest),
        regeneratedAt: new Date().toISOString(),
      } as Prisma.InputJsonValue,
    },
  });
  await audit.record({
    action: 'pdf.regenerate',
    entityType: 'document',
    entityId: doc.id,
    metadata: {
      templateKey,
      templateVersion: rendered.templateVersion,
      versionId: created.id,
      versionNumber: created.versionNumber,
      logoFileId: rendered.model.branding.logoFileId,
    },
  });
  return { documentId: doc.id, version: created };
}

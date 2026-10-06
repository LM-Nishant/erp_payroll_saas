import { generatePdfSchema, type DocumentDto, type ResolvedBrandingDto } from '@erp/shared';
import { authorize, currentPrincipal } from '../authz';
import { resolveBranding } from '../branding';
import { parseInput } from '../http/validation';
import { documentEngine } from '../documents/service';
import { resolveDocumentOwner, toResourceScope, type OwnerScope } from '../documents/owners';
import { currentOrganizationId } from '../tenancy/context';
import { interpolateBlocks, toPdfBranding, type PdfBranding, type PdfDocumentModel } from './model';
import { pdfRenderer } from './renderer';
import { pdfTemplate, type PdfTemplateContext } from './templates';

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
    extra: {
      templateKey: template.key,
      templateVersion: rendered.templateVersion,
      renderer: pdfRenderer().id,
      branding: {
        displayName: rendered.model.branding.displayName,
        primaryColor: rendered.model.branding.primaryColor,
        logoFileId: rendered.model.branding.logoFileId,
      },
    },
  });
}

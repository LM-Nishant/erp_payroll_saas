import { type DocumentCategory, type PdfTemplateDto } from '@erp/shared';
import type { ZodType, ZodTypeDef } from 'zod';
import { AppError } from '../http/errors';
import type { PdfBlock, PdfBranding } from './model';

export interface PdfTemplateContext {
  branding: PdfBranding;
  /** Generation timestamp (ISO date `YYYY-MM-DD` in `today`). */
  now: Date;
  today: string;
}

/**
 * A versioned, code-registered PDF template. Bump `version` when the layout changes; generated
 * documents record `templateKey` + `templateVersion` in their metadata.
 */
export interface PdfTemplate<T = unknown> {
  key: string;
  version: number;
  name: string;
  description: string;
  inputSchema: ZodType<T, ZodTypeDef, unknown>;
  defaultCategory: DocumentCategory;
  defaultDocumentType: string;
  /** Default title / file name of the generated document. */
  title(input: T, ctx: PdfTemplateContext): string;
  /**
   * Body blocks. Text may contain `{{ path }}` placeholders resolved against
   * `{ ...input, branding, today }`.
   */
  build(input: T, ctx: PdfTemplateContext): PdfBlock[];
}

const registry = new Map<string, Map<number, PdfTemplate<unknown>>>();

/** Register a template version (modules call this at import time). */
export function registerPdfTemplate<T>(template: PdfTemplate<T>): void {
  const versions = registry.get(template.key) ?? new Map<number, PdfTemplate<unknown>>();
  if (versions.has(template.version)) {
    throw new Error(`PDF template ${template.key}@${template.version} is already registered`);
  }
  versions.set(template.version, template as PdfTemplate<unknown>);
  registry.set(template.key, versions);
}

export function unregisterPdfTemplate(key: string): void {
  registry.delete(key);
}

/** Latest (or a specific) version of a template; 422 UNKNOWN_TEMPLATE when missing. */
export function pdfTemplate(key: string, version?: number): PdfTemplate<unknown> {
  const versions = registry.get(key);
  const v = version ?? Math.max(...(versions ? [...versions.keys()] : [0]));
  const template = versions?.get(v);
  if (!template) {
    throw new AppError(422, 'UNKNOWN_TEMPLATE', `Unknown PDF template "${key}"`, { key, version });
  }
  return template;
}

/** Latest version of every registered template. */
export function pdfTemplates(): PdfTemplateDto[] {
  return [...registry.keys()].sort().map((key) => {
    const t = pdfTemplate(key);
    return {
      key: t.key,
      version: t.version,
      name: t.name,
      description: t.description,
      defaultCategory: t.defaultCategory,
      defaultDocumentType: t.defaultDocumentType,
    };
  });
}

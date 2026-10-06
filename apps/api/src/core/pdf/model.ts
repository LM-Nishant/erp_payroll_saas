import type { ResolvedBrandingDto } from '@erp/shared';

/*
 * Renderer-neutral PDF layout model. Templates produce blocks; the engine wraps them with the
 * resolved branding (letterhead, logo, colours, footer) and hands the model to a PdfRenderer.
 */

export type PdfBlock =
  | { type: 'heading'; text: string; level?: 1 | 2 }
  | {
      type: 'paragraph';
      text: string;
      align?: 'left' | 'right' | 'center' | 'justify';
      bold?: boolean;
    }
  | { type: 'keyValue'; rows: Array<[label: string, value: string]> }
  | { type: 'table'; columns: string[]; rows: string[][] }
  | { type: 'signature'; name?: string | null; designation?: string | null; label?: string | null }
  | { type: 'spacer'; size?: number };

export interface PdfBranding {
  displayName: string | null;
  letterheadText: string | null;
  footerText: string | null;
  address: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  website: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  /** Logo document id (provenance) and its PNG/JPEG bytes when available. */
  logoFileId: string | null;
  logo: { mimeType: string; body: Buffer } | null;
}

export interface PdfDocumentModel {
  title: string;
  author: string | null;
  branding: PdfBranding;
  blocks: PdfBlock[];
}

const FALLBACK = { primaryColor: '#1E3A8A', secondaryColor: '#0EA5E9', accentColor: '#F59E0B' };

export function toPdfBranding(
  resolved: ResolvedBrandingDto,
  logo: PdfBranding['logo'],
): PdfBranding {
  return {
    displayName: resolved.displayName,
    letterheadText: resolved.letterheadText,
    footerText: resolved.footerText,
    address: resolved.address,
    contactEmail: resolved.contactEmail,
    contactPhone: resolved.contactPhone,
    website: resolved.website,
    primaryColor: resolved.primaryColor ?? FALLBACK.primaryColor,
    secondaryColor: resolved.secondaryColor ?? FALLBACK.secondaryColor,
    accentColor: resolved.accentColor ?? FALLBACK.accentColor,
    logoFileId: logo ? resolved.logoFileId : null,
    logo,
  };
}

/**
 * Replace `{{ path }}` placeholders with values from `vars` (dot paths allowed). Missing values
 * render as an empty string. Values are plain text — renderers never interpret markup.
 */
export function interpolate(text: string, vars: Record<string, unknown>): string {
  return text.replace(/\{\{\s*([A-Za-z_][\w.]*)\s*\}\}/g, (_m, path: string) => {
    let cur: unknown = vars;
    for (const part of path.split('.')) {
      if (cur === null || typeof cur !== 'object') return '';
      cur = (cur as Record<string, unknown>)[part];
    }
    return cur === undefined || cur === null ? '' : String(cur);
  });
}

/** Apply interpolation to every text field of the blocks. */
export function interpolateBlocks(blocks: PdfBlock[], vars: Record<string, unknown>): PdfBlock[] {
  const t = (s: string) => interpolate(s, vars);
  const tn = (s: string | null | undefined) => (s == null ? s : t(s));
  return blocks.map((b) => {
    switch (b.type) {
      case 'heading':
      case 'paragraph':
        return { ...b, text: t(b.text) };
      case 'keyValue':
        return { ...b, rows: b.rows.map(([k, v]) => [t(k), t(v)] as [string, string]) };
      case 'table':
        return { ...b, columns: b.columns.map(t), rows: b.rows.map((r) => r.map(t)) };
      case 'signature':
        return { ...b, name: tn(b.name), designation: tn(b.designation), label: tn(b.label) };
      default:
        return b;
    }
  });
}

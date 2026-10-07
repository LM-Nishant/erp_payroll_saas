import type { ResolvedBrandingDto } from '@erp/shared';
import { escapeHtml } from './renderer';

const COLOR = /^#[0-9a-fA-F]{3,8}$/;
const safeColor = (v: string | null | undefined, fallback: string) =>
  v && COLOR.test(v) ? v : fallback;

/** Plain text → minimal HTML paragraphs (escaped). */
export function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/**
 * Branded email layout (table-based for mail clients): header with logo / display name in the
 * tenant's primary color, the content, and a footer with contact details. `contentHtml` must
 * already be safe HTML (rendered with escaping).
 */
export function brandedEmailLayout(input: {
  branding: ResolvedBrandingDto;
  logoUrl: string | null;
  subject: string | null;
  contentHtml: string;
}): string {
  const b = input.branding;
  const primary = safeColor(b.primaryColor, '#1e3a8a');
  const name = escapeHtml(b.displayName ?? '');
  const header = input.logoUrl
    ? `<img src="${escapeHtml(input.logoUrl)}" alt="${name}" style="max-height:48px;display:block">`
    : `<span style="font-size:20px;font-weight:600;color:#ffffff">${name}</span>`;
  const footerParts = [b.footerText, b.address, b.contactEmail, b.contactPhone, b.website]
    .filter((v): v is string => !!v)
    .map(escapeHtml);
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${escapeHtml(input.subject ?? '')}</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 0">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden">
<tr><td style="background:${primary};padding:16px 24px">${header}</td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.5">${input.contentHtml}</td></tr>
<tr><td style="padding:16px 24px;background:#f9fafb;font-size:12px;color:#6b7280">${footerParts.join('<br>')}</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

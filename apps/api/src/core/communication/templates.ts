import type { MessageChannel, RenderedMessageDto } from '@erp/shared';
import { env } from '../config/env';
import { brandingLogoUrl, resolveBranding } from '../branding';
import { logger } from '../logger';
import { resolveSettingTarget, type SettingTarget } from '../settings/target';
import { currentOrganizationId } from '../tenancy/context';
import { tenantDb } from '../tenancy/tenant-db';
import { brandedEmailLayout, textToHtml } from './layout';
import { renderTemplate } from './renderer';

/** Built-in template used when a tenant has not customized `key` for a channel. */
export interface DefaultTemplate {
  key: string;
  channel: MessageChannel;
  name: string;
  subject?: string | null;
  body: string;
  htmlBody?: string | null;
  useBrandedLayout?: boolean;
}

const defaults = new Map<string, DefaultTemplate>();
const defKey = (key: string, channel: MessageChannel) => `${channel}:${key}`;

/** Modules register their default (overridable) templates at import time. */
export function registerDefaultTemplate(t: DefaultTemplate): void {
  defaults.set(defKey(t.key, t.channel), t);
}

export function listDefaultTemplates(): DefaultTemplate[] {
  return [...defaults.values()];
}

export interface ResolvedTemplate {
  source: 'custom' | 'default';
  templateId: string | null;
  key: string;
  channel: MessageChannel;
  version: number | null;
  subject: string | null;
  body: string;
  htmlBody: string | null;
  useBrandedLayout: boolean;
}

/** Hierarchy target for an optional institution (institution → its group → organization). */
export async function targetFor(institutionId?: string | null): Promise<SettingTarget> {
  return institutionId
    ? resolveSettingTarget('INSTITUTION', institutionId)
    : resolveSettingTarget('ORGANIZATION');
}

/**
 * Most specific ACTIVE tenant template for `key`/`channel` (institution → group →
 * organization), else the registered default; null when neither exists.
 */
export async function resolveTemplate(
  key: string,
  channel: MessageChannel,
  target: SettingTarget,
): Promise<ResolvedTemplate | null> {
  const candidates = [
    target.institutionId
      ? { scopeType: 'INSTITUTION' as const, targetId: target.institutionId }
      : null,
    target.groupId ? { scopeType: 'GROUP' as const, targetId: target.groupId } : null,
    { scopeType: 'ORGANIZATION' as const, targetId: currentOrganizationId() },
  ].filter((c): c is NonNullable<typeof c> => !!c);
  const rows = await tenantDb().messageTemplate.findMany({
    where: { key, channel, isActive: true, OR: candidates },
  });
  const row = candidates
    .map((c) => rows.find((r) => r.scopeType === c.scopeType && r.targetId === c.targetId))
    .find(Boolean);
  if (row) {
    const version = await tenantDb().messageTemplateVersion.findFirst({
      where: { templateId: row.id, version: row.currentVersion },
    });
    if (version) {
      return {
        source: 'custom',
        templateId: row.id,
        key,
        channel,
        version: version.version,
        subject: version.subject,
        body: version.body,
        htmlBody: version.htmlBody,
        useBrandedLayout: row.useBrandedLayout,
      };
    }
  }
  const d = defaults.get(defKey(key, channel));
  if (!d) return null;
  return {
    source: 'default',
    templateId: null,
    key,
    channel,
    version: null,
    subject: d.subject ?? null,
    body: d.body,
    htmlBody: d.htmlBody ?? null,
    useBrandedLayout: d.useBrandedLayout ?? true,
  };
}

const logoCache = new Map<string, { url: string | null; until: number }>();

/** Branding logo URL for emails, reused while the signed URL has > 60 s left. */
async function emailLogoUrl(target: SettingTarget): Promise<string | null> {
  const key = `${currentOrganizationId()}:${target.scopeType}:${target.targetId}`;
  const cached = logoCache.get(key);
  if (cached && cached.until > Date.now()) return cached.url;
  let url: string | null = null;
  let until = Date.now() + 60_000;
  try {
    const signed = await brandingLogoUrl(target);
    url = signed?.url ?? null;
    if (signed) until = new Date(signed.expiresAt).getTime() - 60_000;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Branding logo unavailable for email');
  }
  logoCache.set(key, { url, until });
  return url;
}

export interface RenderInput {
  channel: MessageChannel;
  subject: string | null;
  body: string;
  htmlBody?: string | null;
  useBrandedLayout?: boolean;
  variables: Record<string, unknown>;
  target: SettingTarget;
}

/**
 * Render a message. Variables also expose `branding.*` (resolved branding of the target) and
 * `app.url`. Email HTML is wrapped in the branded layout (logo + colors + footer) unless
 * `useBrandedLayout` is false.
 */
export async function renderMessage(input: RenderInput): Promise<RenderedMessageDto> {
  const branding = await resolveBranding(currentOrganizationId(), input.target);
  const vars = {
    ...input.variables,
    branding,
    app: { url: env.APP_PUBLIC_URL },
  };
  const subject = input.subject ? renderTemplate(input.subject, vars).trim() : null;
  const text = renderTemplate(input.body, vars);
  if (input.channel !== 'email') return { channel: input.channel, subject: null, text, html: null };
  const content = input.htmlBody
    ? renderTemplate(input.htmlBody, vars, { html: true })
    : textToHtml(text);
  const html =
    input.useBrandedLayout === false
      ? content
      : brandedEmailLayout({
          branding,
          logoUrl: await emailLogoUrl(input.target),
          subject,
          contentHtml: content,
        });
  return { channel: input.channel, subject, text, html };
}

/* Built-in defaults used by the core engines. */
registerDefaultTemplate({
  key: 'notification.generic',
  channel: 'email',
  name: 'Generic notification',
  subject: '{{title}}',
  body: '{{#if recipient.name}}Hello {{recipient.name}},\n\n{{/if}}{{body}}{{#if link}}\n\n{{link}}{{/if}}',
});
registerDefaultTemplate({
  key: 'notification.generic',
  channel: 'sms',
  name: 'Generic notification',
  body: '{{title}}{{#if body}}: {{body}}{{/if}}',
});
registerDefaultTemplate({
  key: 'notification.generic',
  channel: 'whatsapp',
  name: 'Generic notification',
  body: '*{{title}}*{{#if body}}\n{{body}}{{/if}}{{#if link}}\n{{link}}{{/if}}',
});
registerDefaultTemplate({
  key: 'auth.invite',
  channel: 'email',
  name: 'User invitation',
  subject: 'You are invited to {{branding.displayName}}',
  body:
    'Hello {{recipient.name}},\n\nYou have been invited to {{branding.displayName}}. ' +
    'Accept the invitation and set your password here (valid until {{expiresAt}}):\n\n' +
    '{{link}}\n\nIf you were not expecting this, ignore this email.',
});
registerDefaultTemplate({
  key: 'auth.password_reset',
  channel: 'email',
  name: 'Password reset',
  subject: 'Reset your {{branding.displayName}} password',
  body:
    'Hello {{recipient.name}},\n\nA password reset was requested for your account. ' +
    'Set a new password here (valid until {{expiresAt}}):\n\n{{link}}\n\n' +
    'If you did not request this, contact your administrator.',
});

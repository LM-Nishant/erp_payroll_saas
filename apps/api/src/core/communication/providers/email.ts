import nodemailer, { type Transporter } from 'nodemailer';
import { outboundRequest } from '../../http/outbound';
import {
  ProviderError,
  type OutboundMessage,
  type ProviderAdapter,
  type ProviderContext,
} from './types';

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

function fromAddress(message: OutboundMessage, ctx: ProviderContext): string {
  const from = message.from ?? str(ctx.config.from);
  if (!from) throw new ProviderError('Provider config "from" is required', false);
  const fromName = str(ctx.config.fromName);
  return fromName ? `"${fromName.replace(/"/g, '')}" <${from}>` : from;
}

async function sendViaTransport(transport: Transporter, message: OutboundMessage, from: string) {
  try {
    const info = await transport.sendMail({
      from,
      to: message.toName ? { name: message.toName, address: message.to } : message.to,
      subject: message.subject ?? '',
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
      headers: { 'X-Erp-Message-Id': message.logId },
    });
    if (info.rejected?.length) throw new ProviderError('Recipient rejected', false);
    return { providerMessageId: info.messageId ?? null };
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    const code = (err as { responseCode?: number }).responseCode;
    // 5xx SMTP replies are permanent; everything else (network, 4xx) is retried.
    throw new ProviderError((err as Error).message, !(code && code >= 500 && code < 600));
  }
}

/**
 * SMTP (nodemailer). Config: host, port, secure, user, from, fromName.
 * Credentials: the SMTP password.
 */
export const smtpProvider: ProviderAdapter = {
  type: 'smtp',
  channels: ['email'],
  async send(message, ctx) {
    const host = str(ctx.config.host);
    if (!host) throw new ProviderError('Provider config "host" is required', false);
    const port = Number(ctx.config.port ?? 587);
    const transport = nodemailer.createTransport({
      host,
      port,
      secure: ctx.config.secure === true || port === 465,
      auth: str(ctx.config.user)
        ? { user: str(ctx.config.user)!, pass: ctx.credentials ?? '' }
        : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    try {
      return await sendViaTransport(transport, message, fromAddress(message, ctx));
    } finally {
      transport.close();
    }
  },
};

/**
 * Amazon SES through its SMTP interface (no AWS SDK dependency). Config: region, user (SMTP
 * username), from. Credentials: the SES SMTP password.
 */
export const sesProvider: ProviderAdapter = {
  type: 'ses',
  channels: ['email'],
  async send(message, ctx) {
    const region = str(ctx.config.region) ?? 'us-east-1';
    return smtpProvider.send(message, {
      ...ctx,
      config: { ...ctx.config, host: `email-smtp.${region}.amazonaws.com`, port: 587 },
    });
  },
};

/** SendGrid v3 HTTP API. Config: from, fromName. Credentials: API key. */
export const sendgridProvider: ProviderAdapter = {
  type: 'sendgrid',
  channels: ['email'],
  async send(message, ctx) {
    if (!ctx.credentials) throw new ProviderError('SendGrid API key is not configured', false);
    const from = message.from ?? str(ctx.config.from);
    if (!from) throw new ProviderError('Provider config "from" is required', false);
    const res = await outboundRequest({
      method: 'POST',
      url: 'https://api.sendgrid.com/v3/mail/send',
      headers: { authorization: `Bearer ${ctx.credentials}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: message.to, name: message.toName ?? undefined }] }],
        from: { email: from, name: str(ctx.config.fromName) },
        subject: message.subject ?? '',
        content: [
          { type: 'text/plain', value: message.text },
          ...(message.html ? [{ type: 'text/html', value: message.html }] : []),
        ],
        custom_args: { erp_message_id: message.logId },
      }),
    });
    if (res.status >= 300) {
      throw new ProviderError(
        `SendGrid HTTP ${res.status}`,
        res.status === 429 || res.status >= 500,
      );
    }
    return { providerMessageId: res.headers['x-message-id'] ?? null };
  },
};

let platformTransport: Transporter | null = null;

/** Platform fallback mailer (MAIL_DRIVER=smtp + SMTP_URL) for orgs without an email provider. */
export function platformSmtpProvider(smtpUrl: string, from: string): ProviderAdapter {
  return {
    type: 'smtp',
    channels: ['email'],
    async send(message) {
      platformTransport ??= nodemailer.createTransport(smtpUrl);
      return sendViaTransport(platformTransport, message, message.from ?? from);
    },
  };
}

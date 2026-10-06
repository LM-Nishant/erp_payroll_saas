import { createHmac, timingSafeEqual } from 'node:crypto';
import { assertSafeOutboundUrl, outboundRequest } from '../../http/outbound';
import {
  ProviderError,
  type DeliveryUpdate,
  type OutboundMessage,
  type ProviderAdapter,
  type ProviderContext,
} from './types';

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

function httpFailure(name: string, status: number): never {
  throw new ProviderError(`${name} HTTP ${status}`, status === 429 || status >= 500);
}

function parseJson(body: string): Record<string, unknown> {
  try {
    const v = JSON.parse(body) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function sender(message: OutboundMessage, ctx: ProviderContext): string {
  const from = message.from ?? str(ctx.config.from) ?? str(ctx.config.senderId);
  if (!from) throw new ProviderError('Provider config "from" is required', false);
  return from;
}

const TWILIO_STATUS: Record<string, DeliveryUpdate['status'] | undefined> = {
  sent: 'SENT',
  delivered: 'DELIVERED',
  read: 'DELIVERED',
  failed: 'FAILED',
  undelivered: 'FAILED',
};

/** Twilio request signature: base64(HMAC-SHA1(authToken, url + sorted key/value pairs)). */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>) {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  return createHmac('sha1', authToken).update(data).digest('base64');
}

/**
 * Twilio Programmable Messaging (SMS; WhatsApp senders use the `whatsapp:` prefix).
 * Config: accountSid, from (or messagingServiceSid). Credentials: auth token.
 * Native delivery callbacks (StatusCallback) are verified with X-Twilio-Signature.
 */
export const twilioProvider: ProviderAdapter = {
  type: 'twilio',
  channels: ['sms'],
  async send(message, ctx) {
    const sid = str(ctx.config.accountSid);
    if (!sid || !ctx.credentials)
      throw new ProviderError('Twilio accountSid / auth token missing', false);
    const form = new URLSearchParams({ To: message.to, Body: message.text });
    const service = str(ctx.config.messagingServiceSid);
    if (service) form.set('MessagingServiceSid', service);
    else form.set('From', sender(message, ctx));
    if (str(ctx.config.statusCallbackUrl))
      form.set('StatusCallback', str(ctx.config.statusCallbackUrl)!);
    const res = await outboundRequest({
      method: 'POST',
      url: `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
      headers: {
        authorization: `Basic ${Buffer.from(`${sid}:${ctx.credentials}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    if (res.status >= 300) httpFailure('Twilio', res.status);
    const json = parseJson(res.body);
    const price = json.price ? Math.abs(Number(json.price)) : null;
    return {
      providerMessageId: str(json.sid) ?? null,
      cost: Number.isFinite(price) ? price : null,
    };
  },
  parseNativeCallback(req, ctx) {
    const header = req.headers['x-twilio-signature'];
    if (typeof header !== 'string') return null;
    if (!ctx.credentials) throw new ProviderError('Twilio auth token missing', false);
    const params = Object.fromEntries(
      Object.entries((req.body ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
    );
    const expected = Buffer.from(twilioSignature(ctx.credentials, req.url, params));
    const given = Buffer.from(header);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      throw new ProviderError('Invalid Twilio signature', false);
    }
    const status = TWILIO_STATUS[params.MessageStatus ?? ''];
    if (!params.MessageSid || !status) return [];
    return [
      {
        providerMessageId: params.MessageSid,
        status,
        rawStatus: params.MessageStatus!,
        error: params.ErrorCode ? `Twilio error ${params.ErrorCode}` : null,
      },
    ];
  },
};

/**
 * MSG91 (India) transactional SMS. Config: senderId, route (default 4), country (default 91),
 * dltTemplateId. Credentials: authkey.
 */
export const msg91Provider: ProviderAdapter = {
  type: 'msg91',
  channels: ['sms'],
  async send(message, ctx) {
    if (!ctx.credentials) throw new ProviderError('MSG91 authkey missing', false);
    const res = await outboundRequest({
      method: 'POST',
      url: 'https://api.msg91.com/api/v2/sendsms',
      headers: { authkey: ctx.credentials, 'content-type': 'application/json' },
      body: JSON.stringify({
        sender: sender(message, ctx),
        route: String(ctx.config.route ?? '4'),
        country: String(ctx.config.country ?? '91'),
        DLT_TE_ID: str(ctx.config.dltTemplateId),
        sms: [{ message: message.text, to: [message.to.replace(/^\+/, '')] }],
      }),
    });
    if (res.status >= 300) httpFailure('MSG91', res.status);
    const json = parseJson(res.body);
    if (json.type && json.type !== 'success') {
      throw new ProviderError(`MSG91: ${String(json.message ?? 'error')}`, false);
    }
    return { providerMessageId: str(json.message) ?? null };
  },
};

/**
 * Generic HTTP SMS gateway: POST JSON `{ to, from, text, reference }` to `config.url` with
 * `Authorization: Bearer <credentials>`; the provider message id is read from
 * `config.messageIdField` (default `id`) of the JSON response.
 */
export const httpSmsProvider: ProviderAdapter = {
  type: 'http',
  channels: ['sms'],
  async send(message, ctx) {
    const url = str(ctx.config.url);
    if (!url) throw new ProviderError('Provider config "url" is required', false);
    assertSafeOutboundUrl(url);
    const res = await outboundRequest({
      method: 'POST',
      url,
      headers: {
        'content-type': 'application/json',
        ...(ctx.credentials ? { authorization: `Bearer ${ctx.credentials}` } : {}),
      },
      body: JSON.stringify({
        to: message.to,
        from: message.from ?? str(ctx.config.from) ?? null,
        text: message.text,
        reference: message.logId,
      }),
    });
    if (res.status >= 300) httpFailure('SMS gateway', res.status);
    const id = parseJson(res.body)[str(ctx.config.messageIdField) ?? 'id'];
    return { providerMessageId: id === undefined || id === null ? null : String(id) };
  },
};

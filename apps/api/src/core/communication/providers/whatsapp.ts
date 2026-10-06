import { outboundRequest } from '../../http/outbound';
import { ProviderError, type ProviderAdapter } from './types';

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

/**
 * WhatsApp Business Cloud API (Meta Graph). Config: phoneNumberId, apiVersion (default v20.0),
 * optional templateName / templateLanguage (business-initiated messages must use an approved
 * template; the rendered text is passed as the single body parameter). Credentials: access token.
 */
export const whatsappCloudProvider: ProviderAdapter = {
  type: 'whatsapp_cloud',
  channels: ['whatsapp'],
  async send(message, ctx) {
    const phoneNumberId = str(ctx.config.phoneNumberId);
    if (!phoneNumberId || !ctx.credentials) {
      throw new ProviderError('WhatsApp phoneNumberId / access token missing', false);
    }
    const version = str(ctx.config.apiVersion) ?? 'v20.0';
    const templateName = str(ctx.config.templateName);
    const payload = templateName
      ? {
          type: 'template',
          template: {
            name: templateName,
            language: { code: str(ctx.config.templateLanguage) ?? 'en' },
            components: [{ type: 'body', parameters: [{ type: 'text', text: message.text }] }],
          },
        }
      : { type: 'text', text: { body: message.text, preview_url: false } };
    const res = await outboundRequest({
      method: 'POST',
      url: `https://graph.facebook.com/${version}/${encodeURIComponent(phoneNumberId)}/messages`,
      headers: {
        authorization: `Bearer ${ctx.credentials}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: message.to.replace(/^\+/, ''),
        biz_opaque_callback_data: message.logId,
        ...payload,
      }),
    });
    if (res.status >= 300) {
      throw new ProviderError(
        `WhatsApp HTTP ${res.status}`,
        res.status === 429 || res.status >= 500,
      );
    }
    let id: string | undefined;
    try {
      id = (JSON.parse(res.body) as { messages?: Array<{ id?: string }> }).messages?.[0]?.id;
    } catch {
      id = undefined;
    }
    return { providerMessageId: id ?? null };
  },
};

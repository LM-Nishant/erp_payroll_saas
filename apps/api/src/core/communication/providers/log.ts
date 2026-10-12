import { randomUUID } from 'node:crypto';
import type { ProviderAdapter } from './types';

export interface OutboxEntry {
  organizationId: string;
  logId: string;
  channel: string;
  providerId: string | null;
  providerMessageId: string;
  to: string;
  from: string | null;
  subject: string | null;
  text: string;
  html: string | null;
  sentAt: Date;
}

/**
 * Development / test "provider": records messages in an in-memory outbox instead of sending.
 * Tests read delivered invites, resets and notifications from `messageOutbox`.
 */
export const messageOutbox: OutboxEntry[] = [];

export function clearOutbox(): void {
  messageOutbox.length = 0;
}

const MAX_OUTBOX = 5000;

function configFrom(config: Record<string, unknown> | null | undefined): string | null {
  for (const key of ['from', 'senderId', 'businessNumber'] as const) {
    const v = config?.[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

export const logProvider: ProviderAdapter = {
  type: 'log',
  channels: ['email', 'sms', 'whatsapp'],
  async send(message, ctx) {
    const providerMessageId = `log_${randomUUID()}`;
    messageOutbox.push({
      organizationId: message.organizationId,
      logId: message.logId,
      channel: message.channel,
      providerId: ctx.providerId,
      providerMessageId,
      to: message.to,
      // Shows which sender (institution / group / organization) the message would go out as.
      from: message.from ?? configFrom(ctx.config) ?? null,
      subject: message.subject ?? null,
      text: message.text,
      html: message.html ?? null,
      sentAt: new Date(),
    });
    if (messageOutbox.length > MAX_OUTBOX)
      messageOutbox.splice(0, messageOutbox.length - MAX_OUTBOX);
    return { providerMessageId, status: 'SENT' };
  },
};

import type { MessageChannel, ProviderType } from '@erp/shared';

export interface OutboundMessage {
  /** message_logs id (also sent to providers as a reference where supported). */
  logId: string;
  organizationId: string;
  channel: MessageChannel;
  to: string;
  toName?: string | null;
  from?: string | null;
  subject?: string | null;
  text: string;
  html?: string | null;
}

export interface ProviderContext {
  providerId: string | null;
  config: Record<string, string | number | boolean>;
  /** Decrypted credential (password / API key / auth token); null when none is configured. */
  credentials: string | null;
}

export interface SendResult {
  providerMessageId: string | null;
  /** Some providers confirm delivery synchronously (e.g. the log outbox). */
  status?: 'SENT' | 'DELIVERED';
  cost?: number | null;
}

/** Normalized delivery callback. */
export interface DeliveryUpdate {
  providerMessageId: string;
  status: 'SENT' | 'DELIVERED' | 'FAILED' | 'BOUNCED';
  rawStatus: string;
  cost?: number | null;
  error?: string | null;
  occurredAt?: Date;
}

export interface CallbackRequest {
  rawBody: Buffer;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
  /** Full public URL the provider called (Twilio signs it). */
  url: string;
}

export interface ProviderAdapter {
  type: ProviderType;
  channels: readonly MessageChannel[];
  send(message: OutboundMessage, ctx: ProviderContext): Promise<SendResult>;
  /**
   * Provider-native signed callback (e.g. Twilio's X-Twilio-Signature). Return null when the
   * request is not in this provider's native format (the generic ERP-signed format is tried).
   * Throw when the native signature is present but invalid.
   */
  parseNativeCallback?(req: CallbackRequest, ctx: ProviderContext): DeliveryUpdate[] | null;
}

/** Retryable provider error (rate limit, 5xx, network). */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable = true,
  ) {
    super(message);
  }
}

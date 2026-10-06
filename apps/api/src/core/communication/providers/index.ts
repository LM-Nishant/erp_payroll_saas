import type { ProviderType } from '@erp/shared';
import { sendgridProvider, sesProvider, smtpProvider } from './email';
import { logProvider } from './log';
import { httpSmsProvider, msg91Provider, twilioProvider } from './sms';
import type { ProviderAdapter } from './types';
import { whatsappCloudProvider } from './whatsapp';

export * from './types';
export { clearOutbox, messageOutbox, type OutboxEntry } from './log';
export { platformSmtpProvider } from './email';
export { twilioSignature } from './sms';

const adapters = new Map<ProviderType, ProviderAdapter>(
  [
    logProvider,
    smtpProvider,
    sesProvider,
    sendgridProvider,
    twilioProvider,
    msg91Provider,
    httpSmsProvider,
    whatsappCloudProvider,
  ].map((a) => [a.type, a]),
);

export function providerAdapter(type: string): ProviderAdapter | undefined {
  return adapters.get(type as ProviderType);
}

/** Replace an adapter (tests: simulate provider failures). Returns a restore function. */
export function overrideProviderAdapter(type: ProviderType, adapter: ProviderAdapter): () => void {
  const previous = adapters.get(type);
  adapters.set(type, adapter);
  return () => {
    if (previous) adapters.set(type, previous);
  };
}

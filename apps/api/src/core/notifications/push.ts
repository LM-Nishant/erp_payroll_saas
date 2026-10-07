/**
 * Push notification channel (mobile). Real FCM / APNs adapters plug in through
 * `registerPushProvider`; the default stub records pushes in an in-memory outbox (dev/tests).
 */
export interface PushMessage {
  token: string;
  title: string;
  body: string | null;
  data: Record<string, string>;
}

export interface PushProvider {
  platform: 'fcm' | 'apns';
  send(message: PushMessage): Promise<{ ok: boolean; invalidToken?: boolean; error?: string }>;
}

export const pushOutbox: Array<PushMessage & { platform: string }> = [];

function stub(platform: 'fcm' | 'apns'): PushProvider {
  return {
    platform,
    async send(message) {
      pushOutbox.push({ ...message, platform });
      if (pushOutbox.length > 500) pushOutbox.shift();
      return { ok: true };
    },
  };
}

const providers = new Map<string, PushProvider>([
  ['fcm', stub('fcm')],
  ['apns', stub('apns')],
]);

export function registerPushProvider(provider: PushProvider): void {
  providers.set(provider.platform, provider);
}

export function pushProvider(platform: string): PushProvider | undefined {
  return providers.get(platform);
}

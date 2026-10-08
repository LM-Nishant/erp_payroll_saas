import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { env } from '../../core/config/env';
import { getIntegrationCredential } from '../../core/integrations';

/*
 * Pluggable online payment gateway (Razorpay-style: server creates an order, the hosted
 * checkout returns {orderId, paymentId, signature}, the server verifies the signature and also
 * accepts signed webhooks). Credentials come only from getIntegrationCredential.
 */

export interface GatewayOrder {
  providerOrderId: string;
  amount: number;
  currency: string;
  /** Extra values for the client checkout widget (key id, hosted url…). */
  checkout: Record<string, unknown>;
}

export interface GatewayWebhookEvent {
  type: 'payment.captured' | 'payment.failed' | string;
  providerOrderId: string;
  providerPaymentId: string | null;
  reason?: string | null;
}

export interface PaymentGateway {
  readonly provider: string;
  createOrder(input: {
    amount: number;
    currency: string;
    receipt: string;
    notes: Record<string, string>;
  }): Promise<GatewayOrder>;
  /** Verifies the checkout callback signature. */
  verifyPayment(input: { providerOrderId: string; paymentId: string; signature: string }): boolean;
  /** Verifies a webhook body signature and parses it. Returns null when invalid. */
  verifyWebhook(
    rawBody: Buffer | string,
    signature: string | undefined,
  ): GatewayWebhookEvent | null;
  /** Test helper: the signature the hosted page would produce (mock gateway only). */
  simulate?(providerOrderId: string): { paymentId: string; signature: string };
}

const hmac = (secret: string, data: string | Buffer) =>
  createHmac('sha256', secret).update(data).digest('hex');

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

const DEV_MOCK_SECRET = 'dev-only-mock-gateway-secret';

/** Mock / test gateway: HMAC-SHA256 signatures exactly like Razorpay's, no network calls. */
export class MockGateway implements PaymentGateway {
  readonly provider = 'mock';
  constructor(private readonly secret: string) {}

  async createOrder(input: { amount: number; currency: string; receipt: string }) {
    return {
      providerOrderId: `order_mock_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      amount: input.amount,
      currency: input.currency,
      checkout: { mode: 'test', receipt: input.receipt },
    };
  }

  verifyPayment(input: { providerOrderId: string; paymentId: string; signature: string }) {
    return safeEqual(
      hmac(this.secret, `${input.providerOrderId}|${input.paymentId}`),
      input.signature,
    );
  }

  verifyWebhook(rawBody: Buffer | string, signature: string | undefined) {
    if (!signature || !safeEqual(hmac(this.secret, rawBody), signature)) return null;
    try {
      const body = JSON.parse(rawBody.toString()) as {
        event?: string;
        orderId?: string;
        paymentId?: string;
        reason?: string;
      };
      if (!body.event || !body.orderId) return null;
      return {
        type: body.event,
        providerOrderId: body.orderId,
        providerPaymentId: body.paymentId ?? null,
        reason: body.reason ?? null,
      };
    } catch {
      return null;
    }
  }

  simulate(providerOrderId: string) {
    const paymentId = `pay_mock_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    return { paymentId, signature: hmac(this.secret, `${providerOrderId}|${paymentId}`) };
  }

  /** Signs a webhook body (tests / demo tooling). */
  signWebhook(body: string): string {
    return hmac(this.secret, body);
  }
}

type GatewayFactory = (secret: string, config: Record<string, unknown>) => PaymentGateway;
const factories = new Map<string, GatewayFactory>([['mock', (secret) => new MockGateway(secret)]]);

/** Registers a real provider (e.g. razorpay) implementation. */
export function registerPaymentGateway(provider: string, factory: GatewayFactory): void {
  factories.set(provider, factory);
}

const PURPOSE = 'fees.online_payment';

/**
 * Resolves the gateway for an institution: an active integration credential of a registered
 * provider (institution → group → organization), else the mock gateway with a dev secret
 * outside production. Returns null when online payment is not configured.
 */
export async function resolveGateway(institutionId: string): Promise<PaymentGateway | null> {
  for (const provider of [...factories.keys()].filter((k) => k !== 'mock')) {
    const cred = await getIntegrationCredential({ provider, institutionId, purpose: PURPOSE });
    if (cred) return factories.get(provider)!(cred.secret.reveal(), cred.config);
  }
  return resolveProviderGateway('mock', institutionId);
}

export async function resolveProviderGateway(
  provider: string,
  institutionId: string | null,
): Promise<PaymentGateway | null> {
  const factory = factories.get(provider);
  if (!factory) return null;
  const credProvider = provider === 'mock' ? 'mock_gateway' : provider;
  const cred = await getIntegrationCredential({
    provider: credProvider,
    institutionId,
    purpose: PURPOSE,
  });
  if (cred) return factory(cred.secret.reveal(), cred.config);
  if (provider === 'mock' && env.NODE_ENV !== 'production') return factory(DEV_MOCK_SECRET, {});
  return null;
}

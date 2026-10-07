import { isIP } from 'node:net';
import { env } from '../config/env';
import { ValidationError } from './errors';

/*
 * Outbound HTTP for provider adapters and webhooks. Injectable so tests can capture / fail
 * requests without network access: `setOutboundTransport(fake)` / `resetOutboundTransport()`.
 */

export interface OutboundRequest {
  method: 'GET' | 'POST' | 'PUT';
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface OutboundResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export type OutboundTransport = (req: OutboundRequest) => Promise<OutboundResponse>;

const fetchTransport: OutboundTransport = async (req) => {
  const res = await fetch(req.url, {
    method: req.method,
    headers: req.headers,
    body: req.body,
    redirect: 'manual',
    signal: AbortSignal.timeout(req.timeoutMs ?? env.OUTBOUND_HTTP_TIMEOUT_MS),
  });
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    headers[k] = v;
  });
  // Cap the stored response body; callers only need a short diagnostic.
  const body = (await res.text()).slice(0, 64 * 1024);
  return { status: res.status, headers, body };
};

let transport: OutboundTransport = fetchTransport;

export function setOutboundTransport(fake: OutboundTransport): void {
  transport = fake;
}

export function resetOutboundTransport(): void {
  transport = fetchTransport;
}

export function outboundRequest(req: OutboundRequest): Promise<OutboundResponse> {
  return transport(req);
}

function isPrivateAddress(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal')) return true;
  const kind = isIP(h);
  if (kind === 4) {
    const [a, b] = h.split('.').map(Number) as [number, number];
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (kind === 6) {
    return (
      h === '::1' || h === '::' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')
    );
  }
  return false;
}

/**
 * Validate a tenant-supplied callback URL (webhooks, generic HTTP providers): HTTPS only and no
 * loopback / private / link-local literal hosts, unless WEBHOOK_ALLOW_INSECURE (dev/test only;
 * refused in production by env validation).
 */
export function assertSafeOutboundUrl(raw: string, field = 'url'): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ValidationError('Invalid URL', { field });
  }
  if (url.username || url.password) {
    throw new ValidationError('Credentials in URLs are not allowed', { field });
  }
  if (env.WEBHOOK_ALLOW_INSECURE) {
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new ValidationError('URL must use http(s)', { field });
    }
    return url;
  }
  if (url.protocol !== 'https:') throw new ValidationError('URL must use https', { field });
  if (isPrivateAddress(url.hostname)) {
    throw new ValidationError('URL must not target a private or loopback address', { field });
  }
  return url;
}

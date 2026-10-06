import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { env, parseMasterKeys } from '../config/env';

/**
 * Wraps / unwraps per-secret DATA keys with a MASTER key (envelope encryption). Implementations:
 * `LocalKeyProvider` (master keys from env) for dev / self-hosted; a cloud KMS provider
 * (AWS KMS, GCP KMS, Azure Key Vault, Vault Transit) implements the same interface.
 *
 * `aad` (additional authenticated data) binds a wrapped key to its owner (tenant + secret id), so
 * a wrapped key copied onto another row / tenant fails to unwrap.
 */
export interface KeyProvider {
  /** Stored on each secret (`key_provider`) so mixed providers can be migrated. */
  readonly id: string;
  /** Master key version used for NEW wraps. */
  readonly activeVersion: number;
  /** Master key versions this provider can still unwrap. */
  readonly versions: readonly number[];
  wrapKey(dataKey: Buffer, aad: string): Promise<{ wrappedKey: string; keyVersion: number }>;
  unwrapKey(wrappedKey: string, keyVersion: number, aad: string): Promise<Buffer>;
  /**
   * Keyed fingerprint of a value (HMAC) for display / equality checks without revealing it.
   * Stable across master key rotation.
   */
  fingerprint(value: string, context: string): string;
}

const b64 = (b: Buffer) => b.toString('base64url');

export class LocalKeyProvider implements KeyProvider {
  readonly id = 'local';
  readonly versions: readonly number[];
  private readonly fingerprintKey: Buffer;

  constructor(
    private readonly keys: ReadonlyMap<number, Buffer>,
    readonly activeVersion: number,
  ) {
    if (!keys.has(activeVersion)) throw new Error(`No master key version ${activeVersion}`);
    this.versions = [...keys.keys()].sort((a, b) => a - b);
    // Derived from the OLDEST key so fingerprints survive adding new master key versions.
    const oldest = keys.get(this.versions[0]!)!;
    this.fingerprintKey = Buffer.from(
      hkdfSync('sha256', oldest, Buffer.alloc(0), 'erp-secret-fingerprint', 32),
    );
  }

  async wrapKey(dataKey: Buffer, aad: string) {
    const keyVersion = this.activeVersion;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.keys.get(keyVersion)!, iv);
    cipher.setAAD(Buffer.from(`wrap:v${keyVersion}:${aad}`));
    const data = Buffer.concat([cipher.update(dataKey), cipher.final()]);
    return {
      wrappedKey: ['w1', iv, cipher.getAuthTag(), data]
        .map((p) => (typeof p === 'string' ? p : b64(p)))
        .join('.'),
      keyVersion,
    };
  }

  async unwrapKey(wrappedKey: string, keyVersion: number, aad: string) {
    const key = this.keys.get(keyVersion);
    if (!key) throw new Error(`Master key version ${keyVersion} is not configured`);
    const [format, iv, tag, data] = wrappedKey.split('.');
    if (format !== 'w1' || !iv || !tag || data === undefined) throw new Error('Bad wrapped key');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(`wrap:v${keyVersion}:${aad}`));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]);
  }

  fingerprint(value: string, context: string): string {
    return createHmac('sha256', this.fingerprintKey)
      .update(`${context}\u0000${value}`)
      .digest('hex')
      .slice(0, 16);
  }
}

let provider: KeyProvider | null = null;

/** The configured key provider (env `SECRETS_KEY_PROVIDER`). */
export function keyProvider(): KeyProvider {
  provider ??= new LocalKeyProvider(
    parseMasterKeys(env.SECRETS_MASTER_KEYS),
    env.SECRETS_ACTIVE_KEY_VERSION,
  );
  return provider;
}

/** Swap the provider (tests, or a KMS provider registered at boot). */
export function setKeyProvider(next: KeyProvider | null): void {
  provider = next;
}

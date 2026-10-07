import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { KeyProvider } from './key-provider';

/**
 * Envelope encryption of one secret value:
 *  1. a fresh random 256-bit DATA key encrypts the value (AES-256-GCM),
 *  2. the data key is wrapped by the provider's active MASTER key.
 * Both layers use `${organizationId}:${secretId}` as AAD so ciphertexts cannot be moved
 * between rows or tenants.
 */
export interface SealedSecret {
  ciphertext: string;
  wrappedKey: string;
  keyVersion: number;
  keyProvider: string;
}

export interface SecretBinding {
  organizationId: string;
  secretId: string;
}

const aadOf = (b: SecretBinding) => `${b.organizationId}:${b.secretId}`;

export async function sealSecret(
  provider: KeyProvider,
  binding: SecretBinding,
  plaintext: string,
): Promise<SealedSecret> {
  const dataKey = randomBytes(32);
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', dataKey, iv);
    cipher.setAAD(Buffer.from(`value:${aadOf(binding)}`));
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const ciphertext = ['s1', iv, cipher.getAuthTag(), data]
      .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
      .join('.');
    const { wrappedKey, keyVersion } = await provider.wrapKey(dataKey, aadOf(binding));
    return { ciphertext, wrappedKey, keyVersion, keyProvider: provider.id };
  } finally {
    dataKey.fill(0);
  }
}

export async function openSecret(
  provider: KeyProvider,
  binding: SecretBinding,
  sealed: Pick<SealedSecret, 'ciphertext' | 'wrappedKey' | 'keyVersion'>,
): Promise<string> {
  const dataKey = await provider.unwrapKey(sealed.wrappedKey, sealed.keyVersion, aadOf(binding));
  try {
    const [format, iv, tag, data] = sealed.ciphertext.split('.');
    if (format !== 's1' || !iv || !tag || data === undefined) throw new Error('Bad ciphertext');
    const decipher = createDecipheriv('aes-256-gcm', dataKey, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(`value:${aadOf(binding)}`));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } finally {
    dataKey.fill(0);
  }
}

/**
 * Re-wrap the data key under the provider's ACTIVE master key (master key rotation). The value
 * ciphertext is untouched; returns null when already on the active version.
 */
export async function rewrapSecret(
  provider: KeyProvider,
  binding: SecretBinding,
  sealed: Pick<SealedSecret, 'wrappedKey' | 'keyVersion'>,
): Promise<Pick<SealedSecret, 'wrappedKey' | 'keyVersion' | 'keyProvider'> | null> {
  if (sealed.keyVersion === provider.activeVersion) return null;
  const dataKey = await provider.unwrapKey(sealed.wrappedKey, sealed.keyVersion, aadOf(binding));
  try {
    const wrapped = await provider.wrapKey(dataKey, aadOf(binding));
    return { ...wrapped, keyProvider: provider.id };
  } finally {
    dataKey.fill(0);
  }
}

/** Display mask: last 4 characters only for values long enough not to leak them. */
export function maskInfo(plaintext: string): { last4: string | null } {
  return { last4: plaintext.length >= 12 ? plaintext.slice(-4) : null };
}

export function maskedDisplay(last4: string | null): string {
  return `••••••••${last4 ?? ''}`;
}

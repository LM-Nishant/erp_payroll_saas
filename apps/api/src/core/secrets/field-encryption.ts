import { keyProvider } from './key-provider';
import { openSecret, sealSecret } from './envelope';

/**
 * Field-level encryption for sensitive columns on tenant rows (statutory ids, bank details…).
 *
 * The sensitive fields of ONE row are serialised as a JSON object and envelope-encrypted
 * (core/secrets/envelope) with AAD `${organizationId}:${binding}` (e.g. `employee:<id>`), so a
 * ciphertext copied to another row / tenant fails to decrypt. Store the four `EncryptedFields`
 * columns plus a MASKED copy for display; keep clear values out of logs and audit payloads.
 *
 * `blindIndex` gives a keyed HMAC for uniqueness / equality lookups of an encrypted value
 * without storing it in clear.
 */
export interface EncryptedFields {
  ciphertext: string;
  wrappedKey: string;
  keyVersion: number;
  keyProvider: string;
}

export async function encryptFields(
  organizationId: string,
  binding: string,
  values: Record<string, unknown>,
): Promise<EncryptedFields> {
  return sealSecret(keyProvider(), { organizationId, secretId: binding }, JSON.stringify(values));
}

export async function decryptFields<T = Record<string, unknown>>(
  organizationId: string,
  binding: string,
  sealed: Pick<EncryptedFields, 'ciphertext' | 'wrappedKey' | 'keyVersion'>,
): Promise<T> {
  const json = await openSecret(keyProvider(), { organizationId, secretId: binding }, sealed);
  return JSON.parse(json) as T;
}

/** Keyed, org-bound HMAC of a normalised value (for unique / lookup indexes). */
export function blindIndex(organizationId: string, field: string, value: string): string {
  return keyProvider().fingerprint(value.trim().toUpperCase(), `${organizationId}:${field}`);
}

/** Mask all but the last `visible` characters (`XXXXXX1234`). Short values are fully masked. */
export function maskValue(value: string, visible = 4): string {
  const v = value.trim();
  if (v.length <= visible) return 'X'.repeat(v.length);
  return 'X'.repeat(v.length - visible) + v.slice(-visible);
}

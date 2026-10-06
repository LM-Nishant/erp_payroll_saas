import { randomBytes } from 'node:crypto';
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { maskInfo, maskedDisplay, openSecret, rewrapSecret, sealSecret } from './envelope';
import { LocalKeyProvider } from './key-provider';
import { SecretValue } from './secret-value';

const k1 = randomBytes(32);
const k2 = randomBytes(32);
const v1 = new LocalKeyProvider(new Map([[1, k1]]), 1);
const v12 = new LocalKeyProvider(
  new Map([
    [1, k1],
    [2, k2],
  ]),
  2,
);
const binding = { organizationId: 'org-a', secretId: 'sec-1' };
const PLAINTEXT = 'sk-live-SUPER-sensitive-value-1234';

describe('envelope encryption', () => {
  it('round-trips and never stores plaintext', async () => {
    const sealed = await sealSecret(v1, binding, PLAINTEXT);
    expect(sealed.keyVersion).toBe(1);
    expect(sealed.keyProvider).toBe('local');
    expect(JSON.stringify(sealed)).not.toContain('SUPER');
    expect(await openSecret(v1, binding, sealed)).toBe(PLAINTEXT);
    // Fresh data key + IV per seal.
    const again = await sealSecret(v1, binding, PLAINTEXT);
    expect(again.ciphertext).not.toBe(sealed.ciphertext);
    expect(again.wrappedKey).not.toBe(sealed.wrappedKey);
  });

  it('binds the ciphertext to tenant + secret id (AAD)', async () => {
    const sealed = await sealSecret(v1, binding, PLAINTEXT);
    await expect(
      openSecret(v1, { organizationId: 'org-b', secretId: 'sec-1' }, sealed),
    ).rejects.toThrow();
    await expect(
      openSecret(v1, { organizationId: 'org-a', secretId: 'sec-2' }, sealed),
    ).rejects.toThrow();
    const tampered = { ...sealed, ciphertext: sealed.ciphertext.slice(0, -2) + 'AA' };
    await expect(openSecret(v1, binding, tampered)).rejects.toThrow();
  });

  it('fails without the master key version', async () => {
    const sealed = await sealSecret(v12, binding, PLAINTEXT);
    expect(sealed.keyVersion).toBe(2);
    await expect(openSecret(v1, binding, sealed)).rejects.toThrow(/version 2/);
  });

  it('re-wraps data keys onto the active master key (rotation)', async () => {
    const old = await sealSecret(v1, binding, PLAINTEXT);
    const next = await rewrapSecret(v12, binding, old);
    expect(next).toMatchObject({ keyVersion: 2, keyProvider: 'local' });
    const rotated = { ...old, ...next! };
    expect(await openSecret(v12, binding, rotated)).toBe(PLAINTEXT);
    expect(await rewrapSecret(v12, binding, rotated)).toBeNull();
    // Old key retired → the re-wrapped secret still opens with only v2.
    const onlyV2 = new LocalKeyProvider(new Map([[2, k2]]), 2);
    expect(await openSecret(onlyV2, binding, rotated)).toBe(PLAINTEXT);
  });

  it('fingerprints are stable across master key additions', () => {
    expect(v1.fingerprint(PLAINTEXT, 'org-a')).toBe(v12.fingerprint(PLAINTEXT, 'org-a'));
    expect(v1.fingerprint(PLAINTEXT, 'org-a')).not.toBe(v1.fingerprint(PLAINTEXT, 'org-b'));
  });

  it('masks only long values', () => {
    expect(maskInfo(PLAINTEXT).last4).toBe('1234');
    expect(maskInfo('short-pw').last4).toBeNull();
    expect(maskedDisplay('1234')).toBe('••••••••1234');
  });
});

describe('SecretValue', () => {
  it('redacts on every accidental serialization path', () => {
    const v = new SecretValue(PLAINTEXT, {
      id: 's',
      kind: 'smtp',
      name: 'default',
      scopeType: 'ORGANIZATION',
      version: 1,
      metadata: null,
    });
    expect(v.reveal()).toBe(PLAINTEXT);
    expect(String(v)).toBe('[REDACTED]');
    expect(`${v}`).toBe('[REDACTED]');
    expect(JSON.stringify({ v })).not.toContain('SUPER');
    expect(inspect(v)).not.toContain('SUPER');
    expect(Object.keys(v)).not.toContain('value');
  });
});

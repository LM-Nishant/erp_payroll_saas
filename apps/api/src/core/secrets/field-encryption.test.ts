import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { blindIndex, decryptFields, encryptFields, maskValue } from './field-encryption';
import { LocalKeyProvider, setKeyProvider } from './key-provider';

describe('field encryption', () => {
  beforeAll(() => setKeyProvider(new LocalKeyProvider(new Map([[1, randomBytes(32)]]), 1)));
  afterAll(() => setKeyProvider(null));

  it('round-trips a field set bound to org + row', async () => {
    const sealed = await encryptFields('org-a', 'employee:1', { pan: 'ABCDE1234F' });
    expect(JSON.stringify(sealed)).not.toContain('ABCDE1234F');
    expect(await decryptFields('org-a', 'employee:1', sealed)).toEqual({ pan: 'ABCDE1234F' });
    await expect(decryptFields('org-b', 'employee:1', sealed)).rejects.toThrow();
    await expect(decryptFields('org-a', 'employee:2', sealed)).rejects.toThrow();
  });

  it('builds stable, org-bound, normalised blind indexes', () => {
    const a = blindIndex('org-a', 'pan', 'abcde1234f ');
    expect(a).toBe(blindIndex('org-a', 'pan', 'ABCDE1234F'));
    expect(a).not.toBe(blindIndex('org-b', 'pan', 'ABCDE1234F'));
    expect(a).not.toBe(blindIndex('org-a', 'aadhaar', 'ABCDE1234F'));
  });

  it('masks all but the last characters', () => {
    expect(maskValue('123456789012')).toBe('XXXXXXXX9012');
    expect(maskValue('123')).toBe('XXX');
  });
});

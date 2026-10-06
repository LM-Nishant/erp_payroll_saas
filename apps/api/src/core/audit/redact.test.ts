import { describe, expect, it } from 'vitest';
import { REDACTED, auditDiff, redact } from './redact';

describe('audit redaction', () => {
  it('redacts sensitive keys deeply', () => {
    expect(
      redact({
        name: 'A',
        passwordHash: 'x',
        nested: { refreshToken: 't', apiKey: 'k', mfaSecretEnc: 's', ok: 1 },
        at: new Date('2024-01-01T00:00:00Z'),
      }),
    ).toEqual({
      name: 'A',
      passwordHash: REDACTED,
      nested: { refreshToken: REDACTED, apiKey: REDACTED, mfaSecretEnc: REDACTED, ok: 1 },
      at: '2024-01-01T00:00:00.000Z',
    });
  });

  it('keeps only changed fields on update', () => {
    expect(
      auditDiff(
        { name: 'A', code: 'X', updatedAt: new Date(1) },
        { name: 'B', code: 'X', updatedAt: new Date(2) },
      ),
    ).toEqual({ before: { name: 'A' }, after: { name: 'B' } });
  });

  it('keeps full snapshots for create / delete', () => {
    expect(auditDiff(null, { name: 'A', password: 'p' })).toEqual({
      before: null,
      after: { name: 'A', password: REDACTED },
    });
  });
});

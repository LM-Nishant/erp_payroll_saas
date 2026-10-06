import { Writable } from 'node:stream';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { SecretValue } from '../secrets/secret-value';
import { LOG_REDACT_PATHS } from '.';

const PLAINTEXT = 'sk-live-SUPER-sensitive-value-1234';

describe('log redaction of secrets', () => {
  it('never writes secret plaintext to the logs', () => {
    const lines: string[] = [];
    const out = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const log = pino({ redact: { paths: LOG_REDACT_PATHS, censor: '[REDACTED]' } }, out);
    log.info({ req: { body: { kind: 'smtp', value: PLAINTEXT } } }, 'request');
    log.info({ input: { plaintext: PLAINTEXT, apiKey: PLAINTEXT } }, 'engine');
    const secret = new SecretValue(PLAINTEXT, {
      id: 's',
      kind: 'ai.openai',
      name: 'default',
      scopeType: 'ORGANIZATION',
      version: 1,
      metadata: null,
    });
    log.info({ secret }, `using ${secret}`);
    const all = lines.join('\n');
    expect(lines).toHaveLength(3);
    expect(all).not.toContain('SUPER');
    expect(all).toContain('[REDACTED]');
  });
});

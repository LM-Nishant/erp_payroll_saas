import { inspect } from 'node:util';

const REDACTED = '[REDACTED]';

/**
 * A decrypted secret handed to an engine. The plaintext is only reachable via `reveal()`;
 * accidental string conversion, JSON serialization or logging yields "[REDACTED]".
 */
export class SecretValue {
  readonly #value: string;

  constructor(
    value: string,
    readonly meta: {
      id: string;
      kind: string;
      name: string;
      scopeType: string;
      version: number;
      metadata: Record<string, unknown> | null;
    },
  ) {
    this.#value = value;
  }

  /** The plaintext. Use it immediately (e.g. pass to an SDK); never log or persist it. */
  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [inspect.custom](): string {
    return `SecretValue(${this.meta.kind}/${this.meta.name} ${REDACTED})`;
  }
}

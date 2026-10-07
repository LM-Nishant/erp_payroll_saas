import { describe, expect, it } from 'vitest';
import { passwordPolicyViolations } from './password-policy';

describe('passwordPolicyViolations', () => {
  it('accepts a strong password', () => {
    expect(passwordPolicyViolations('Correct-Horse-9', 'a@b.c')).toEqual([]);
  });

  it('rejects short, simple or email-derived passwords', () => {
    expect(passwordPolicyViolations('Ab1!')).toHaveLength(1);
    expect(passwordPolicyViolations('alllowercaseletters')).toHaveLength(1);
    expect(passwordPolicyViolations('Priya-Sharma-2026', 'priya@x.in')).toHaveLength(1);
  });
});

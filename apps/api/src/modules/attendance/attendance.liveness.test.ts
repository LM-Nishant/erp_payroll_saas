import { describe, expect, it } from 'vitest';
import {
  issueLivenessChallenge,
  LIVENESS_TTL_MS,
  verifyLivenessProof,
} from './attendance.liveness';

const face = Array.from({ length: 128 }, (_, i) => Math.cos(i) / 10);
const proofFor = (c: { challenge: string; steps: string[] }, descriptor = face) => ({
  challenge: c.challenge,
  frames: c.steps.map((step) => ({ step: step as 'BLINK', descriptor })),
});

describe('selfie liveness challenge', () => {
  it('asks for a blink and one head turn in random order', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const { steps } = issueLivenessChallenge('emp-1');
      expect(steps).toHaveLength(2);
      expect(steps).toContain('BLINK');
      seen.add(steps.join(','));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('accepts the steps in order from the same employee and face', () => {
    const c = issueLivenessChallenge('emp-1');
    expect(verifyLivenessProof(proofFor(c), 'emp-1', face, 0.5).steps).toEqual(c.steps);
  });

  it('rejects expired, foreign, tampered or out-of-order proofs', () => {
    const now = Date.now();
    const c = issueLivenessChallenge('emp-1', now);
    expect(() =>
      verifyLivenessProof(proofFor(c), 'emp-1', face, 0.5, now + LIVENESS_TTL_MS + 1),
    ).toThrow(/expired/);
    expect(() => verifyLivenessProof(proofFor(c), 'emp-2', face, 0.5)).toThrow(/someone else/);
    expect(() =>
      verifyLivenessProof({ ...proofFor(c), challenge: `${c.challenge}x` }, 'emp-1', face, 0.5),
    ).toThrow(/not valid/);
    const reversed = { challenge: c.challenge, frames: [...proofFor(c).frames].reverse() };
    expect(() => verifyLivenessProof(reversed, 'emp-1', face, 0.5)).toThrow(/not completed/);
  });

  it('rejects a step that shows a different face', () => {
    const c = issueLivenessChallenge('emp-1');
    const other = face.map((v, i) => v + (i % 2 ? 0.2 : -0.2));
    const proof = proofFor(c);
    proof.frames[1] = { ...proof.frames[1]!, descriptor: other };
    expect(() => verifyLivenessProof(proof, 'emp-1', face, 0.5)).toThrow(/does not match/);
  });
});

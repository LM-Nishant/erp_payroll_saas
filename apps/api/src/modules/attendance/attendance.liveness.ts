import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { LivenessProof, LivenessStep } from '@erp/shared';
import { env } from '../../core/config/env';
import { AppError } from '../../core/http/errors';
import { faceDistance } from '../employees/employees.photo';

/**
 * Selfie liveness challenge. The server picks the steps (a blink and a head turn, in random order)
 * and signs them for one employee with a short expiry. The browser runs the steps with face
 * landmarks and returns one descriptor per step; every step must show the enrolled face.
 * A printed photo or a pre-recorded clip can't follow a random, short-lived script.
 */
export const LIVENESS_TTL_MS = 2 * 60 * 1000;

const key = () =>
  createHmac('sha256', env.JWT_ACCESS_SECRET).update('attendance-liveness-v1').digest();

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const sign = (payload: string) => createHmac('sha256', key()).update(payload).digest();

interface ChallengePayload {
  /** employee id */
  e: string;
  s: LivenessStep[];
  /** expiry, epoch ms */
  x: number;
  n: string;
}

export function issueLivenessChallenge(employeeId: string, now = Date.now()) {
  const turn: LivenessStep = randomInt(2) ? 'TURN_LEFT' : 'TURN_RIGHT';
  const steps: LivenessStep[] = randomInt(2) ? ['BLINK', turn] : [turn, 'BLINK'];
  const payload: ChallengePayload = {
    e: employeeId,
    s: steps,
    x: now + LIVENESS_TTL_MS,
    n: randomBytes(9).toString('base64url'),
  };
  const body = b64(JSON.stringify(payload));
  return {
    challenge: `${body}.${b64(sign(body))}`,
    steps,
    expiresAt: new Date(payload.x).toISOString(),
  };
}

const invalid = (message: string) => new AppError(422, 'LIVENESS_FAILED', message);

/** Checks the signed challenge and that every step's face matches `stored`; returns the max distance. */
export function verifyLivenessProof(
  proof: LivenessProof,
  employeeId: string,
  stored: number[],
  threshold: number,
  now = Date.now(),
): { maxDistance: number; steps: LivenessStep[] } {
  const [body, mac] = proof.challenge.split('.');
  if (!body || !mac) throw invalid('The liveness challenge is malformed');
  const given = Buffer.from(mac, 'base64url');
  const expected = sign(body);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw invalid('The liveness challenge is not valid');
  }
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as ChallengePayload;
  if (payload.e !== employeeId) throw invalid('The liveness challenge belongs to someone else');
  if (payload.x < now) throw invalid('The liveness challenge has expired. Try again.');
  if (
    proof.frames.length !== payload.s.length ||
    proof.frames.some((f, i) => f.step !== payload.s[i])
  ) {
    throw invalid('The liveness steps were not completed as asked');
  }
  let maxDistance = 0;
  for (const f of proof.frames) {
    maxDistance = Math.max(maxDistance, faceDistance(stored, f.descriptor));
  }
  if (maxDistance > threshold) {
    throw new AppError(422, 'FACE_MISMATCH', 'The selfie does not match your profile photo', {
      distance: Math.round(maxDistance * 10_000) / 10_000,
      threshold,
    });
  }
  return { maxDistance, steps: payload.s };
}

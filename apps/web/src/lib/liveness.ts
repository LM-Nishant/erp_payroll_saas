import type { LivenessStep } from '@erp/shared';

/** A 2D landmark point (face-api 68-point model, image coordinates, not mirrored). */
export interface Pt {
  x: number;
  y: number;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Eye aspect ratio for the six points of one eye: ~0.3 open, < ~0.2 closed. */
export function eyeAspectRatio(eye: Pt[]): number {
  const [p1, p2, p3, p4, p5, p6] = eye as [Pt, Pt, Pt, Pt, Pt, Pt];
  const width = dist(p1, p4);
  return width ? (dist(p2, p6) + dist(p3, p5)) / (2 * width) : 0;
}

export interface FaceMetrics {
  /** Mean eye aspect ratio of both eyes. */
  ear: number;
  /**
   * Nose tip position between the jaw edges, 0..1 (0.5 = facing the camera). In the unmirrored
   * camera image it grows when the person turns to *their* left and shrinks to their right.
   */
  yaw: number;
}

export function faceMetrics(points: Pt[]): FaceMetrics | null {
  if (points.length < 68) return null;
  const ear = (eyeAspectRatio(points.slice(36, 42)) + eyeAspectRatio(points.slice(42, 48))) / 2;
  const left = points[0]!;
  const right = points[16]!;
  const span = right.x - left.x;
  if (!span) return null;
  return { ear, yaw: (points[30]!.x - left.x) / span };
}

export const STEP_PROMPTS: Record<LivenessStep, string> = {
  BLINK: 'Blink your eyes',
  TURN_LEFT: 'Slowly turn your head to your left',
  TURN_RIGHT: 'Slowly turn your head to your right',
};

/** Yaw change from the person's straight-ahead pose that counts as a head turn. */
export const TURN_DELTA = 0.12;
/** An eye counts as closed below this share of the open-eye baseline. */
const CLOSED_RATIO = 0.7;
/** …and open again above this share. */
const REOPEN_RATIO = 0.85;

/**
 * Follows one challenge frame by frame. `observe` returns true when the current frame is a good
 * moment to capture a descriptor for the current step (eyes just reopened after a blink, or head
 * turned far enough); call `complete()` once that frame's descriptor is accepted.
 */
export class LivenessTracker {
  private index = 0;
  private openEar = 0;
  private straightYaw: number | null = null;
  private closed = false;

  constructor(readonly steps: LivenessStep[]) {}

  get current(): LivenessStep | null {
    return this.steps[this.index] ?? null;
  }

  get done(): boolean {
    return this.index >= this.steps.length;
  }

  get completed(): number {
    return this.index;
  }

  observe(m: FaceMetrics): boolean {
    const step = this.current;
    if (!step) return false;
    if (step === 'BLINK') {
      if (!this.closed) {
        // Track the open-eye level (slowly decaying so a squint doesn't lock it high).
        this.openEar = Math.max(m.ear, this.openEar * 0.98);
        if (this.openEar > 0 && m.ear < this.openEar * CLOSED_RATIO) this.closed = true;
        return false;
      }
      return m.ear > this.openEar * REOPEN_RATIO;
    }
    if (this.straightYaw === null) {
      // Wait for a roughly straight-ahead frame before measuring the turn.
      if (Math.abs(m.yaw - 0.5) < 0.1) this.straightYaw = m.yaw;
      return false;
    }
    const delta = m.yaw - this.straightYaw;
    return step === 'TURN_LEFT' ? delta >= TURN_DELTA : delta <= -TURN_DELTA;
  }

  complete(): void {
    this.index += 1;
    this.closed = false;
    this.straightYaw = null;
  }
}

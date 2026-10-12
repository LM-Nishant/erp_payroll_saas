import { describe, expect, it } from 'vitest';
import { eyeAspectRatio, faceMetrics, LivenessTracker, type Pt } from './liveness';

/** 68 landmarks with a given eye opening (EAR) and nose position between the jaw edges. */
function face(ear: number, yaw: number): Pt[] {
  const pts: Pt[] = Array.from({ length: 68 }, () => ({ x: 100, y: 100 }));
  pts[0] = { x: 0, y: 100 };
  pts[16] = { x: 200, y: 100 };
  pts[30] = { x: 200 * yaw, y: 120 };
  const eye = (x: number): Pt[] => {
    const h = ear * 30; // width 30 → vertical gaps of ear*30 give that EAR
    return [
      { x, y: 80 },
      { x: x + 10, y: 80 - h / 2 },
      { x: x + 20, y: 80 - h / 2 },
      { x: x + 30, y: 80 },
      { x: x + 20, y: 80 + h / 2 },
      { x: x + 10, y: 80 + h / 2 },
    ];
  };
  pts.splice(36, 6, ...eye(40));
  pts.splice(42, 6, ...eye(130));
  return pts;
}

const metrics = (ear: number, yaw: number) => faceMetrics(face(ear, yaw))!;

describe('liveness metrics', () => {
  it('computes eye aspect ratio and yaw from landmarks', () => {
    expect(eyeAspectRatio(face(0.3, 0.5).slice(36, 42))).toBeCloseTo(0.3);
    const m = metrics(0.28, 0.62);
    expect(m.ear).toBeCloseTo(0.28);
    expect(m.yaw).toBeCloseTo(0.62);
  });
});

describe('LivenessTracker', () => {
  it('needs the eyes to close and reopen for a blink', () => {
    const t = new LivenessTracker(['BLINK']);
    expect(t.observe(metrics(0.3, 0.5))).toBe(false);
    expect(t.observe(metrics(0.29, 0.5))).toBe(false); // still open
    expect(t.observe(metrics(0.1, 0.5))).toBe(false); // closed
    expect(t.observe(metrics(0.15, 0.5))).toBe(false); // half open
    expect(t.observe(metrics(0.29, 0.5))).toBe(true); // reopened → capture
    t.complete();
    expect(t.done).toBe(true);
  });

  it('ignores a photo whose eyes never close', () => {
    const t = new LivenessTracker(['BLINK']);
    for (let i = 0; i < 50; i++) expect(t.observe(metrics(0.3, 0.5))).toBe(false);
  });

  it('detects head turns in the requested direction only', () => {
    const t = new LivenessTracker(['TURN_LEFT', 'TURN_RIGHT']);
    expect(t.observe(metrics(0.3, 0.52))).toBe(false); // straight baseline
    expect(t.observe(metrics(0.3, 0.3))).toBe(false); // wrong way
    expect(t.observe(metrics(0.3, 0.66))).toBe(true);
    t.complete();
    expect(t.current).toBe('TURN_RIGHT');
    expect(t.observe(metrics(0.3, 0.7))).toBe(false); // not straight yet: no baseline
    expect(t.observe(metrics(0.3, 0.5))).toBe(false); // baseline
    expect(t.observe(metrics(0.3, 0.36))).toBe(true);
    t.complete();
    expect(t.done).toBe(true);
    expect(t.completed).toBe(2);
  });
});

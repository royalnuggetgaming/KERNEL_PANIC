import { describe, expect, it } from 'vitest';
import {
  angleDiff,
  approach,
  clamp,
  dirToYaw,
  inArc,
  lerpAngle,
  normalize2,
  pointSegDistSq,
  segCircleHit,
  smoothDamp,
  turnToward,
  wrapAngle,
  yawToDir,
} from '../../src/core/math';

describe('math', () => {
  it('clamp/approach/wrap', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(approach(0, 10, 3)).toBe(3);
    expect(approach(9, 10, 3)).toBe(10);
    expect(approach(5, 0, 2)).toBe(3);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(angleDiff(0.1, -0.1)).toBeCloseTo(-0.2);
    expect(lerpAngle(Math.PI - 0.1, -Math.PI + 0.1, 0.5)).toBeCloseTo(Math.PI);
    expect(turnToward(0, 1, 0.25)).toBeCloseTo(0.25);
    expect(turnToward(0, 0.1, 0.25)).toBeCloseTo(0.1);
  });

  it('yaw convention: forward(yaw) = (sin, cos)', () => {
    const o = { x: 0, z: 0 };
    yawToDir(Math.PI / 2, o);
    expect(o.x).toBeCloseTo(1);
    expect(o.z).toBeCloseTo(0);
    expect(dirToYaw(0, 1)).toBeCloseTo(0);
    expect(dirToYaw(1, 0)).toBeCloseTo(Math.PI / 2);
  });

  it('normalize2 writes unit vectors and handles zero', () => {
    const o = { x: 9, z: 9 };
    expect(normalize2(3, 4, o)).toBeCloseTo(5);
    expect(Math.hypot(o.x, o.z)).toBeCloseTo(1);
    normalize2(0, 0, o);
    expect(o).toEqual({ x: 0, z: 0 });
  });

  it('segCircleHit finds the entry time and misses cleanly', () => {
    expect(segCircleHit(-10, 0, 10, 0, 0, 0, 1)).toBeCloseTo(0.45);
    expect(segCircleHit(-10, 5, 10, 5, 0, 0, 1)).toBe(-1);
    expect(segCircleHit(0, 0, 10, 0, 0, 0, 1)).toBe(0);
    expect(segCircleHit(-10, 0, -5, 0, 0, 0, 1)).toBe(-1);
    expect(segCircleHit(3, 3, 3, 3, 0, 0, 1)).toBe(-1);
  });

  it('pointSegDistSq', () => {
    expect(pointSegDistSq(0, 1, -1, 0, 1, 0)).toBeCloseTo(1);
    expect(pointSegDistSq(3, 0, -1, 0, 1, 0)).toBeCloseTo(4);
    expect(pointSegDistSq(2, 2, 0, 0, 0, 0)).toBeCloseTo(8);
  });

  it('inArc (Warden shields)', () => {
    const half = (50 * Math.PI) / 180;
    expect(inArc(0, half, 0, 1)).toBe(true);
    expect(inArc(0, half, 1, 0)).toBe(false);
    expect(inArc(0, half, 0, -1)).toBe(false);
    expect(inArc(0, half, 0, 0)).toBe(false);
  });

  it('smoothDamp converges without overshoot, independent of frame rate', () => {
    const run = (dt: number): number => {
      const st = { velocity: 0 };
      let v = 0;
      for (let t = 0; t < 2; t += dt) v = smoothDamp(v, 10, st, 0.3, dt);
      return v;
    };
    expect(run(1 / 120)).toBeCloseTo(10, 1);
    expect(Math.abs(run(1 / 120) - run(1 / 60))).toBeLessThan(0.01);
    const st = { velocity: 0 };
    let v = 0;
    for (let i = 0; i < 600; i++) {
      v = smoothDamp(v, 1, st, 0.1, 1 / 120);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

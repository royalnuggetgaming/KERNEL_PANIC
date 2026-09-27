import { describe, expect, it } from 'vitest';
import { CAMERA, SIM } from '../../src/config/tuning';
import { DEG2RAD } from '../../src/core/math';
import { ScreenShake, valueNoise1 } from '../../src/render/ScreenShake';

function run(s: ScreenShake, frames: number, dt: number, out: number[]): void {
  for (let i = 0; i < frames; i++) {
    if (i % 30 === 0) s.add(0.3);
    s.update(dt);
    out.push(s.offsetX, s.offsetZ, s.roll);
  }
}

describe('ScreenShake', () => {
  it('is deterministic for a seed and dt sequence', () => {
    const a: number[] = [];
    const b: number[] = [];
    run(new ScreenShake(42), 300, SIM.DT, a);
    run(new ScreenShake(42), 300, SIM.DT, b);
    expect(a).toEqual(b);
    const c: number[] = [];
    run(new ScreenShake(43), 300, SIM.DT, c);
    expect(c).not.toEqual(a);
  });

  it('clamps trauma per event and in total, ignores non-positive amounts', () => {
    const s = new ScreenShake();
    s.add(5);
    expect(s.trauma).toBe(CAMERA.SHAKE_MAX_TRAUMA_PER_EVENT);
    s.add(-1);
    s.add(Number.NaN);
    expect(s.trauma).toBe(CAMERA.SHAKE_MAX_TRAUMA_PER_EVENT);
    for (let i = 0; i < 10; i++) s.add(1);
    expect(s.trauma).toBe(1);
  });

  it('decays at SHAKE_DECAY per second down to zero', () => {
    const s = new ScreenShake();
    s.add(0.35);
    s.update(0.1);
    expect(s.trauma).toBeCloseTo(0.35 - CAMERA.SHAKE_DECAY * 0.1, 10);
    s.update(1);
    expect(s.trauma).toBe(0);
    expect(s.offsetX).toBe(0);
    expect(s.roll).toBe(0);
  });

  it('stays within the max offset and roll, scaled by trauma^2 and the setting', () => {
    const s = new ScreenShake(7);
    let maxOff = 0;
    let maxRoll = 0;
    for (let i = 0; i < 2000; i++) {
      s.add(1);
      s.add(1);
      s.add(1);
      s.update(1 / 240);
      maxOff = Math.max(maxOff, Math.abs(s.offsetX), Math.abs(s.offsetZ));
      maxRoll = Math.max(maxRoll, Math.abs(s.roll));
    }
    expect(maxOff).toBeLessThanOrEqual(CAMERA.SHAKE_MAX_OFFSET + 1e-9);
    expect(maxOff).toBeGreaterThan(CAMERA.SHAKE_MAX_OFFSET * 0.3);
    expect(maxRoll).toBeLessThanOrEqual(CAMERA.SHAKE_MAX_ROLL_DEG * DEG2RAD + 1e-9);

    const half = new ScreenShake(7);
    const full = new ScreenShake(7);
    half.setScale(0.5);
    half.add(0.35);
    full.add(0.35);
    half.update(0.05);
    full.update(0.05);
    expect(half.offsetX).toBeCloseTo(full.offsetX * 0.5, 10);
    half.setScale(7);
    half.update(0);
    expect(half.offsetX).toBeCloseTo(full.offsetX, 10);
  });

  it('is disabled by reduce motion', () => {
    const s = new ScreenShake();
    s.add(0.35);
    s.setReduceMotion(true);
    expect(s.trauma).toBe(0);
    s.add(0.35);
    s.update(0.01);
    expect(s.offsetX).toBe(0);
    expect(s.offsetZ).toBe(0);
    expect(s.roll).toBe(0);
    s.setReduceMotion(false);
    s.add(0.35);
    s.update(0.01);
    expect(Math.abs(s.offsetX) + Math.abs(s.offsetZ) + Math.abs(s.roll)).toBeGreaterThan(0);
  });

  it('value noise is continuous and bounded', () => {
    for (let t = 0; t < 50; t += 0.37) {
      const v = valueNoise1(t, 3);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
      expect(Math.abs(valueNoise1(t + 1e-4, 3) - v)).toBeLessThan(0.01);
    }
  });
});

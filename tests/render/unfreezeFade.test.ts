import { describe, expect, it } from 'vitest';
import {
  UNFREEZE_FADE_REDUCED_S,
  UNFREEZE_FADE_S,
  UnfreezeFade,
  unfreezeDim,
} from '../../src/render/unfreezeFade';
import { FREEZE_DIM } from '../../src/states/PlayingState';

describe('unfreezeDim', () => {
  it('starts at the frozen dim, eases monotonically to 0 and clamps its inputs', () => {
    expect(unfreezeDim(FREEZE_DIM, 0, UNFREEZE_FADE_S)).toBeCloseTo(FREEZE_DIM, 6);
    expect(unfreezeDim(FREEZE_DIM, UNFREEZE_FADE_S, UNFREEZE_FADE_S)).toBe(0);
    expect(unfreezeDim(FREEZE_DIM, 10, UNFREEZE_FADE_S)).toBe(0);
    expect(unfreezeDim(0, 0, UNFREEZE_FADE_S)).toBe(0);
    expect(unfreezeDim(-1, 0, UNFREEZE_FADE_S)).toBe(0);
    expect(unfreezeDim(2, 0, UNFREEZE_FADE_S)).toBe(1);
    expect(unfreezeDim(FREEZE_DIM, 0, 0)).toBe(0);
    expect(unfreezeDim(FREEZE_DIM, -1, UNFREEZE_FADE_S)).toBeCloseTo(FREEZE_DIM, 6);
    let prev = 1;
    for (let t = 0; t <= UNFREEZE_FADE_S; t += 0.01) {
      const d = unfreezeDim(FREEZE_DIM, t, UNFREEZE_FADE_S);
      expect(d).toBeLessThanOrEqual(prev);
      prev = d;
    }
  });
});

/** Largest frame-to-frame brightness factor change ((1 - dim) steps) over a frame sequence. */
function maxBrightnessStep(dims: readonly number[], frozenDim: number): number {
  let prev = 1 - frozenDim;
  let max = 0;
  for (const d of dims) {
    max = Math.max(max, Math.abs(1 - d - prev));
    prev = 1 - d;
  }
  return max;
}

describe('UnfreezeFade', () => {
  it('is inactive until begun and returns 0 dim', () => {
    const f = new UnfreezeFade();
    expect(f.active).toBe(false);
    expect(f.step(1 / 120, false)).toBe(0);
  });

  // Regression: at 120 Hz, leaving the shop/pause went from the dimmed frozen frame (brightness 1 - FREEZE_DIM)
  // to a full-brightness live frame in one frame (a 0.55 step). The fade keeps every frame step small.
  it('ramps the live frame from the frozen dim at 120 Hz without a big step, then ends', () => {
    const f = new UnfreezeFade();
    f.begin(FREEZE_DIM);
    const dims: number[] = [];
    for (let i = 0; i < 120; i++) dims.push(f.step(1 / 120, false));
    expect(dims[0]).toBeCloseTo(FREEZE_DIM, 6);
    expect(maxBrightnessStep(dims, FREEZE_DIM)).toBeLessThan(0.05);
    expect(dims[dims.length - 1]).toBe(0);
    expect(f.active).toBe(false);
    const frames = dims.findIndex((d) => d === 0);
    expect(frames / 120).toBeCloseTo(UNFREEZE_FADE_S, 1);
  });

  it('reduce flashes fades more gently; 60 Hz and a clamped long frame still end cleanly', () => {
    const f = new UnfreezeFade();
    f.begin(FREEZE_DIM);
    const dims: number[] = [];
    for (let i = 0; i < 120; i++) dims.push(f.step(1 / 120, true));
    expect(dims.findIndex((d) => d === 0) / 120).toBeCloseTo(UNFREEZE_FADE_REDUCED_S, 1);
    expect(maxBrightnessStep(dims, FREEZE_DIM)).toBeLessThan(0.03);
    f.begin(FREEZE_DIM);
    expect(f.step(0.1, false)).toBeCloseTo(FREEZE_DIM, 6);
    f.step(1, false);
    expect(f.step(1 / 60, false)).toBe(0);
    expect(f.active).toBe(false);
  });
});

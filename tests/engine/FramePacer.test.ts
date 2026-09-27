import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/core/rng';
import { createFramePacer, type FramePacer } from '../../src/engine/FramePacer';

/** Feeds `seconds` of rAF callbacks at `hz` (optional jitter in ms); returns frames the pacer ran. */
function feed(p: FramePacer, hz: number, seconds: number, startMs = 0, jitterMs = 0, seed = 1): number {
  const rng = createRng(seed);
  const n = Math.round(hz * seconds);
  let ran = 0;
  for (let i = 0; i < n; i++) {
    const jitter = jitterMs > 0 ? rng.range(-jitterMs, jitterMs) : 0;
    if (p.shouldRun(startMs + (i * 1000) / hz + jitter)) ran++;
  }
  return ran;
}

function capped(cap: 60 | 120): FramePacer {
  const p = createFramePacer();
  p.setCap(cap);
  return p;
}

describe('FramePacer caps', () => {
  it('a 60 cap on a 120 Hz series averages 60 +/- 1 frames/s with a clean every-other cadence', () => {
    const p = capped(60);
    const pattern: boolean[] = [];
    for (let i = 0; i < 1200; i++) pattern.push(p.shouldRun((i * 1000) / 120));
    const ran = pattern.filter(Boolean).length;
    expect(ran / 10).toBeGreaterThanOrEqual(59);
    expect(ran / 10).toBeLessThanOrEqual(61);
    for (let i = 2; i < pattern.length; i++) expect(pattern[i]).toBe(!pattern[i - 1]);
    expect(p.refreshHz).toBe(120);
    expect(p.effectiveCap).toBe(60);
  });

  it('a 60 cap on a 144 Hz series averages 60 +/- 1 frames/s', () => {
    const p = capped(60);
    const ran = feed(p, 144, 10);
    expect(ran / 10).toBeGreaterThanOrEqual(59);
    expect(ran / 10).toBeLessThanOrEqual(61);
    expect(p.refreshHz).toBe(144);
  });

  it('a 60 cap holds 60 +/- 1 under +/-1 ms timestamp jitter at 120 and 144 Hz', () => {
    for (const hz of [120, 144]) {
      const p = capped(60);
      const ran = feed(p, hz, 10, 0, 1, hz);
      expect(Math.abs(ran / 10 - 60)).toBeLessThanOrEqual(1);
    }
  });

  it('a 60 cap on a 60 Hz display and a 120 cap on 120 Hz run every frame', () => {
    expect(feed(capped(60), 60, 5)).toBe(300);
    expect(feed(capped(120), 120, 5)).toBe(600);
  });

  it('a 120 cap on 144 Hz averages 120 +/- 1', () => {
    const ran = feed(capped(120), 144, 10);
    expect(Math.abs(ran / 10 - 120)).toBeLessThanOrEqual(1);
  });

  it('uncapped and auto (not degraded) run every callback', () => {
    const u = createFramePacer();
    u.setCap('uncapped');
    expect(feed(u, 144, 2)).toBe(288);
    expect(u.effectiveCap).toBeNull();
    const a = createFramePacer();
    a.setPlaying(true);
    expect(feed(a, 120, 1)).toBe(120);
    expect(a.effectiveCap).toBeNull();
  });

  it('re-anchors after a long stall instead of bursting', () => {
    const p = capped(60);
    feed(p, 120, 1);
    // 500 ms gap, then a normal 120 Hz stream: still every other frame, no catch-up run of consecutive frames.
    const pattern: boolean[] = [];
    for (let i = 0; i < 240; i++) pattern.push(p.shouldRun(1500 + (i * 1000) / 120));
    expect(pattern[0]).toBe(true);
    for (let i = 1; i < pattern.length; i++) expect(pattern[i] && pattern[i - 1]).toBe(false);
  });
});

describe('FramePacer refresh estimate', () => {
  it('defaults to 60 Hz and tracks the median delta, ignoring outliers', () => {
    const p = createFramePacer();
    expect(p.refreshHz).toBe(60);
    let t = 0;
    for (let i = 0; i < 100; i++) {
      t += i % 10 === 0 ? 30 : 1000 / 120;
      p.shouldRun(t);
    }
    expect(p.refreshHz).toBe(120);
    p.shouldRun(t + 5000);
    expect(p.refreshHz).toBe(120);
  });
});

describe('FramePacer auto degradation', () => {
  /** 120 Hz stream where every `missEvery`-th frame took two vsyncs. */
  function autoRun(p: FramePacer, seconds: number, missEvery: number, t0 = 0): number {
    let t = t0;
    const n = Math.round(seconds * 120);
    for (let i = 0; i < n; i++) {
      t += i > 0 && i % missEvery === 0 ? 2000 / 120 : 1000 / 120;
      p.shouldRun(t);
    }
    return t;
  }

  it('drops to a 60 cap while Playing when missed vsyncs exceed 5% over 2 s', () => {
    const p = createFramePacer();
    p.setPlaying(true);
    autoRun(p, 3, 10);
    expect(p.effectiveCap).toBe(60);
    p.setPlaying(false);
    expect(p.effectiveCap).toBeNull();
    p.setPlaying(true);
    expect(p.effectiveCap).toBe(60);
    p.setCap('auto');
    expect(p.effectiveCap).toBeNull();
  });

  it('stays uncapped at 2% misses and when not Playing', () => {
    const clean = createFramePacer();
    clean.setPlaying(true);
    autoRun(clean, 6, 50);
    expect(clean.effectiveCap).toBeNull();

    const menu = createFramePacer();
    autoRun(menu, 6, 4);
    menu.setPlaying(true);
    expect(menu.effectiveCap).toBeNull();
  });

  it('does not degrade for explicit caps', () => {
    const p = createFramePacer();
    p.setCap(120);
    p.setPlaying(true);
    autoRun(p, 4, 4);
    expect(p.effectiveCap).toBe(120);
  });

  it('a tab-switch gap resets the miss window instead of counting as misses', () => {
    const control = createFramePacer();
    control.setPlaying(true);
    autoRun(control, 0.6, 1000, autoRun(control, 1.5, 10));
    expect(control.effectiveCap).toBe(60);

    const p = createFramePacer();
    p.setPlaying(true);
    const t = autoRun(p, 1.5, 10) + 3000;
    p.shouldRun(t);
    autoRun(p, 0.6, 1000, t);
    expect(p.effectiveCap).toBeNull();
  });
});

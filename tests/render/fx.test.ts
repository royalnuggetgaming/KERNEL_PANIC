import { Vector4 } from 'three';
import { describe, expect, it } from 'vitest';
import { CAPACITY, SIM } from '../../src/config/tuning';
import { createRng } from '../../src/core/rng';
import { ContinuousEmitter } from '../../src/render/fx/continuous';
import { CRIT_SCALE, DamageNumbers, MAX_DIGITS_PER_FRAME } from '../../src/render/fx/DamageNumbers';
import { FxDirector, sourceTint, type CameraCues } from '../../src/render/fx/FxDirector';
import { burstSpec, ParticleSystem } from '../../src/render/fx/ParticleSystem';
import { ShockwaveSystem } from '../../src/render/fx/ShockwaveSystem';
import { TRAIL_HEIGHT, TRAIL_RESET_JUMP, TrailRibbon } from '../../src/render/fx/TrailRenderer';
import { TransientList } from '../../src/render/fx/TransientList';
import { CLOCK_START, CLOCK_WRAP, RenderClock, renderSimTime } from '../../src/render/frameUniforms';
import { computePostSizes } from '../../src/render/PostFX';
import { computeBackingSize, type ViewportSize } from '../../src/render/Renderer';
import { DECAL_KIND } from '../../src/shaders/decal';
import { DIGIT_RECORD, PARTICLE_RECORD, SHOCKWAVE_RECORD } from '../../src/shaders/ringLayouts';
import { TINT } from '../../src/shaders/tints';
import { createSimEvents } from '../../src/sim/simEventChannels';
import { createTestWorld } from '../helpers/worldFixture';
import { FakeRing, frameCtx } from './renderFakes';

function director(): {
  fx: FxDirector;
  parts: FakeRing;
  waves: FakeRing;
  digits: FakeRing;
  arcs: TransientList;
  tele: TransientList;
  log: { trauma: number; intros: number; swoops: number };
} {
  const parts = new FakeRing(512, PARTICLE_RECORD.stride);
  const waves = new FakeRing(32, SHOCKWAVE_RECORD.stride);
  const digits = new FakeRing(64, DIGIT_RECORD.stride);
  const arcs = new TransientList(8);
  const tele = new TransientList(8);
  const log = { trauma: 0, intros: 0, swoops: 0 };
  const c: CameraCues = {
    trauma: (a) => {
      log.trauma += a;
    },
    bossIntro: () => {
      log.intros++;
    },
    countdownSwoop: () => {
      log.swoops++;
    },
  };
  const ripples = Array.from({ length: 8 }, () => new Vector4());
  const fx = new FxDirector({
    particles: new ParticleSystem(parts, createRng(1)),
    shockwaves: new ShockwaveSystem(waves, ripples),
    digits: new DamageNumbers(digits),
    arcs,
    telegraphs: tele,
    cues: c,
    rng: createRng(2),
  });
  return { fx, parts, waves, digits, arcs, tele, log };
}

describe('ring record packing', () => {
  it('particles follow PARTICLE_RECORD offsets and the quality cap scales bursts', () => {
    const ring = new FakeRing(64, PARTICLE_RECORD.stride);
    const ps = new ParticleSystem(ring, createRng(3));
    ps.emit(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, TINT.P2);
    expect(ring.rec(0)).toEqual([1, 2, 3, 7, 4, 5, 6, 8, 9, 10, 11, TINT.P2]);
    ps.commit();
    expect(ring.commits).toBe(1);
    ps.commit();
    expect(ring.commits).toBe(1);
    ps.setCap(CAPACITY.particles / 2);
    expect(ps.scaledCount(10)).toBe(5);
    expect(ps.scaledCount(1)).toBe(1);
    const before = ring.claims;
    ps.burst(0, 0, 0.5, 1, burstSpec(10, 1, 2, 0.5, 0.2, TINT.WHITE));
    expect(ring.claims - before).toBe(5);
    ps.cone(0, 0, 0.5, 0, 1, 0.2, 1, burstSpec(4, 1, 2, 0.5, 0.2, TINT.WHITE));
    expect(ring.claims - before).toBe(7);
    ps.reset();
    expect(ring.resets).toBe(1);
  });

  it('shockwaves follow SHOCKWAVE_RECORD and ripples cycle the 8-slot uniform ring', () => {
    const ring = new FakeRing(8, SHOCKWAVE_RECORD.stride);
    const rip = Array.from({ length: 8 }, () => new Vector4());
    const sw = new ShockwaveSystem(ring, rip);
    sw.spawn(1, 2, 3, 4, 5, 6, 7, 8);
    expect(ring.rec(0)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (let i = 0; i < 9; i++) sw.ripple(i, 0, 10 + i, 1);
    expect(rip[0]!.x).toBe(8);
    expect(rip[1]!.x).toBe(1);
    expect(rip[0]!.z).toBe(18);
    sw.commit();
    expect(ring.commits).toBe(1);
    sw.reset();
    expect(rip[3]!.w).toBe(0);
  });

  it('digits follow DIGIT_RECORD, pop crits and cap the per-frame count', () => {
    const ring = new FakeRing(256, DIGIT_RECORD.stride);
    const d = new DamageNumbers(ring);
    expect(d.spawn(1, 2, 5, 12.4, TINT.P1, true)).toBe(true);
    const r = ring.rec(0);
    expect(r[0]).toBe(1);
    expect(r[2]).toBe(2);
    expect(r[3]).toBe(5);
    expect(r[4]).toBe(12);
    expect(r[7]).toBe(CRIT_SCALE);
    expect(d.spawn(0, 0, 0, 0.2, 0, false)).toBe(false);
    let ok = 1;
    for (let i = 0; i < 100; i++) if (d.spawn(0, 0, 0, 5, 0, false)) ok++;
    expect(ok).toBe(MAX_DIGITS_PER_FRAME);
    d.commit();
    expect(d.spawn(0, 0, 0, 5, 0, false)).toBe(true);
    d.enabled = false;
    expect(d.spawn(0, 0, 0, 5, 0, false)).toBe(false);
  });
});

describe('FxDirector', () => {
  it('maps events to particles, digits, arcs, telegraphs and camera cues without clearing channels', () => {
    const { fx, parts, waves, digits, arcs, tele, log } = director();
    const e = createSimEvents();
    const h = e.hit.push();
    Object.assign(h, { x: 1, z: 1, amount: 30, crit: true, target: 0, player: 1 });
    const hp = e.hit.push();
    Object.assign(hp, { x: 0, z: 0, amount: 10, crit: false, target: 1, player: 0 });
    const k = e.kill.push();
    Object.assign(k, { kind: 'shard', x: 2, z: 2, by: 0, elite: true, combo: 3 });
    const a = e.arc.push();
    Object.assign(a, { x0: 0, z0: 0, x1: 3, z1: 0, owner: 1 });
    const t = e.telegraph.push();
    Object.assign(t, { shape: 1, x: 0, z: 0, dirX: 1, dirZ: 0, size: 6, duration: 0.8 });
    const b = e.boss.push();
    Object.assign(b, { id: 'kernel', part: 0, what: 'intro', x: 0, z: -10 });
    const wv = e.wave.push();
    Object.assign(wv, { what: 'countdown', wave: 1, value: 3, player: -1 });
    const pe = e.player.push();
    Object.assign(pe, { player: 1, what: 'downed', amount: 0, x: 4, z: 4 });
    fx.consume(e, 50);
    expect(e.hit.count).toBe(2);
    expect(parts.claims).toBeGreaterThan(20);
    expect(waves.claims).toBeGreaterThan(1);
    expect(digits.claims).toBe(1);
    expect(digits.rec(0)[6]).toBe(TINT.P2);
    expect(arcs.count).toBe(1);
    expect(arcs.items[0]!.tint).toBe(TINT.P2);
    expect(tele.count).toBe(1);
    expect(tele.items[0]!.kind).toBe(DECAL_KIND.LINE);
    expect(tele.items[0]!.x1).toBeCloseTo(Math.PI / 2);
    expect(log.intros).toBe(1);
    expect(log.swoops).toBe(1);
    expect(log.trauma).toBeGreaterThan(0.5);
    expect(fx.hurt).toBeGreaterThan(0.5);
    expect(fx.chromatic).toBeGreaterThan(0);

    const w = createTestWorld();
    fx.update(frameCtx(w, 1, 60, 0.5));
    expect(arcs.count).toBe(0);
    expect(tele.count).toBe(0);
    expect(fx.hurt).toBeLessThan(0.7);
    expect(parts.commits).toBe(1);
    fx.reset();
    expect(fx.hurt).toBe(0);
  });

  it('reduce flashes softens the hurt kick and drops the chromatic kick', () => {
    const { fx } = director();
    fx.setReduceFlashes(true);
    const e = createSimEvents();
    Object.assign(e.hit.push(), { x: 0, z: 0, amount: 10, crit: false, target: 1, player: 0 });
    fx.consume(e, 1);
    expect(fx.hurt).toBeCloseTo(0.35);
    expect(fx.chromatic).toBe(0);
    expect(sourceTint(-1)).toBe(TINT.ENEMY_SHOT);
    expect(sourceTint(2)).toBe(TINT.LINK);
  });

  it('keeps a low-HP hurt floor', () => {
    const { fx } = director();
    const w = createTestWorld();
    w.players[0].hp = 1;
    for (let i = 0; i < 100; i++) fx.update(frameCtx(w, 1, i * 0.1, 0.1));
    expect(fx.hurt).toBeGreaterThan(0.1);
  });
});

describe('ContinuousEmitter', () => {
  it('emits at the same rate at 60 and 120 Hz', () => {
    const w = createTestWorld();
    w.players[1].life = 'offline';
    const count = (hz: number): number => {
      const ring = new FakeRing(4096, PARTICLE_RECORD.stride);
      const ps = new ParticleSystem(ring, createRng(5));
      const em = new ContinuousEmitter();
      for (let i = 0; i < hz; i++) em.emit(ps, frameCtx(w, 1, i / hz, 1 / hz));
      return ring.claims;
    };
    const a = count(60);
    const b = count(120);
    expect(a).toBeGreaterThan(20);
    expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
  });
});

describe('TrailRibbon', () => {
  function uvFor(points: number): Float32Array {
    const uv = new Float32Array(points * 4);
    for (let k = 0; k < points; k++) {
      uv.set([k / (points - 1), 0, k / (points - 1), 1], k * 4);
    }
    return uv;
  }

  it('writes both ribbon edges around the history and collapses when hidden', () => {
    const r = new TrailRibbon(uvFor(8), 16);
    expect(r.points).toBe(8);
    for (let i = 0; i < 20; i++) r.advance(i * 0.2, 0, 1 / 60);
    const pos = new Float32Array(16 * 3);
    r.write(pos, 4, 0, true);
    expect(pos[0]).toBeCloseTo(4);
    expect(pos[1]).toBeCloseTo(TRAIL_HEIGHT);
    expect(Math.abs(pos[2]! - pos[5]!)).toBeCloseTo(0.76, 2);
    expect(pos[3 * 15]).toBeLessThan(4);
    r.write(pos, 4, 0, false);
    for (let v = 0; v < 16; v++) {
      expect(pos[v * 3]).toBe(4);
      expect(pos[v * 3 + 2]).toBe(0);
    }
  });

  it('restarts on a teleport-sized jump', () => {
    const r = new TrailRibbon(uvFor(8), 16);
    r.advance(0, 0, 1);
    r.advance(0.1, 0, 1);
    expect(r.historyCount).toBe(2);
    r.advance(TRAIL_RESET_JUMP + 5, 0, 1);
    expect(r.historyCount).toBe(1);
  });
});

describe('sizes and clocks', () => {
  it('computeBackingSize caps the DPR and never returns zero', () => {
    const out: ViewportSize = { cssWidth: 0, cssHeight: 0, pixelRatio: 0, width: 0, height: 0 };
    computeBackingSize(1512, 982, 2, 1.5, out);
    expect(out).toEqual({ cssWidth: 1512, cssHeight: 982, pixelRatio: 1.5, width: 2268, height: 1473 });
    computeBackingSize(0, 0, 0, 2, out);
    expect(out.width).toBe(1);
    expect(out.pixelRatio).toBe(1);
  });

  it('computePostSizes applies renderScale then halves each bloom level', () => {
    const s = computePostSizes(2000, 1000, 0.85, 0.5, new Int32Array(12));
    expect(Array.from(s)).toEqual([1700, 850, 850, 425, 425, 212, 212, 106, 106, 53, 53, 26]);
    const tiny = computePostSizes(3, 3, 0.25, 0.25, new Int32Array(12));
    expect(Math.min(...tiny)).toBe(1);
  });

  it('RenderClock starts above zero and wraps; renderSimTime lags by (1 - alpha) ticks', () => {
    const c = new RenderClock();
    c.advance(0);
    expect(c.time).toBe(CLOCK_START);
    c.advance(CLOCK_WRAP + 1);
    expect(c.time).toBeCloseTo(CLOCK_START + 1);
    c.advance(-5);
    expect(c.time).toBeCloseTo(CLOCK_START + 1);
    expect(renderSimTime(1, 1)).toBe(1);
    expect(renderSimTime(1, 0)).toBeCloseTo(1 - SIM.DT);
  });
});

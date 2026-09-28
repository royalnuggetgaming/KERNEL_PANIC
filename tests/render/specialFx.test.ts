import { Vector4 } from 'three';
import { describe, expect, it } from 'vitest';
import type { SpecialKind } from '../../src/contracts/ids';
import { ARENA } from '../../src/config/tuning';
import { railLength, SPECIALS } from '../../src/config/specials';
import { createRng } from '../../src/core/rng';
import { ParticleSystem } from '../../src/render/fx/ParticleSystem';
import { ShockwaveSystem } from '../../src/render/fx/ShockwaveSystem';
import { consumeSpecialFx } from '../../src/render/fx/specialFx';
import { SHOCKWAVE_RECORD, PARTICLE_RECORD } from '../../src/shaders/ringLayouts';
import { TINT } from '../../src/shaders/tints';
import { createSimEvents } from '../../src/sim/simEventChannels';
import { FakeRing } from './renderFakes';

const W1 = SHOCKWAVE_RECORD.attributes.find((a) => a.name === 'aW1')!.offset;
const W0 = SHOCKWAVE_RECORD.attributes.find((a) => a.name === 'aW0')!.offset;

function rig() {
  const parts = new FakeRing(1024, PARTICLE_RECORD.stride);
  const waves = new FakeRing(32, SHOCKWAVE_RECORD.stride);
  let trauma = 0;
  const sinks = {
    particles: new ParticleSystem(parts, createRng(1)),
    shockwaves: new ShockwaveSystem(
      waves,
      Array.from({ length: 8 }, () => new Vector4()),
    ),
    trauma: (a: number) => {
      trauma += a;
    },
  };
  const e = createSimEvents();
  return { parts, waves, sinks, e, trauma: () => trauma };
}

function special(e: ReturnType<typeof createSimEvents>, kind: SpecialKind, radius: number): void {
  const s = e.special.push();
  s.player = 0;
  s.kind = kind;
  s.x = 0;
  s.z = 0;
  s.dirX = 0;
  s.dirZ = -1;
  s.radius = radius;
  s.duration = 1;
}

describe('special FX', () => {
  it('Firewall draws a ring exactly as wide as the dome (the protected area)', () => {
    const r = rig();
    special(r.e, 'firewall', 5.625);
    consumeSpecialFx(r.sinks, r.e, 1, false);
    expect(r.waves.claims).toBe(1);
    expect(r.waves.data[W1]).toBeCloseTo(5.625, 5);
    expect(r.waves.data[W1 + 2]).toBe(TINT.ACCENT);
  });

  it('Patch Drone shows its heal radius', () => {
    const r = rig();
    special(r.e, 'patchDrone', SPECIALS.patchDrone.radius);
    consumeSpecialFx(r.sinks, r.e, 1, false);
    expect(r.waves.data[W1]).toBe(SPECIALS.patchDrone.radius);
  });

  it('Railburst strings sparks along the whole (arena-clipped) rail and shakes the camera', () => {
    const r = rig();
    special(r.e, 'railburst', 0.6);
    consumeSpecialFx(r.sinks, r.e, 1, false);
    expect(r.parts.claims).toBeGreaterThanOrEqual(10);
    let far = 0;
    const X = PARTICLE_RECORD.attributes[0]!.offset;
    for (let i = 0; i < r.parts.claims; i++) {
      const o = i * PARTICLE_RECORD.stride + X;
      far = Math.max(far, Math.hypot(r.parts.data[o]!, r.parts.data[o + 2]!));
    }
    expect(far).toBeGreaterThan(ARENA.RADIUS * 0.8);
    expect(r.trauma()).toBeCloseTo(0.25, 5);
    const rf = rig();
    special(rf.e, 'railburst', 0.6);
    consumeSpecialFx(rf.sinks, rf.e, 1, true);
    expect(rf.trauma()).toBeLessThan(0.25);
    expect(rf.parts.claims).toBeLessThan(r.parts.claims);
  });

  it('Blink marks the landing point from the player event with a ring and a streak', () => {
    const r = rig();
    const p = r.e.player.push();
    p.player = 0;
    p.what = 'special';
    p.x = 8;
    p.z = 0;
    special(r.e, 'blinkSwarm', 2.5);
    consumeSpecialFx(r.sinks, r.e, 1, false);
    // take-off ring + landing ring
    expect(r.waves.claims).toBe(2);
    const landing = SHOCKWAVE_RECORD.stride + W0;
    expect(r.waves.data[landing]).toBe(8);
    expect(r.waves.data[landing + 1]).toBe(0);
  });

  it('specialReady pulses around the player; reduce flashes keeps a single soft ring', () => {
    const r = rig();
    const p = r.e.player.push();
    p.player = 1;
    p.what = 'specialReady';
    p.x = 3;
    p.z = 4;
    consumeSpecialFx(r.sinks, r.e, 1, false);
    expect(r.waves.claims).toBe(2);
    expect(r.waves.data[W1 + 2]).toBe(TINT.P2);
    const q = rig();
    const e2 = q.e.player.push();
    e2.player = 0;
    e2.what = 'specialReady';
    consumeSpecialFx(q.sinks, q.e, 1, true);
    expect(q.waves.claims).toBe(1);
    expect(q.parts.claims).toBe(0);
  });
});

describe('railLength', () => {
  it('stops the rail at the arena wall, capped at the configured length', () => {
    expect(railLength(0, 0, 0, -1)).toBeCloseTo(ARENA.RADIUS, 9);
    expect(railLength(0, 20, 0, -1)).toBe(SPECIALS.railburst.length);
    expect(railLength(0, 31, 0, 1)).toBeCloseTo(1, 9);
    expect(railLength(0, 40, 0, 1)).toBe(0);
  });
});

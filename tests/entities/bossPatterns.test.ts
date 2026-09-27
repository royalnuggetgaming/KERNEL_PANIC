import { describe, expect, it } from 'vitest';
import type { BossEntity } from '../../src/contracts/sim';
import type { WorldState } from '../../src/contracts/world';
import type { AttackStep } from '../../src/config/bosses';
import { SIM } from '../../src/config/tuning';
import { aimAtTarget, runPattern, stepLasers } from '../../src/entities/bossPatterns';
import { spawnBoss } from '../../src/entities/bosses';
import { createTestWorld, placePlayer } from '../helpers/worldFixture';

function setup(): { w: WorldState; b: BossEntity } {
  const w = createTestWorld({ mode: 'solo' });
  w.run.wave = 5;
  w.run.phase = 'boss';
  placePlayer(w, 0, 0, 10);
  spawnBoss(w, 'forkBomb');
  const b = w.bosses[0]!;
  b.introTimer = 0;
  b.x = 0;
  b.z = -10;
  w.players[0].invulnUntil = 0;
  return { w, b };
}

/** Runs a step until it reports done; returns the number of ticks. */
function runToEnd(w: WorldState, b: BossEntity, step: AttackStep, max = 2000): number {
  for (let i = 1; i <= max; i++) {
    if (runPattern(w, b, step, SIM.DT)) return i;
  }
  return -1;
}

describe('boss attack primitives', () => {
  it('ring: repeats rings of N bullets at the interval', () => {
    const { w, b } = setup();
    const step: AttackStep = { prim: 'ring', bullets: 16, speed: 9, damage: 10, repeats: 3, interval: 0.6 };
    const n = runToEnd(w, b, step);
    expect(n).toBeGreaterThanOrEqual(Math.round(1.8 / SIM.DT) - 1);
    expect(w.enemyShots.count).toBe(48);
    const s = w.enemyShots.active[0]!;
    expect(Math.hypot(s.vx, s.vz)).toBeCloseTo(9, 6);
    expect(s.damage).toBe(10);
  });

  it('spiral: rate x duration emissions of `arms` bullets, rotating', () => {
    const { w, b } = setup();
    const step: AttackStep = {
      prim: 'spiral',
      arms: 3,
      speed: 10,
      damage: 9,
      turnDegPerS: 90,
      rate: 10,
      duration: 3,
    };
    const a0 = b.aimAngle;
    runToEnd(w, b, step);
    expect(w.enemyShots.count).toBe(30 * 3);
    expect(b.aimAngle - a0).toBeCloseTo((Math.PI / 2) * 3, 1);
  });

  it('aimed: volleys of spread shots centred on the target', () => {
    const { w, b } = setup();
    const step: AttackStep = {
      prim: 'aimed',
      shots: 3,
      spreadDeg: 12,
      speed: 13,
      damage: 10,
      volleys: 3,
      interval: 0.5,
    };
    runToEnd(w, b, step);
    expect(w.enemyShots.count).toBe(9);
    // Middle shot of the first volley points straight at the player (+Z from the boss).
    const mid = w.enemyShots.active[1]!;
    expect(mid.vx).toBeCloseTo(0, 6);
    expect(mid.vz).toBeCloseTo(13, 6);
    expect(aimAtTarget(w, b)).toBeCloseTo(0, 9);
  });

  it('sweep: spawns rotating beams that stop the boss and expire', () => {
    const { w, b } = setup();
    b.vx = 5;
    const step: AttackStep = {
      prim: 'sweep',
      beams: 2,
      length: 30,
      width: 1.2,
      damagePerS: 45,
      turnDegPerS: 60,
      warmup: 0.8,
      duration: 3,
    };
    expect(runPattern(w, b, step, SIM.DT)).toBe(false);
    expect(b.vx).toBe(0);
    expect(w.lasers.count).toBe(2);
    const l = w.lasers.active[0]!;
    expect(l.shape).toBe(0);
    expect(l.warmup).toBe(0.8);
    expect(l.length).toBe(30);
    expect(l.angle).toBeCloseTo(0, 9);
    expect(w.events.telegraph.count).toBe(2);
    for (let i = 0; i < Math.round(3.8 / SIM.DT) + 2; i++) stepLasers(w, SIM.DT);
    expect(w.lasers.count).toBe(0);
  });

  it('firewall: arc segments around the boss', () => {
    const { w, b } = setup();
    const step: AttackStep = {
      prim: 'firewall',
      segments: 4,
      radius: 10,
      arcDeg: 40,
      width: 1.2,
      damagePerS: 40,
      turnDegPerS: 35,
      warmup: 1,
      duration: 6,
    };
    const n = runToEnd(w, b, step);
    expect(n).toBeGreaterThanOrEqual(Math.round(7 / SIM.DT) - 1);
    expect(w.lasers.count).toBe(4);
    const l = w.lasers.active[0]!;
    expect(l.shape).toBe(1);
    expect(l.radius).toBe(10);
    expect(l.arcHalf).toBeCloseTo((20 * Math.PI) / 180, 9);
    stepLasers(w, 0.5);
    expect(l.warmup).toBeCloseTo(0.5, 9);
    expect(l.angle).toBeCloseTo(((35 * Math.PI) / 180) * 0.5, 9);
  });

  it('charge: telegraph, then dash toward the target damaging it once', () => {
    const { w, b } = setup();
    const step: AttackStep = { prim: 'charge', speed: 18, telegraph: 0.8, duration: 0.9, damage: 20 };
    placePlayer(w, 0, 0, 3);
    runPattern(w, b, step, SIM.DT);
    expect(b.vz).toBe(0);
    expect(w.events.telegraph.get(0).shape).toBe(1);
    const hp0 = w.players[0].hp;
    let hits = 0;
    for (let i = 0; i < 400; i++) {
      const before = w.players[0].hp;
      const done = runPattern(w, b, step, SIM.DT);
      b.x += b.vx * SIM.DT;
      b.z += b.vz * SIM.DT;
      if (w.players[0].hp < before) hits++;
      if (done) break;
    }
    expect(hits).toBe(1);
    expect(w.players[0].hp).toBe(hp0 - 20);
    expect(b.vz).toBe(0);
  });

  it('summon: spawns adds around the boss immediately; wait waits', () => {
    const { w, b } = setup();
    expect(runPattern(w, b, { prim: 'summon', kind: 'dart', count: 4, elite: false }, SIM.DT)).toBe(true);
    expect(w.enemies.count).toBe(4);
    expect(w.events.spawn.count).toBe(4);
    b.patternTimer = 0;
    const n = runToEnd(w, b, { prim: 'wait', duration: 1 });
    expect(Math.abs(n - 120)).toBeLessThanOrEqual(1);
  });
});

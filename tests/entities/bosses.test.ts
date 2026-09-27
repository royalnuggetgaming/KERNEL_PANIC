import { describe, expect, it } from 'vitest';
import type { WorldState } from '../../src/contracts/world';
import { BOSS_COMMON, BOSS_DEFS } from '../../src/config/bosses';
import { COOP, ECONOMY, SIM } from '../../src/config/tuning';
import {
  bossAlive,
  bossHpMul,
  phaseForFraction,
  raceWindow,
  spawnBoss,
  stepBoss,
} from '../../src/entities/bosses';
import { createTestWorld, placePlayer, stepSystem } from '../helpers/worldFixture';

function bossWorld(mode: 'coop' | 'solo' = 'coop', wave = 5): WorldState {
  const w = createTestWorld({ mode });
  w.run.wave = wave;
  w.run.phase = 'boss';
  w.run.waveDuration = BOSS_COMMON.ENRAGE_AT;
  w.run.waveTimer = BOSS_COMMON.ENRAGE_AT;
  placePlayer(w, 0, 0, 10);
  if (mode === 'coop') placePlayer(w, 1, 3, 10);
  return w;
}

function skipIntro(w: WorldState): void {
  for (const b of w.bosses) b.introTimer = 0;
}

function aliveParts(w: WorldState): number {
  let n = 0;
  for (const b of w.bosses) if (b.alive) n++;
  return n;
}

describe('spawnBoss', () => {
  it('uses the def HP with the 2P x1.6 multiplier and an intro with invulnerable players', () => {
    const solo = bossWorld('solo');
    spawnBoss(solo, 'forkBomb');
    expect(solo.bosses[0]!.hp).toBe(2400);
    const w = bossWorld('coop');
    spawnBoss(w, 'forkBomb');
    const b = w.bosses[0]!;
    expect(b.alive).toBe(true);
    expect(b.maxHp).toBeCloseTo(2400 * 1.6, 9);
    expect(b.introTimer).toBe(BOSS_COMMON.INTRO_TIME);
    expect(w.players[0].invulnUntil).toBeCloseTo(w.time + BOSS_COMMON.INTRO_TIME, 9);
    expect(bossAlive(w)).toBe(true);
    expect(w.events.boss.get(0).what).toBe('intro');
    expect(w.events.wave.get(0).what).toBe('bossSpawn');
  });

  it('spawns Race Condition as 2 twins of 2600 HP each', () => {
    const w = bossWorld('solo', 10);
    spawnBoss(w, 'raceCondition');
    expect(aliveParts(w)).toBe(2);
    expect(w.bosses[0]!.hp).toBe(2600);
    expect(w.bosses[1]!.hp).toBe(2600);
    expect(w.bosses[0]!.x).toBeLessThan(0);
    expect(w.bosses[1]!.x).toBeGreaterThan(0);
  });

  it('scales OVERFLOW bosses by the +12%/wave growth', () => {
    expect(bossHpMul(1, 15)).toBe(1);
    expect(bossHpMul(2, 10)).toBeCloseTo(1.6, 9);
    expect(bossHpMul(1, 20)).toBeCloseTo(Math.pow(1.12, 5), 9);
  });
});

describe('phases', () => {
  it('thresholds at 66% and 33%', () => {
    expect(phaseForFraction(1)).toBe(0);
    expect(phaseForFraction(0.67)).toBe(0);
    expect(phaseForFraction(0.66)).toBe(1);
    expect(phaseForFraction(0.34)).toBe(1);
    expect(phaseForFraction(0.33)).toBe(2);
    expect(phaseForFraction(0)).toBe(2);
  });

  it('Kernel changes phase when its HP crosses a threshold', () => {
    const w = bossWorld('solo', 15);
    spawnBoss(w, 'kernel');
    skipIntro(w);
    const b = w.bosses[0]!;
    stepSystem(w, stepBoss, 1);
    expect(b.phase).toBe(0);
    b.hp = b.maxHp * 0.6;
    stepSystem(w, stepBoss, 1);
    expect(b.phase).toBe(1);
    expect(b.patternStep).toBe(0);
    b.hp = b.maxHp * 0.3;
    stepSystem(w, stepBoss, 1);
    expect(b.phase).toBe(2);
    let phaseEvents = 0;
    for (let i = 0; i < w.events.wave.count; i++)
      if (w.events.wave.get(i).what === 'bossPhase') phaseEvents++;
    expect(phaseEvents).toBe(2);
  });

  it('does not act during the intro', () => {
    const w = bossWorld('solo', 15);
    spawnBoss(w, 'kernel');
    stepSystem(w, stepBoss, 10);
    expect(w.lasers.count).toBe(0);
    expect(w.enemyShots.count).toBe(0);
    expect(w.bosses[0]!.introTimer).toBeGreaterThan(0);
  });
});

describe('Fork Bomb', () => {
  it('splits 1 -> 2 at 66% and 2 -> 4 at 33%, each child taking half the parent HP', () => {
    const w = bossWorld('solo');
    spawnBoss(w, 'forkBomb');
    skipIntro(w);
    const b = w.bosses[0]!;
    b.hp = b.maxHp * 0.6;
    stepSystem(w, stepBoss, 1);
    expect(aliveParts(w)).toBe(2);
    expect(w.bosses[1]!.hp).toBeCloseTo(720, 6);
    expect(w.bosses[0]!.hp).toBeCloseTo(720, 6);
    expect(w.bosses[1]!.maxHp).toBeCloseTo(1200, 6);
    for (const p of w.bosses) if (p.alive) p.hp = p.maxHp * 0.3;
    stepSystem(w, stepBoss, 1);
    expect(aliveParts(w)).toBe(4);
    let total = 0;
    for (const p of w.bosses) total += p.hp;
    expect(total).toBeCloseTo(2400 * 0.3, 6);
    for (const p of w.bosses) expect(p.phase).toBe(2);
  });

  it('is defeated when every part dies: bossesKilled, drops, wave event, records reset', () => {
    const w = bossWorld('solo');
    spawnBoss(w, 'forkBomb');
    skipIntro(w);
    w.bosses[0]!.hp = 0;
    stepSystem(w, stepBoss, 1);
    expect(bossAlive(w)).toBe(false);
    expect(w.run.bossesKilled).toBe(1);
    let dropped = 0;
    for (let i = 0; i < w.pickups.count; i++) dropped += w.pickups.active[i]!.value;
    expect(dropped).toBe(ECONOMY.BOSS_SHARDS);
    let dead = false;
    for (let i = 0; i < w.events.wave.count; i++) if (w.events.wave.get(i).what === 'bossDead') dead = true;
    expect(dead).toBe(true);
    expect(w.bosses[0]!.maxHp).toBe(0);
  });
});

describe('Race Condition sync window', () => {
  it('co-op: a lone kill respawns at 50% after 3 s', () => {
    expect(raceWindow(2)).toBe(COOP.RACE_WINDOW_COOP);
    const w = bossWorld('coop', 10);
    spawnBoss(w, 'raceCondition');
    skipIntro(w);
    const [a] = w.bosses;
    a!.hp = 0;
    stepSystem(w, stepBoss, 1);
    expect(a!.alive).toBe(false);
    expect(bossAlive(w)).toBe(true);
    stepSystem(w, stepBoss, Math.round(3 / SIM.DT) - 5);
    expect(a!.alive).toBe(false);
    stepSystem(w, stepBoss, 10);
    expect(a!.alive).toBe(true);
    expect(a!.hp).toBeCloseTo(a!.maxHp * 0.5, 6);
    expect(a!.phase).toBe(1);
    expect(w.run.bossesKilled).toBe(0);
  });

  it('co-op: both twins dying within 3 s defeats the boss', () => {
    const w = bossWorld('coop', 10);
    spawnBoss(w, 'raceCondition');
    skipIntro(w);
    w.bosses[0]!.hp = 0;
    stepSystem(w, stepBoss, Math.round(2.5 / SIM.DT));
    w.bosses[1]!.hp = 0;
    stepSystem(w, stepBoss, 1);
    expect(bossAlive(w)).toBe(false);
    expect(w.run.bossesKilled).toBe(1);
  });

  it('solo: the window is 6 s', () => {
    expect(raceWindow(1)).toBe(COOP.RACE_WINDOW_SOLO);
    const w = bossWorld('solo', 10);
    spawnBoss(w, 'raceCondition');
    skipIntro(w);
    w.bosses[1]!.hp = 0;
    stepSystem(w, stepBoss, Math.round(5 / SIM.DT));
    expect(w.bosses[1]!.alive).toBe(false);
    w.bosses[0]!.hp = 0;
    stepSystem(w, stepBoss, 1);
    expect(bossAlive(w)).toBe(false);
    expect(w.run.bossesKilled).toBe(1);
  });

  it('both twins dying on the same tick defeats the boss', () => {
    const w = bossWorld('coop', 10);
    spawnBoss(w, 'raceCondition');
    skipIntro(w);
    w.bosses[0]!.hp = 0;
    w.bosses[1]!.hp = 0;
    stepSystem(w, stepBoss, 1);
    expect(bossAlive(w)).toBe(false);
  });
});

describe('enrage', () => {
  it('enrages every part when the 150 s boss timer runs out and speeds patterns up', () => {
    const w = bossWorld('coop', 10);
    spawnBoss(w, 'raceCondition');
    skipIntro(w);
    stepSystem(w, stepBoss, 1);
    expect(w.bosses[0]!.enraged).toBe(false);
    w.run.waveTimer = 0;
    stepSystem(w, stepBoss, 1);
    expect(w.bosses[0]!.enraged).toBe(true);
    expect(w.bosses[1]!.enraged).toBe(true);
    const t = w.bosses[0]!.patternTimer;
    stepSystem(w, stepBoss, 1);
    expect(w.bosses[0]!.patternTimer - t).toBeCloseTo(SIM.DT * BOSS_COMMON.ENRAGE_RATE_MUL, 9);
  });

  it('bosses move and attack over time without leaving the arena', () => {
    const w = bossWorld('coop', 15);
    spawnBoss(w, 'kernel');
    stepSystem(w, stepBoss, Math.round(20 / SIM.DT));
    const b = w.bosses[0]!;
    expect(Math.hypot(b.x, b.z)).toBeLessThanOrEqual(32 - b.radius + 1e-9);
    expect(w.events.enemyShot.count + w.lasers.count).toBeGreaterThan(0);
    expect(b.patternStep).toBeGreaterThan(0);
    expect(BOSS_DEFS.kernel.phases[0].steps.length).toBeGreaterThan(b.patternStep);
  });
});

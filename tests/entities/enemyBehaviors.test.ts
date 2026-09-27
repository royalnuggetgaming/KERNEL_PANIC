import { describe, expect, it } from 'vitest';
import type { WorldState } from '../../src/contracts/world';
import { ENEMY_DEFS } from '../../src/config/enemies';
import { SIM } from '../../src/config/tuning';
import { AI_STATE, stepEnemyBehavior } from '../../src/entities/enemyBehaviors';
import { stepEnemies } from '../../src/entities/enemies';
import { addTestEnemy, createTestWorld, placePlayer, stepSystem } from '../helpers/worldFixture';

function combatWorld(mode: 'coop' | 'solo' | 'versus' = 'coop'): WorldState {
  const w = createTestWorld({ mode });
  w.run.phase = 'combat';
  w.grid.begin();
  w.grid.build();
  placePlayer(w, 0, 0, 0);
  if (mode !== 'solo') placePlayer(w, 1, 25, 25);
  return w;
}

function ticks(seconds: number): number {
  return Math.round(seconds / SIM.DT);
}

describe('seek (Shard / Fork)', () => {
  it('chases the nearest living player at its speed', () => {
    const w = combatWorld();
    const e = addTestEnemy(w, 'shard', 0, 10, { yaw: Math.PI, dirX: 0, dirZ: -1 });
    stepSystem(w, stepEnemies, 60);
    expect(e.z).toBeLessThan(10);
    expect(Math.hypot(e.vx, e.vz)).toBeCloseTo(ENEMY_DEFS.shard.speed, 5);
    expect(e.ai).toBe(AI_STATE.SEEK);
  });

  it('turns at most turnRate rad/s', () => {
    const w = combatWorld();
    // Facing away (+Z) from a player behind it.
    const e = addTestEnemy(w, 'shard', 0, 10, { yaw: 0 });
    stepEnemyBehavior(w, e, SIM.DT);
    expect(Math.abs(e.yaw)).toBeCloseTo(ENEMY_DEFS.shard.params.turnRate * SIM.DT, 6);
  });

  it('ignores downed players and drifts to the centre when nobody is targetable', () => {
    const w = combatWorld();
    w.players[0].life = 'downed';
    w.players[1].life = 'downed';
    const e = addTestEnemy(w, 'fork', 10, 0);
    stepSystem(w, stepEnemies, 240);
    expect(Math.hypot(e.x, e.z)).toBeLessThan(10);
  });

  it('retargets to the other player when its target goes down', () => {
    const w = combatWorld();
    placePlayer(w, 1, 5, 0);
    const e = addTestEnemy(w, 'shard', 0, 3, { target: 0 });
    w.players[0].life = 'downed';
    stepSystem(w, stepEnemies, 1);
    expect(e.target).toBe(1);
  });

  it('is frozen outside combat/boss phases', () => {
    const w = combatWorld();
    w.run.phase = 'purge';
    const e = addTestEnemy(w, 'shard', 0, 10);
    stepSystem(w, stepEnemies, 30);
    expect(e.z).toBe(10);
    expect(e.vx).toBe(0);
  });
});

describe('telegraph-lunge (Dart)', () => {
  it('telegraphs 0.6 s, lunges 0.45 s at lunge speed, recovers 0.9 s, then seeks again', () => {
    const w = combatWorld();
    const p = ENEMY_DEFS.dart.params;
    const e = addTestEnemy(w, 'dart', 0, 8);
    stepSystem(w, stepEnemies, 1);
    expect(e.ai).toBe(AI_STATE.TELEGRAPH);
    expect(w.events.telegraph.count).toBe(1);
    const tg = w.events.telegraph.get(0);
    expect(tg.shape).toBe(1);
    expect(tg.duration).toBe(p.telegraph);
    expect(tg.size).toBeCloseTo(p.lungeSpeed * p.lungeTime, 6);
    expect(tg.dirZ).toBeCloseTo(-1, 6);
    const z0 = e.z;
    stepSystem(w, stepEnemies, ticks(p.telegraph) - 2);
    expect(e.ai).toBe(AI_STATE.TELEGRAPH);
    expect(e.z).toBe(z0);
    stepSystem(w, stepEnemies, 3);
    expect(e.ai).toBe(AI_STATE.LUNGE);
    expect(Math.hypot(e.vx, e.vz)).toBeCloseTo(p.lungeSpeed, 5);
    stepSystem(w, stepEnemies, ticks(p.lungeTime));
    expect(e.ai).toBe(AI_STATE.RECOVER);
    stepSystem(w, stepEnemies, ticks(p.recover) - 2);
    expect(e.ai).toBe(AI_STATE.RECOVER);
    stepSystem(w, stepEnemies, 3);
    expect([AI_STATE.SEEK, AI_STATE.TELEGRAPH]).toContain(e.ai);
  });

  it('seeks while outside trigger range', () => {
    const w = combatWorld();
    const e = addTestEnemy(w, 'dart', 0, 20);
    stepSystem(w, stepEnemies, 10);
    expect(e.ai).toBe(AI_STATE.SEEK);
    expect(w.events.telegraph.count).toBe(0);
  });

  it('finishes a committed lunge even when the target goes down', () => {
    const w = combatWorld();
    const e = addTestEnemy(w, 'dart', 0, 8, { ai: AI_STATE.LUNGE, aiTimer: 0.2, dirX: 0, dirZ: -1 });
    w.players[0].life = 'downed';
    w.players[1].life = 'downed';
    stepEnemyBehavior(w, e, SIM.DT);
    expect(e.ai).toBe(AI_STATE.LUNGE);
    expect(e.vz).toBeCloseTo(-ENEMY_DEFS.dart.params.lungeSpeed, 6);
  });
});

describe('ring-burst (Spiker)', () => {
  it('approaches to keep range, holds, then fires a telegraphed ring every interval', () => {
    const w = combatWorld();
    const p = ENEMY_DEFS.spiker.params;
    const e = addTestEnemy(w, 'spiker', 0, 11, { shotTimer: 0.5 });
    stepSystem(w, stepEnemies, 1);
    expect(e.ai).toBe(AI_STATE.HOLD);
    stepSystem(w, stepEnemies, ticks(0.5));
    expect(e.ai).toBe(AI_STATE.CHARGE);
    expect(w.events.telegraph.count).toBe(1);
    expect(w.events.telegraph.get(0).shape).toBe(0);
    expect(w.enemyShots.count).toBe(0);
    stepSystem(w, stepEnemies, ticks(p.pulse) + 1);
    expect(w.enemyShots.count).toBe(p.bullets);
    expect(w.events.enemyShot.count).toBe(1);
    expect(e.shotTimer).toBeGreaterThan(p.interval - 0.1);
    const s = w.enemyShots.active[0]!;
    expect(Math.hypot(s.vx, s.vz)).toBeCloseTo(ENEMY_DEFS.spiker.shotSpeed, 5);
    expect(s.damage).toBe(ENEMY_DEFS.spiker.shotDamage);
  });

  it('seeks when far and does not fire out of range', () => {
    const w = combatWorld();
    const e = addTestEnemy(w, 'spiker', 0, 28, { shotTimer: 0, yaw: Math.PI });
    stepSystem(w, stepEnemies, 5);
    expect(e.ai).toBe(AI_STATE.SEEK);
    expect(w.enemyShots.count).toBe(0);
    expect(e.z).toBeLessThan(28);
  });
});

describe('shielded Warden', () => {
  it('fires a 3-shot volley only when the target is inside its front arc', () => {
    const w = combatWorld();
    const p = ENEMY_DEFS.warden.params;
    // Facing +Z, player behind it at the origin: no volley.
    const e = addTestEnemy(w, 'warden', 0, 10, { yaw: 0, shotTimer: 0 });
    stepEnemyBehavior(w, e, SIM.DT);
    expect(w.enemyShots.count).toBe(0);
    // Turning is limited by turnRate.
    expect(Math.abs(e.yaw)).toBeCloseTo(p.turnRate * SIM.DT, 6);
    e.yaw = Math.PI;
    stepEnemyBehavior(w, e, SIM.DT);
    expect(w.enemyShots.count).toBe(p.volleyShots);
    expect(e.shotTimer).toBe(p.volleyInterval);
  });

  it('stops advancing when close', () => {
    const w = combatWorld();
    const e = addTestEnemy(w, 'warden', 0, 2, { yaw: Math.PI, shotTimer: 5 });
    stepEnemyBehavior(w, e, SIM.DT);
    expect(e.vx).toBe(0);
    expect(e.vz).toBeCloseTo(0, 9);
  });
});

describe('Leech latch', () => {
  function beamWorld(): WorldState {
    const w = combatWorld();
    placePlayer(w, 1, 10, 0);
    const l = w.link;
    l.active = true;
    l.ax = 0;
    l.az = 0;
    l.bx = 10;
    l.bz = 0;
    l.length = 10;
    return w;
  }

  it('seeks the closest point of the beam', () => {
    const w = beamWorld();
    const e = addTestEnemy(w, 'leech', 5, 8, { yaw: Math.PI });
    stepSystem(w, stepEnemies, 30);
    expect(e.z).toBeLessThan(8);
    expect(Math.abs(e.x - 5)).toBeLessThan(0.5);
  });

  it('holds its spot on the beam while latched and follows it', () => {
    const w = beamWorld();
    const e = addTestEnemy(w, 'leech', 4, 0.5, { latched: 1 });
    w.link.latchedCount = 1;
    stepSystem(w, stepEnemies, 1);
    expect(e.ai).toBe(AI_STATE.LATCHED);
    expect(e.aiTimer).toBeCloseTo(0.4, 6);
    w.link.az = 2;
    w.link.bz = 2;
    stepSystem(w, stepEnemies, 60);
    expect(e.x).toBeCloseTo(4, 3);
    expect(e.z).toBeCloseTo(2, 3);
  });

  it('unlatches when the beam disappears and tumbles off when shed', () => {
    const w = beamWorld();
    const e = addTestEnemy(w, 'leech', 4, 0, { latched: 1 });
    w.link.latchedCount = 1;
    stepSystem(w, stepEnemies, 1);
    w.link.active = false;
    stepSystem(w, stepEnemies, 1);
    expect(e.latched).toBe(0);
    expect(w.link.latchedCount).toBe(0);
    expect(e.ai).toBe(AI_STATE.SEEK);

    const w2 = beamWorld();
    const e2 = addTestEnemy(w2, 'leech', 4, 0, { latched: 1 });
    stepSystem(w2, stepEnemies, 1);
    e2.latched = 0; // dash shed
    stepSystem(w2, stepEnemies, 1);
    expect(e2.ai).toBe(AI_STATE.RECOVER);
    stepSystem(w2, stepEnemies, ticks(0.7));
    expect(e2.ai).toBe(AI_STATE.SEEK);
  });

  it('chases players in versus (no beam)', () => {
    const w = combatWorld('versus');
    w.link.active = true;
    const e = addTestEnemy(w, 'leech', 0, 10, { yaw: Math.PI });
    stepSystem(w, stepEnemies, 10);
    expect(e.z).toBeLessThan(10);
    expect(e.latched).toBe(0);
  });
});

describe('separation', () => {
  it('pushes overlapping enemies apart using grid neighbours', () => {
    const w = combatWorld();
    w.players[0].life = 'downed';
    w.players[1].life = 'downed';
    const a = addTestEnemy(w, 'shard', 10, 0);
    const b = addTestEnemy(w, 'shard', 10.2, 0);
    w.grid.begin();
    w.grid.add(a.slot, a.x, a.z, a.radius);
    w.grid.add(b.slot, b.x, b.z, b.radius);
    w.grid.build();
    stepSystem(w, stepEnemies, 1);
    expect(b.x - a.x).toBeGreaterThan(0.2);
  });
});

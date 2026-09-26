import { describe, expect, it } from 'vitest';
import type { EnemyKind } from '../../src/contracts/ids';
import { CORRUPTED, ENEMY_DEFS } from '../../src/config/enemies';
import { CAPACITY } from '../../src/config/tuning';
import { WAVES } from '../../src/config/waves';
import {
  clearEnemies,
  resolveEnemyDeaths,
  spawnEnemy,
  spawnPendingEnemies,
  stepEnemies,
} from '../../src/entities/enemies';
import { createTestWorld, stepSystem } from '../helpers/worldFixture';

function queueDeath(
  w: ReturnType<typeof createTestWorld>,
  slot: number,
  kind: EnemyKind,
  splitGen: number,
): void {
  const e = w.enemies.atSlot(slot);
  e.dying = true;
  const r = w.deathQueue.push();
  r.slot = slot;
  r.kind = kind;
  r.elite = e.elite;
  r.x = e.x;
  r.z = e.z;
  r.vx = 0;
  r.vz = 0;
  r.by = 0;
  r.splitGen = splitGen;
  r.seed = e.seed;
}

describe('spawnEnemy', () => {
  it('applies the wave HP multiplier and the CORRUPTED multiplier', () => {
    const w = createTestWorld();
    w.run.enemyHpMul = 1.5;
    const e = spawnEnemy(w, 'warden', 0, -20, false, 0)!;
    expect(e.hp).toBeCloseTo(ENEMY_DEFS.warden.hp * 1.5, 9);
    expect(e.maxHp).toBe(e.hp);
    const el = spawnEnemy(w, 'warden', 0, -20, true, 0)!;
    expect(el.hp).toBeCloseTo(ENEMY_DEFS.warden.hp * 1.5 * CORRUPTED.hpMul, 9);
    expect(el.elite).toBe(true);
    expect(e.dying).toBe(false);
    expect(e.age).toBe(0);
  });

  it('faces the centre, clamps into the arena and targets the nearest player', () => {
    const w = createTestWorld();
    const e = spawnEnemy(w, 'shard', 100, 0, false, 0)!;
    expect(Math.hypot(e.x, e.z)).toBeLessThanOrEqual(32);
    expect(e.dirX).toBeLessThan(0);
    // P2 spawns at x = +3 in co-op.
    expect(e.target).toBe(1);
  });

  it('returns null when the pool (180 cap) is full', () => {
    const w = createTestWorld();
    for (let i = 0; i < CAPACITY.enemies; i++) expect(spawnEnemy(w, 'shard', 0, 0, false, 0)).not.toBeNull();
    expect(spawnEnemy(w, 'shard', 0, 0, false, 0)).toBeNull();
    expect(w.enemies.count).toBe(WAVES.MAX_ALIVE);
  });
});

describe('pending spawns', () => {
  it('spawn after the telegraph and wait (deferred) while the pool is full', () => {
    const w = createTestWorld();
    w.run.phase = 'combat';
    const p = w.director.pending.spawn()!;
    Object.assign(p, { kind: 'dart', x: 0, z: -25, delay: WAVES.TELEGRAPH, elite: false, portal: 4 });
    stepSystem(w, stepEnemies, 95);
    expect(w.enemies.count).toBe(0);
    stepSystem(w, stepEnemies, 2);
    expect(w.enemies.count).toBe(1);
    expect(w.director.pending.count).toBe(0);
    expect(w.events.spawn.count).toBe(1);

    const w2 = createTestWorld();
    for (let i = 0; i < CAPACITY.enemies; i++) spawnEnemy(w2, 'shard', 0, 0, false, 0);
    const q = w2.director.pending.spawn()!;
    Object.assign(q, { kind: 'shard', x: 0, z: -25, delay: 0.01, elite: false, portal: 4 });
    spawnPendingEnemies(w2, 0.02);
    expect(w2.director.pending.count).toBe(1);
    expect(w2.director.deferred).toBe(1);
    w2.enemies.despawn(w2.enemies.active[0]!);
    spawnPendingEnemies(w2, 0.02);
    expect(w2.director.pending.count).toBe(0);
    expect(w2.director.deferred).toBe(0);
  });

  it('do not advance outside combat', () => {
    const w = createTestWorld();
    w.run.phase = 'countdown';
    const p = w.director.pending.spawn()!;
    Object.assign(p, { kind: 'dart', x: 0, z: -25, delay: 0.1, elite: false, portal: 4 });
    stepSystem(w, stepEnemies, 60);
    expect(w.enemies.count).toBe(0);
  });
});

describe('resolveEnemyDeaths', () => {
  it('despawns dying enemies and splits an original Fork into 2 Shards', () => {
    const w = createTestWorld();
    const f = spawnEnemy(w, 'fork', 0, -10, false, 0)!;
    queueDeath(w, f.slot, 'fork', 0);
    resolveEnemyDeaths(w);
    expect(w.deathQueue.count).toBe(0);
    expect(w.enemies.count).toBe(2);
    for (let i = 0; i < w.enemies.count; i++) {
      const c = w.enemies.active[i]!;
      expect(c.kind).toBe('shard');
      expect(c.splitGen).toBe(1);
      expect(Math.hypot(c.x - 0, c.z + 10)).toBeCloseTo(0.8, 5);
    }
    expect(w.events.spawn.count).toBe(2);
  });

  it('does not split children again and unlatches Leeches', () => {
    const w = createTestWorld();
    const f = spawnEnemy(w, 'fork', 0, -10, false, 1)!;
    const l = spawnEnemy(w, 'leech', 5, 0, false, 0)!;
    l.latched = 1;
    w.link.latchedCount = 1;
    queueDeath(w, f.slot, 'fork', 1);
    queueDeath(w, l.slot, 'leech', 0);
    resolveEnemyDeaths(w);
    expect(w.enemies.count).toBe(0);
    expect(w.link.latchedCount).toBe(0);
  });

  it('clearEnemies empties enemies and pending spawns', () => {
    const w = createTestWorld();
    spawnEnemy(w, 'shard', 0, 0, false, 0);
    w.director.pending.spawn();
    w.link.latchedCount = 2;
    clearEnemies(w);
    expect(w.enemies.count).toBe(0);
    expect(w.director.pending.count).toBe(0);
    expect(w.link.latchedCount).toBe(0);
  });
});

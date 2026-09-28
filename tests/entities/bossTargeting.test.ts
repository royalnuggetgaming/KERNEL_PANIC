/**
 * Regression (critic v2): Micro-Missiles (card) and the Patch Drone turret (special) acquire targets with
 * projectiles.nearestEnemy, which scans only the enemy pool. With only the boss on the field they never fire,
 * so a player who bought Micro-Missiles gets nothing during boss phases without minions.
 */
import { expect, it } from 'vitest';
import { CARD_IDS } from '../../src/contracts/ids';
import { spawnBoss } from '../../src/entities/bosses';
import { stepCardEffects } from '../../src/entities/cardEffects';
import { NEAREST, bossHomingHandle, nearestTarget, stepProjectiles } from '../../src/entities/projectiles';
import { NO_HANDLE } from '../../src/contracts/ids';
import { PROJECTILE_KINDS } from '../../src/contracts/sim';
import {
  addTestEnemy,
  addTestPlayerShot,
  createTestWorld,
  placePlayer,
  stepSystem,
} from '../helpers/worldFixture';

it('Micro-Missiles fire at a boss when it is the only target', () => {
  const w = createTestWorld({ seed: 3, mode: 'solo' });
  w.run.wave = 5;
  w.run.phase = 'boss';
  spawnBoss(w, 'forkBomb');
  const b = w.bosses[0]!;
  b.introTimer = 0;
  placePlayer(w, 0, b.x, b.z - 10);
  const p = w.players[0];
  const bit = CARD_IDS.indexOf('microMissiles');
  p.cardStacks[bit] = 1;
  p.cardMask |= 1 << bit;
  expect(w.enemies.count).toBe(0);
  const shotsBefore = w.playerShots.count;
  stepSystem(w, stepCardEffects, 120 * 3); // 3 s = 2 missile intervals
  expect(w.playerShots.count).toBeGreaterThan(shotsBefore);
});

it('(control) the same setup fires Micro-Missiles at a normal enemy', () => {
  const w = createTestWorld({ seed: 3, mode: 'solo' });
  addTestEnemy(w, 'shard', 0, 10);
  placePlayer(w, 0, 0, 0);
  const p = w.players[0];
  const bit = CARD_IDS.indexOf('microMissiles');
  p.cardStacks[bit] = 1;
  p.cardMask |= 1 << bit;
  stepSystem(w, stepCardEffects, 120 * 3);
  expect(w.playerShots.count).toBeGreaterThan(0);
});

function bossWorld(): ReturnType<typeof createTestWorld> {
  const w = createTestWorld({ seed: 3, mode: 'solo' });
  w.run.wave = 5;
  w.run.phase = 'boss';
  spawnBoss(w, 'forkBomb');
  w.bosses[0]!.introTimer = 0;
  return w;
}

it('nearestTarget includes living boss parts past their intro and returns a boss homing handle', () => {
  const w = bossWorld();
  const b = w.bosses[0]!;
  expect(nearestTarget(w, b.x, b.z - 5, 50)).toBe(bossHomingHandle(0));
  expect(NEAREST.x).toBe(b.x);
  expect(NEAREST.z).toBe(b.z);
  b.introTimer = 1;
  expect(nearestTarget(w, b.x, b.z - 5, 50)).toBe(NO_HANDLE);
  b.introTimer = 0;
  b.alive = false;
  expect(nearestTarget(w, b.x, b.z - 5, 50)).toBe(NO_HANDLE);
});

it('a missile whose target is gone re-acquires the boss and turns toward it', () => {
  const w = bossWorld();
  const b = w.bosses[0]!;
  // Flying away from the boss (+x) with a stale enemy handle.
  const s = addTestPlayerShot(w, 0, b.x, b.z - 10, 20, 0, 10, {
    kind: PROJECTILE_KINDS.missile,
    homing: 12345,
    life: 5,
  });
  stepSystem(w, stepProjectiles, 1);
  expect(s.homing).toBe(bossHomingHandle(0));
  stepSystem(w, stepProjectiles, 30);
  expect(s.vz).toBeGreaterThan(0); // now heading toward the boss (+z)
});

it('a Blink Swarm mine seeks a boss in range', () => {
  const w = bossWorld();
  const b = w.bosses[0]!;
  const s = addTestPlayerShot(w, 0, b.x, b.z - b.radius - 1, 0, 0, 10, {
    kind: PROJECTILE_KINDS.mine,
    life: 5,
  });
  stepSystem(w, stepProjectiles, 1);
  expect(s.homing).toBe(bossHomingHandle(0));
  expect(s.vz).toBeGreaterThan(0);
});

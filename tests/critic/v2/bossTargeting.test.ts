/**
 * Critic v2: Micro-Missiles (card) and the Patch Drone turret (special) acquire targets with
 * projectiles.nearestEnemy, which scans only the enemy pool. With only the boss on the field they never fire,
 * so a player who bought Micro-Missiles gets nothing during boss phases without minions.
 */
import { expect, it } from 'vitest';
import { CARD_IDS } from '../../../src/contracts/ids';
import { spawnBoss } from '../../../src/entities/bosses';
import { stepCardEffects } from '../../../src/entities/cardEffects';
import { addTestEnemy, createTestWorld, placePlayer, stepSystem } from '../../helpers/worldFixture';

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

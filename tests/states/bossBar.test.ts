/**
 * Critic v2: the HUD boss bar sums hp / maxHp over *alive* parts only, so when one Fork Bomb part (or one Race
 * Condition twin) dies the bar jumps back UP: the dead part's max HP leaves the denominator.
 */
import { expect, it } from 'vitest';
import { HudVmWriter } from '../../src/states/hudViewModel';
import { THEMES } from '../../src/themes/registry';
import { createTestWorld } from '../helpers/worldFixture';

it('killing one Fork Bomb part never raises the boss HP bar', () => {
  const w = createTestWorld({ seed: 1, mode: 'coop' });
  // Four gen-2 parts of 1000 max HP each: 100, 300, 300, 300 left.
  const hp = [100, 300, 300, 300];
  for (let i = 0; i < 4; i++) {
    const b = w.bosses[i]!;
    b.id = 'forkBomb';
    b.alive = true;
    b.maxHp = 1000;
    b.hp = hp[i]!;
    b.introTimer = 0;
    b.deathTime = -1;
  }
  const hud = new HudVmWriter(THEMES.kernelPanic);
  const before = hud.write(w, null).boss.hpFrac; // 1000 / 4000 = 0.25
  // Part 0 dies (bosses.ts: alive = false, deathTime set, maxHp kept until the whole boss is defeated).
  w.bosses[0]!.hp = 0;
  w.bosses[0]!.alive = false;
  w.bosses[0]!.deathTime = 1;
  const after = hud.write(w, null).boss.hpFrac; // 900 / 3000 = 0.30
  expect(before).toBeCloseTo(0.25);
  expect(after).toBeLessThanOrEqual(before);
});

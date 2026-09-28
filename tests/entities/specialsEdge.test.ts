/** Special edge cases found while bug-checking v2 (phase transitions, SUDO repeats, arena edge, ready cue). */
import { describe, expect, it } from 'vitest';
import type { PlayerIntent } from '../../src/contracts/input';
import { SPECIALS, railLength } from '../../src/config/specials';
import { ARENA, OVERDRIVE, SIM } from '../../src/config/tuning';
import { CARD_BIT } from '../../src/entities/cardBits';
import { stepSpecials } from '../../src/entities/specials';
import { stepCollision } from '../../src/sim/collision';
import { createIntents } from '../helpers/scriptedIntents';
import {
  addTestEnemy,
  addTestEnemyShot,
  createTestWorld,
  placePlayer,
  stepSystem,
} from '../helpers/worldFixture';

type Vehicle = 'lancer' | 'bulwark' | 'specter' | 'tinker';

function charged(vehicle: Vehicle, mode: 'solo' | 'coop' | 'versus' = 'solo') {
  const w = createTestWorld({ mode, vehicles: [vehicle, vehicle] });
  w.run.phase = 'combat';
  w.players[0].overdrive = OVERDRIVE.MAX;
  return w;
}

function press(patch: Partial<PlayerIntent> = {}) {
  const it = createIntents();
  Object.assign(it[0], patch, { specialPressed: true });
  return it;
}

function readyEvents(w: ReturnType<typeof createTestWorld>): number {
  let n = 0;
  for (let i = 0; i < w.events.player.count; i++) if (w.events.player.get(i).what === 'specialReady') n++;
  return n;
}

describe('specials across wave phases', () => {
  it('cannot be fired during the wave countdown, and the meter is kept (was: spent on an empty arena)', () => {
    const w = charged('lancer');
    w.run.phase = 'countdown';
    stepSystem(w, stepSpecials, 1, press());
    expect(w.players[0].special.active).toBe(false);
    expect(w.players[0].overdrive).toBe(OVERDRIVE.MAX);
    w.run.phase = 'combat';
    stepSystem(w, stepSpecials, 1, press());
    expect(w.players[0].special.active).toBe(true);
  });

  it('a running drone/dome ends when the next wave counts down (no carry-over through the shop)', () => {
    const w = charged('tinker');
    stepSystem(w, stepSpecials, 1, press());
    expect(w.players[0].special.active).toBe(true);
    w.run.phase = 'countdown';
    stepSystem(w, stepSpecials, 1);
    expect(w.players[0].special.active).toBe(false);
    expect(w.players[0].special.timer).toBe(0);
  });

  it('a SUDO repeat is dropped once the wave has ended (was: fired into the clear outro)', () => {
    const w = charged('bulwark');
    w.players[0].cardStacks[CARD_BIT.sudo] = 1;
    stepSystem(w, stepSpecials, 1, press());
    expect(w.players[0].special.pendingCasts).toBe(1);
    w.run.phase = 'clearOutro';
    w.events.special.clear();
    stepSystem(w, stepSpecials, Math.ceil(SPECIALS.firewall.duration * SIM.HZ) + 2);
    expect(w.events.special.count).toBe(0);
    expect(w.players[0].special.active).toBe(false);
    expect(w.players[0].special.pendingCasts).toBe(0);
  });
});

describe('specialReady cue', () => {
  it('fires once when the meter fills, again only after it was spent and refilled', () => {
    const w = charged('lancer');
    w.players[0].overdrive = 50;
    stepSystem(w, stepSpecials, 1);
    expect(readyEvents(w)).toBe(0);
    w.players[0].overdrive = OVERDRIVE.MAX;
    stepSystem(w, stepSpecials, 3);
    expect(readyEvents(w)).toBe(1);
    stepSystem(w, stepSpecials, 1, press());
    stepSystem(w, stepSpecials, 40);
    w.players[0].overdrive = OVERDRIVE.MAX;
    stepSystem(w, stepSpecials, 1);
    expect(readyEvents(w)).toBe(2);
  });
});

describe('arena edge', () => {
  it('Railburst stops at the wall: the hit segment is the drawn one', () => {
    const w = charged('lancer');
    const p = w.players[0];
    placePlayer(w, 0, 0, 25);
    p.aimX = 0;
    p.aimZ = 1;
    const len = railLength(0, 25, 0, 1);
    expect(len).toBeCloseTo(ARENA.RADIUS - 25, 9);
    const inside = addTestEnemy(w, 'shard', 0, 30);
    stepSystem(w, stepSpecials, 1, press());
    expect(inside.hp).toBeLessThan(inside.maxHp);
  });

  it('Blink at the wall lands inside the arena, straight or diagonal', () => {
    for (const [mx, mz] of [
      [0, -1],
      [0.7071, -0.7071],
      [0, 0],
    ] as const) {
      const w = charged('specter');
      const p = w.players[0];
      placePlayer(w, 0, 0, -ARENA.RADIUS + 1);
      p.aimX = 0;
      p.aimZ = -1;
      stepSystem(w, stepSpecials, 1, press({ moveX: mx, moveZ: mz }));
      expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(ARENA.RADIUS - p.radius + 1e-9);
      expect(p.prevX).toBe(p.x);
    }
  });
});

describe('Firewall covers the partner', () => {
  it('deletes enemy bullets next to a partner standing inside the dome', () => {
    const w = charged('bulwark', 'coop');
    placePlayer(w, 0, 0, 0);
    placePlayer(w, 1, 2, 0);
    stepSystem(w, stepSpecials, 1, press());
    addTestEnemyShot(w, 3, 0, 0, 0);
    stepSystem(w, stepCollision, 1);
    expect(w.enemyShots.count).toBe(0);
  });
});

/**
 * Shop to sim (patch cards): every patch card bought through the REAL RunSession -> ShopModel ->
 * applyShopResults path changes observable sim behaviour as specified (A/B lab pairs on the same seed, see
 * shopLab.ts).
 */
import { describe, expect, it } from 'vitest';
import type { CardId } from '../../src/contracts/ids';
import type { PlayerIntent } from '../../src/contracts/input';
import type { WorldState } from '../../src/contracts/world';
import { CARD_PARAMS, cardDef } from '../../src/config/cards';
import { OVERDRIVE } from '../../src/config/tuning';
import { comboScoreMul } from '../../src/entities/combo';
import type { RunSession } from '../../src/sim/RunSession';
import { createIntents, resetIntent } from '../helpers/scriptedIntents';
import { addTestEnemy, addTestEnemyShot, addTestPickup } from '../helpers/worldFixture';
import { buyCardTx, firstVolley, pair, run, shotsFired } from './shopLab';

describe('shop to sim: each patch card bought through RunSession changes the sim', () => {
  const stacks = (s: RunSession, id: CardId): number => s.state.players[0].cardStacks[cardDef(id).bit]!;

  it('Split Shot: +2 side bullets, -15% damage', () => {
    const [a, b] = pair(buyCardTx('splitShot'));
    expect(stacks(a, 'splitShot')).toBe(1);
    const va = firstVolley(a);
    const vb = firstVolley(b);
    expect(va.count).toBe(vb.count + 2);
    expect(va.damage / vb.damage).toBeCloseTo(0.85, 6);
  });

  it('Overdrive Battery: +25% special charge', () => {
    const [a] = pair(buyCardTx('overdriveBattery'));
    expect(a.state.players[0].stats.specialChargeMul).toBeCloseTo(1.25, 9);
  });

  it('Bounty: +20% Shards on pickup', () => {
    const [a, b] = pair(buyCardTx('bounty'));
    for (const s of [a, b]) addTestPickup(s.state, -4, 0, 5);
    const wa = a.state.run.wallets[0];
    const wb = b.state.run.wallets[0];
    run(a, 2, () => {});
    run(b, 2, () => {});
    expect(a.state.run.wallets[0] - wa).toBe(6);
    expect(b.state.run.wallets[0] - wb).toBe(5);
  });

  it('Pierce: fired projectiles pierce once more', () => {
    const [a, b] = pair(buyCardTx('pierce'));
    expect(firstVolley(a).pierce).toBe(firstVolley(b).pierce + 1);
  });

  it('Ricochet: fired projectiles bounce once more', () => {
    const [a, b] = pair(buyCardTx('ricochet'));
    expect(firstVolley(a).bounces).toBe(firstVolley(b).bounces + 1);
  });

  it('Double Buffer: +1 dash charge usable in the sim', () => {
    const [a, b] = pair(buyCardTx('doubleBuffer'));
    expect(a.state.players[0].stats.dashCharges).toBe(b.state.players[0].stats.dashCharges + 1);
    // Let charges refill, then dash twice back to back.
    run(a, 600, () => {});
    run(b, 600, () => {});
    const dashes = (s: RunSession): number => {
      let n = 0;
      for (let t = 0; t < 40; t++) {
        const before = s.state.players[0].dashTimer;
        run(s, 1, (i) => {
          i.moveX = 1;
          i.dashPressed = t === 0 || t === 30;
        });
        if (before <= 0 && s.state.players[0].dashTimer > 0) n++;
      }
      return n;
    };
    expect(dashes(a)).toBe(2);
    expect(dashes(b)).toBe(1);
  });

  it('Afterimage: a dash leaves a damaging trail', () => {
    const [a, b] = pair(buyCardTx('afterimage'));
    for (const s of [a, b]) addTestEnemy(s.state, 'shard', -2, 0, { hp: 1e6, maxHp: 1e6 });
    const dash = (i: PlayerIntent, _w: WorldState, t: number): void => {
      i.moveX = 1;
      i.dashPressed = t === 0;
    };
    run(a, 60, dash);
    run(b, 60, dash);
    const hpA = a.state.enemies.active[0]!.hp;
    const hpB = b.state.enemies.active[0]!.hp;
    expect(hpA).toBeLessThan(hpB);
  });

  it('Vampire Code: kills heal 1 HP per 12', () => {
    const [a, b] = pair(buyCardTx('vampireCode'));
    for (const s of [a, b]) {
      s.state.players[0].hp = 10;
      for (let k = 0; k < 12; k++) addTestEnemy(s.state, 'shard', -4, 3 + k * 0.01, { hp: 1, maxHp: 1 });
    }
    const fire = (i: PlayerIntent): void => {
      i.fireHeld = true;
    };
    run(a, 240, fire);
    run(b, 240, fire);
    expect(a.state.players[0].kills).toBeGreaterThanOrEqual(12);
    expect(a.state.players[0].hp).toBeGreaterThan(b.state.players[0].hp);
  });

  it('Overheat: +40% fire rate below 30% HP', () => {
    const [a, b] = pair(buyCardTx('overheat'));
    const low = (w: WorldState): void => {
      w.players[0].hp = w.players[0].stats.maxHp * 0.2;
    };
    expect(shotsFired(a, 600, low)).toBeGreaterThan(shotsFired(b, 600, low) * 1.3);
  });

  it('Chain Arc: weapon hits arc to other enemies', () => {
    const [a, b] = pair(buyCardTx('chainArc'));
    let arcsA = 0;
    let arcsB = 0;
    for (const [s, add] of [
      [a, (n: number) => (arcsA += n)],
      [b, (n: number) => (arcsB += n)],
    ] as const) {
      for (let k = 0; k < 4; k++) addTestEnemy(s.state, 'shard', -4 + k, 4, { hp: 1e6, maxHp: 1e6 });
      const intents = createIntents();
      for (let t = 0; t < 600; t++) {
        resetIntent(intents[0]);
        intents[0].fireHeld = true;
        s.tick(intents);
        add(s.state.events.arc.count);
        s.clearEvents();
      }
    }
    expect(arcsA).toBeGreaterThan(0);
    expect(arcsB).toBe(0);
  });

  it('Micro-Missiles: 2 homing missiles every 1.2 s', () => {
    const [a, b] = pair(buyCardTx('microMissiles'));
    for (const s of [a, b]) addTestEnemy(s.state, 'shard', 6, 6, { hp: 1e6, maxHp: 1e6 });
    run(a, 150, () => {});
    run(b, 150, () => {});
    expect(a.state.playerShots.count).toBeGreaterThanOrEqual(CARD_PARAMS.microMissiles.count);
    expect(b.state.playerShots.count).toBe(0);
  });

  it('Nanoshield: blocks a hit after 12 s', () => {
    const [a, b] = pair(buyCardTx('nanoshield'));
    run(a, 12 * 120 + 5, () => {});
    run(b, 12 * 120 + 5, () => {});
    const hpA = a.state.players[0].hp;
    const hpB = b.state.players[0].hp;
    for (const s of [a, b]) addTestEnemyShot(s.state, -4, 1.5, 0, -20, 10);
    run(a, 20, () => {});
    run(b, 20, () => {});
    expect(a.state.players[0].hp).toBe(hpA);
    expect(b.state.players[0].hp).toBeLessThan(hpB);
  });

  it('Orbitals: blades damage an adjacent enemy without firing', () => {
    const [a, b] = pair(buyCardTx('orbitals'));
    for (const s of [a, b]) addTestEnemy(s.state, 'shard', -4, 2.4, { hp: 1e6, maxHp: 1e6 });
    run(a, 240, () => {});
    run(b, 240, () => {});
    expect(a.state.enemies.active[0]!.hp).toBeLessThan(1e6);
    expect(b.state.enemies.active[0]!.hp).toBe(1e6);
  });

  it('Glass Lens: +35% damage, -20% max HP', () => {
    const [a, b] = pair(buyCardTx('glassLens'));
    expect(a.state.players[0].stats.maxHp).toBe(Math.floor(b.state.players[0].stats.maxHp * 0.8));
    expect(firstVolley(a).damage / firstVolley(b).damage).toBeCloseTo(1.35, 6);
  });

  it('FORK(): every 5th volley doubles', () => {
    const [a, b] = pair(buyCardTx('forkCall'), 'solo', { legendaryPool: 1 });
    const count = (s: RunSession): number => {
      let spawned = 0;
      const intents = createIntents();
      intents[0].fireHeld = true;
      let volleys = 0;
      for (let t = 0; t < 2_000 && volleys < 10; t++) {
        const before = s.state.playerShots.count;
        s.tick(intents);
        volleys += s.state.events.shot.count;
        spawned += Math.max(0, s.state.playerShots.count - before);
        s.clearEvents();
      }
      return spawned;
    };
    expect(count(a)).toBeGreaterThan(count(b));
  });

  it('SUDO: the special fires twice', () => {
    const [a, b] = pair(buyCardTx('sudo'), 'solo', { legendaryPool: 1 });
    const casts = (s: RunSession): number => {
      s.state.players[0].overdrive = OVERDRIVE.MAX;
      let n = 0;
      const intents = createIntents();
      for (let t = 0; t < 1_500; t++) {
        // Held until the first cast: specials are locked during the wave countdown (the meter is kept).
        intents[0].specialPressed = n === 0;
        s.tick(intents);
        n += s.state.events.special.count;
        s.clearEvents();
      }
      return n;
    };
    expect(casts(a)).toBe(2);
    expect(casts(b)).toBe(1);
  });

  it('ROOT ACCESS: combo tier +1 permanently', () => {
    const [a, b] = pair(buyCardTx('rootAccess'), 'solo', { legendaryPool: 1 });
    expect(comboScoreMul(a.state.players[0])).toBeGreaterThan(comboScoreMul(b.state.players[0]));
  });
});

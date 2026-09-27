/**
 * ECON critic (verification, expected to PASS): every stat row, every patch card and the Firmware snapshot
 * bought/applied through the REAL RunSession -> ShopModel -> applyShopResults path changes the player's
 * DerivedStats and observable sim behaviour. Each case is an A/B pair on the same seed: A buys the item,
 * B (control) buys nothing, then both run identical scripted ticks in a frozen "lab" (countdown phase with a
 * huge timer: no spawns, enemies frozen, weapons live).
 */
import { describe, expect, it } from 'vitest';
import type { CardId, MetaLevels, PlayerIndex, RunMode, StatRowId } from '../../../src/contracts/ids';
import type { PlayerIntent } from '../../../src/contracts/input';
import type { WorldState } from '../../../src/contracts/world';
import { NullLogger } from '../../../src/core/logger';
import { CARD_PARAMS, cardDef } from '../../../src/config/cards';
import { OVERDRIVE } from '../../../src/config/tuning';
import { addOverdrive } from '../../../src/entities/overdrive';
import { comboScoreMul } from '../../../src/entities/combo';
import { createRunSession, type RunSession } from '../../../src/sim/RunSession';
import { clearBoss } from '../../../src/sim/worldRecords';
import { createIntents, resetIntent } from '../../helpers/scriptedIntents';
import { addTestEnemy, addTestEnemyShot, addTestPickup } from '../../helpers/worldFixture';
import { runConfigFor } from '../../sim/runDriver';

const IDLE = createIntents();

function session(mode: RunMode, seed: number, meta: MetaLevels = {}): RunSession {
  return createRunSession(runConfigFor(mode, seed, { meta }), { log: NullLogger });
}

/** Runs wave 1's countdown, removes every enemy and the budget, and ticks to waveClearReady. */
function toFirstShop(s: RunSession): void {
  s.beginNextWave();
  const w = s.state;
  for (let i = 0; i < 2_000 && w.run.phase !== 'combat'; i++) s.tick(IDLE);
  w.enemies.clear();
  w.director.pending.clear();
  w.director.budgetLeft = 0;
  for (const b of w.bosses) clearBoss(b);
  for (let i = 0; i < 2_000 && !s.flags.waveClearReady; i++) s.tick(IDLE);
  expect(s.flags.waveClearReady).toBe(true);
}

type Buy = (s: RunSession) => void;

/** Opens a visit with rich wallets, runs `buy`, commits, applies the results and starts wave 2. */
function visit(s: RunSession, buy: Buy | null): void {
  s.state.run.wallets[0] = 1_000_000;
  if (s.state.players[1].life !== 'absent') s.state.run.wallets[1] = 1_000_000;
  const shop = s.openShop();
  shop.update(400);
  buy?.(s);
  shop.commit();
  s.applyShopResults();
  s.beginNextWave();
}

function buyRowTx(id: StatRowId, times = 1, p: PlayerIndex = 0): Buy {
  return (s) => {
    for (let i = 0; i < times; i++) expect(s.shop!.apply({ kind: 'buyRow', player: p, id }).ok).toBe(true);
  };
}

/** Rerolls (paid) until `id` is offered, then buys it. */
function buyCardTx(id: CardId, p: PlayerIndex = 0): Buy {
  return (s) => {
    const shop = s.shop!;
    for (let tries = 0; tries < 400; tries++) {
      const slot = shop.snapshot().players[p].cards.find((c) => c.id === id);
      if (slot !== undefined) {
        const r = shop.apply({ kind: 'buyCard', player: p, slot: slot.slot });
        expect(r.ok).toBe(true);
        return;
      }
      expect(shop.apply({ kind: 'reroll', player: p }).ok).toBe(true);
    }
    throw new Error(`card ${id} never offered`);
  };
}

/** Freezes the world into a lab: countdown forever (no spawns, enemies frozen), empty pools, no i-frames. */
function lab(s: RunSession): WorldState {
  const w = s.state;
  w.run.phase = 'countdown';
  w.run.phaseTimer = 1e9;
  w.director.pending.clear();
  w.director.budgetLeft = 0;
  w.enemies.clear();
  w.enemyShots.clear();
  w.playerShots.clear();
  w.pickups.clear();
  w.lasers.clear();
  for (const p of w.players) {
    if (p.life === 'absent') continue;
    p.invulnUntil = 0;
    p.x = p.prevX = p.index === 0 ? -4 : 4;
    p.z = p.prevZ = 0;
    p.vx = p.vz = 0;
    p.aimX = 0;
    p.aimZ = 1;
    p.yaw = p.prevYaw = 0;
    p.fireAcc = 0;
  }
  return w;
}

/** A/B pair: A buys, B does not; both are put in the lab. */
function pair(buy: Buy, mode: RunMode = 'solo', meta: MetaLevels = {}, seed = 5): [RunSession, RunSession] {
  const a = session(mode, seed, meta);
  const b = session(mode, seed, meta);
  toFirstShop(a);
  toFirstShop(b);
  visit(a, buy);
  visit(b, null);
  lab(a);
  lab(b);
  return [a, b];
}

function run(s: RunSession, ticks: number, fill: (i: PlayerIntent, w: WorldState, t: number) => void): void {
  const intents = createIntents();
  for (let t = 0; t < ticks; t++) {
    resetIntent(intents[0]);
    resetIntent(intents[1]);
    fill(intents[0], s.state, t);
    s.tick(intents);
    s.clearEvents();
  }
}

function shotsFired(s: RunSession, ticks: number, patch?: (w: WorldState) => void): number {
  let n = 0;
  const intents = createIntents();
  for (let t = 0; t < ticks; t++) {
    patch?.(s.state);
    resetIntent(intents[0]);
    intents[0].fireHeld = true;
    s.tick(intents);
    n += s.state.events.shot.count;
    s.clearEvents();
  }
  return n;
}

function firstVolley(s: RunSession): { count: number; damage: number; pierce: number; bounces: number } {
  const w = s.state;
  w.playerShots.clear();
  const intents = createIntents();
  intents[0].fireHeld = true;
  for (let t = 0; t < 60 && w.playerShots.count === 0; t++) s.tick(intents);
  const shot = w.playerShots.active[0]!;
  return { count: w.playerShots.count, damage: shot.damage, pierce: shot.pierce, bounces: shot.bounces };
}

describe('ECON verify: stat rows bought through RunSession change the sim', () => {
  it('Thrusters: +7% moveSpeed and the craft covers more ground', () => {
    const [a, b] = pair(buyRowTx('thrusters'));
    expect(a.state.players[0].stats.moveSpeed).toBeCloseTo(b.state.players[0].stats.moveSpeed * 1.07, 9);
    const move = (i: PlayerIntent): void => {
      i.moveX = 1;
    };
    run(a, 120, move);
    run(b, 120, move);
    expect(a.state.players[0].x - -4).toBeGreaterThan((b.state.players[0].x - -4) * 1.04);
  });

  it('Plating: +20 max HP and heals by the delta', () => {
    const [a, b] = pair(buyRowTx('plating'));
    expect(a.state.players[0].stats.maxHp).toBe(b.state.players[0].stats.maxHp + 20);
    expect(a.state.players[0].hp).toBe(b.state.players[0].hp + 20);
  });

  it('Overclock: +12% fire rate and more volleys', () => {
    const [a, b] = pair(buyRowTx('overclock', 3));
    expect(a.state.players[0].stats.fireRate).toBeCloseTo(b.state.players[0].stats.fireRate * 1.36, 9);
    expect(shotsFired(a, 600)).toBeGreaterThan(shotsFired(b, 600) * 1.3);
  });

  it('Payload: +15% damage on fired projectiles', () => {
    const [a, b] = pair(buyRowTx('payload'));
    expect(firstVolley(a).damage / firstVolley(b).damage).toBeCloseTo(1.15, 6);
  });

  it('Magnet: +25% pickup radius pulls a pickup the control cannot reach', () => {
    const [a, b] = pair(buyRowTx('magnet'));
    const r = b.state.players[0].stats.magnetRadius;
    expect(a.state.players[0].stats.magnetRadius).toBeCloseTo(r * 1.25, 9);
    for (const s of [a, b]) addTestPickup(s.state, -4 + r * 1.15, 0, 5);
    const wa = a.state.run.wallets[0];
    const wb = b.state.run.wallets[0];
    run(a, 30, () => {});
    run(b, 30, () => {});
    expect(a.state.run.wallets[0] - wa).toBe(5);
    expect(b.state.run.wallets[0] - wb).toBe(0);
  });

  it('Coolant: -12% dash cooldown after a dash', () => {
    const [a, b] = pair(buyRowTx('coolant'));
    const dash = (i: PlayerIntent, _w: WorldState, t: number): void => {
      i.moveX = 1;
      i.dashPressed = t === 0;
    };
    run(a, 2, dash);
    run(b, 2, dash);
    expect(a.state.players[0].dashCooldownLeft).toBeLessThan(b.state.players[0].dashCooldownLeft * 0.9);
  });

  it('Capacitor: +20% special charge per Overdrive gain', () => {
    const [a, b] = pair(buyRowTx('capacitor'));
    for (const s of [a, b]) {
      s.state.players[0].overdrive = 0;
      addOverdrive(s.state, 0, 10);
    }
    expect(a.state.players[0].overdrive).toBeCloseTo(12, 9);
    expect(b.state.players[0].overdrive).toBeCloseTo(10, 9);
  });

  it('Special Tuning: tier II special (bigger radius/duration)', () => {
    const [a, b] = pair(buyRowTx('specialTuning'));
    expect(a.state.players[0].stats.specialTier).toBe(1);
    const radius: number[] = [];
    for (const s of [a, b]) {
      s.state.players[0].overdrive = OVERDRIVE.MAX;
      const intents = createIntents();
      intents[0].specialPressed = true;
      s.tick(intents);
      expect(s.state.events.special.count).toBe(1);
      radius.push(s.state.events.special.get(0).duration);
    }
    expect(radius[0]!).toBeGreaterThan(radius[1]!);
  });
});

describe('ECON verify: each patch card bought through RunSession changes the sim', () => {
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
        intents[0].specialPressed = t === 0;
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

describe('ECON verify: Firmware snapshot at run start', () => {
  it('Hull FW, Boot Cache, Pre-Charge, Second Boot reach the world; Reroll Cache and Legendary Pool reach the shop', () => {
    const meta: MetaLevels = {
      hullFw: 5,
      bootCache: 4,
      preCharge: 1,
      secondBoot: 1,
      rerollCache: 2,
      legendaryPool: 1,
    };
    const s = session('coop', 9, meta);
    const c = session('coop', 9);
    expect(s.state.players[0].stats.maxHp).toBe(Math.floor(c.state.players[0].stats.maxHp * 1.25));
    expect(s.state.run.wallets[0]).toBe(100);
    expect(s.state.players[0].overdrive).toBe(50);
    expect(s.state.run.spareKernels).toBe(2);
    toFirstShop(s);
    s.state.run.wallets[0] = 1_000_000;
    const shop = s.openShop();
    shop.update(400);
    expect(shop.snapshot().players[0].reroll.freeLeft).toBe(2);
    const w0 = shop.snapshot().players[0].wallet;
    expect(shop.apply({ kind: 'reroll', player: 0 }).ok).toBe(true);
    expect(shop.apply({ kind: 'reroll', player: 0 }).ok).toBe(true);
    expect(shop.snapshot().players[0].wallet).toBe(w0);
    // Legendary cards can show up (and be bought) only with the pool.
    let sawL = false;
    for (let i = 0; i < 300 && !sawL; i++) {
      if (shop.snapshot().players[0].cards.some((k) => k.rarity === 'L')) sawL = true;
      else shop.apply({ kind: 'reroll', player: 0 });
    }
    expect(sawL).toBe(true);
  });
});

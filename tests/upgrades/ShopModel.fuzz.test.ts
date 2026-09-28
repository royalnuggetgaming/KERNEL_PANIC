import { describe, expect, it } from 'vitest';
import { STAT_ROW_IDS, TEAM_ITEM_IDS, type PlayerIndex, type RunMode } from '../../src/contracts/ids';
import type { Rng } from '../../src/contracts/sim';
import type { PlayerRunState, ShopTx, TeamState } from '../../src/contracts/upgrades';
import { statRowDef } from '../../src/config/runCatalog';
import { COOP } from '../../src/config/tuning';
import { createRng } from '../../src/core/rng';
import { createShopModel, type ShopModel } from '../../src/upgrades/ShopModel';
import { player, team } from './shopFixture';

function randomTx(rng: Rng, p1Share: number): ShopTx {
  const p: PlayerIndex = rng.chance(p1Share) ? 0 : 1;
  const slot = rng.int(0, 2) as 0 | 1 | 2;
  switch (rng.int(0, 9)) {
    case 0:
    case 1:
      return { kind: 'buyRow', player: p, id: rng.pick(STAT_ROW_IDS) };
    case 2:
      return { kind: 'buyCard', player: p, slot };
    case 3:
      return { kind: 'buyTeam', player: p, id: rng.pick(TEAM_ITEM_IDS) };
    case 4:
      return { kind: 'repair', player: p };
    case 5:
      return { kind: 'reroll', player: p };
    case 6:
    case 7:
      return { kind: 'undo', player: p };
    case 8:
      return rng.chance(0.5) ? { kind: 'lock', player: p, slot } : { kind: 'gift', player: p };
    default:
      return rng.chance(0.3)
        ? { kind: 'toggleReady', player: p }
        : { kind: 'buyRow', player: p, id: 'magnet' };
  }
}

function sumWallets(ps: readonly PlayerRunState[]): number {
  return ps[0]!.wallet + ps[1]!.wallet;
}

function checkInvariants(shop: ShopModel, start: number): void {
  const r = shop.results();
  for (const p of r.players) {
    expect(Number.isSafeInteger(p.wallet) && p.wallet >= 0).toBe(true);
    expect(Number.isSafeInteger(p.hp) && p.hp >= 0 && p.hp <= p.maxHp).toBe(true);
    expect(Number.isSafeInteger(p.maxHp) && p.maxHp >= 1).toBe(true);
    for (const id of STAT_ROW_IDS) expect(p.rows[id] <= statRowDef(id).maxLevel).toBe(true);
  }
  expect(r.team.kernels <= COOP.MAX_KERNELS).toBe(true);
  const l = shop.ledger();
  for (const v of [l.spent, l.refunded, l.granted]) expect(Number.isSafeInteger(v) && v >= 0).toBe(true);
  // Conservation over both wallets: gifts are transfers, Shard Caches are the only source.
  expect(start - sumWallets(r.players)).toBe(l.spent - l.refunded - l.granted);
}

function runVisits(mode: RunMode, seed: number, ops: number): number {
  const rng = createRng(seed);
  let players: readonly [PlayerRunState, PlayerRunState] = [
    player('lancer', { wallet: rng.int(0, 1500), hp: 60 }),
    player('specter', { wallet: rng.int(0, 1500), hp: 40 }),
  ];
  let t: TeamState = team();
  let locked: ReturnType<ShopModel['results']>['locked'] = [null, null];
  let done = 0;
  let successes = 0;
  for (let visit = 1; done < ops; visit++) {
    const wave = Math.min(15, visit);
    const shop = createShopModel({
      mode,
      wave,
      visit,
      round: mode === 'versus' ? visit : 0,
      finalVisit: false,
      joined: [true, mode !== 'solo'],
      vehicles: ['lancer', 'specter'],
      players,
      team: t,
      meta: { bootCache: 2, legendaryPool: 1, hullFw: 2 },
      locked,
      rng: createRng(seed).fork('shop'),
    });
    const start = sumWallets(shop.results().players);
    for (let i = 0; i < 500 && done < ops; i++, done++) {
      if (rng.chance(0.25)) shop.update(rng.int(0, 400));
      const res = shop.apply(randomTx(rng, mode === 'solo' ? 0.9 : 0.5));
      if (res.ok) {
        successes++;
        expect(Number.isSafeInteger(res.price) && res.price >= 0).toBe(true);
        expect(Number.isSafeInteger(res.balance) && res.balance >= 0).toBe(true);
      }
      checkInvariants(shop, start);
    }
    shop.commit();
    const r = shop.results();
    // Next visit: top the wallets up like a wave clear would.
    players = [
      { ...r.players[0], wallet: r.players[0].wallet + 100 + 20 * wave },
      { ...r.players[1], wallet: r.players[1].wallet + 100 + 20 * wave },
    ];
    t = r.team;
    locked = r.locked;
  }
  // The generator must exercise real purchases, not just rejections.
  expect(successes).toBeGreaterThan(ops * 0.05);
  return done;
}

describe('ShopModel fuzz', () => {
  it('10k seeded co-op operations keep integers, non-negatives and currency conservation', () => {
    expect(runVisits('coop', 20260926, 10_000)).toBe(10_000);
  });

  it('solo and versus visits hold the same invariants', () => {
    expect(runVisits('solo', 7, 3000)).toBe(3000);
    expect(runVisits('versus', 8, 3000)).toBe(3000);
  });
});

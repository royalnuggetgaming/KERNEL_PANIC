/**
 * Monte Carlo economy model for tests/sim/economy.test.ts. Full sim runs are far too slow for 2,000 runs, so
 * per-wave Shard INCOME is modelled from the frozen config (threat budget x mode multiplier x the expected
 * drop per threat point of the unlocked kinds with the director's pick weights, Fork splits, CORRUPTED elites,
 * kill/collect fractions, purge payout, combo bonus, the player's shardGain stat, catch-up, sync kills, boss
 * drops and the wave-clear bonus), while SPENDING goes through the real ShopModel (real prices, offers, caps,
 * repair, team row and visit rules) with a greedy or random buyer.
 */
import {
  CARD_IDS,
  ENEMY_KINDS,
  STAT_ROW_IDS,
  type PlayerIndex,
  type RunMode,
  type VehicleId,
} from '../../src/contracts/ids';
import type { ShopPlayerSnapshot } from '../../src/contracts/run';
import type { Rng } from '../../src/contracts/sim';
import type { PlayerRunState, ShopTx, TeamState } from '../../src/contracts/upgrades';
import { createRng } from '../../src/core/rng';
import { CORRUPTED, ENEMY_DEFS, eliteChance } from '../../src/config/enemies';
import { statRowDef } from '../../src/config/runCatalog';
import { COOP, ECONOMY, PICKUPS } from '../../src/config/tuning';
import { WAVES, bossForWave, clearBonus, sectorOf, waveBudget } from '../../src/config/waves';
import { KIND_WEIGHTS, threatMulFor } from '../../src/sim/WaveDirector';
import type { LockedCard } from '../../src/upgrades/offers';
import { createShopModel } from '../../src/upgrades/ShopModel';
import { capsReached, computeStats, emptyRowLevels, emptyTeamLevels } from '../../src/upgrades/stats';

export type Buyer = 'greedy' | 'random';

/** Expected Shards dropped per threat point spent at wave w (director weights over unlocked kinds). */
export function dropPerThreat(wave: number): number {
  let drop = 0;
  let cost = 0;
  const elite = eliteChance(sectorOf(wave));
  for (let i = 0; i < ENEMY_KINDS.length; i++) {
    const d = ENEMY_DEFS[ENEMY_KINDS[i]!];
    if (d.unlockWave > wave) continue;
    const wgt = KIND_WEIGHTS[i] ?? 1;
    let dr = d.drop * (1 + elite * (CORRUPTED.dropMul - 1));
    // Fork splits into 2 Shards that drop their own Shards.
    if (d.kind === 'fork') dr += d.params.splitCount * ENEMY_DEFS.shard.drop;
    drop += wgt * dr;
    cost += wgt * d.cost;
  }
  return cost > 0 ? drop / cost : 0;
}

/** Team pickup income for a wave (before shardGain, split and bonuses). */
function waveTeamIncome(wave: number, mode: RunMode, playerCount: 1 | 2, rng: Rng): number {
  if (bossForWave(wave) !== null) return ECONOMY.BOSS_SHARDS + rng.range(0, 40);
  const budget = waveBudget(wave) * threatMulFor(playerCount, mode);
  const perThreat = dropPerThreat(wave);
  const killed = rng.range(0.7, 1);
  const collected = rng.range(0.85, 1);
  const purged = (1 - killed) * WAVES.PURGE_PAYOUT;
  return budget * perThreat * (killed * collected + purged);
}

export interface VisitSample {
  readonly wave: number;
  readonly purchases: number;
}

export interface RunStats {
  readonly mode: RunMode;
  readonly buyer: Buyer;
  /** Per joined player: purchases per visit. */
  readonly visits: VisitSample[][];
  /** Per joined player: total Shards spent (net of undo) over the run. */
  readonly spent: number[];
  /** Per joined player: total Shards earned over the run. */
  readonly earned: number[];
  /** First wave after which a player had every stat row maxed or every hard cap reached (Infinity = never). */
  readonly allCapsWave: number[];
}

const CAPPABLE_STATS = 13;

function allCaps(p: PlayerRunState, vehicle: VehicleId, team: TeamState): boolean {
  let maxed = true;
  for (const id of STAT_ROW_IDS) if (p.rows[id] < statRowDef(id).maxLevel) maxed = false;
  if (maxed) return true;
  const stats = computeStats(vehicle, {}, p.rows, p.cards, team.levels);
  return capsReached(stats, vehicle).size >= CAPPABLE_STATS;
}

interface Candidate {
  readonly tx: ShopTx;
  readonly price: number;
}

function candidates(s: ShopPlayerSnapshot, p: PlayerIndex, coop: boolean, wantTeam: boolean): Candidate[] {
  const out: Candidate[] = [];
  for (const r of s.rows)
    if (r.status === 'available' && r.price !== null)
      out.push({ tx: { kind: 'buyRow', player: p, id: r.id }, price: r.price });
  for (const c of s.cards)
    if (c.status === 'available' && c.id !== null)
      out.push({ tx: { kind: 'buyCard', player: p, slot: c.slot }, price: c.price });
  if (s.hp < s.maxHp * 0.7 && s.repair.status === 'available' && s.repair.price !== null)
    out.push({ tx: { kind: 'repair', player: p }, price: s.repair.price });
  if (coop && wantTeam)
    for (const t of s.team)
      if (t.status === 'available' && t.price !== null)
        out.push({ tx: { kind: 'buyTeam', player: p, id: t.id }, price: t.price });
  return out;
}

/** Greedy: the most expensive affordable item; random: any affordable item. Stops when nothing is affordable. */
function pick(list: readonly Candidate[], buyer: Buyer, rng: Rng): Candidate {
  if (buyer === 'random') return list[rng.int(0, list.length - 1)]!;
  let best = list[0]!;
  for (const c of list) if (c.price > best.price) best = c;
  return best;
}

export function simulateRun(mode: RunMode, seed: number, buyer: Buyer): RunStats {
  const rng = createRng(seed).fork('economy');
  const shopRng = createRng(seed).fork('shop');
  const n: 1 | 2 = mode === 'solo' ? 1 : 2;
  const vehicles: readonly [VehicleId, VehicleId] = ['lancer', 'bulwark'];
  const base = [0, 1].map((i) =>
    computeStats(vehicles[i]!, {}, emptyRowLevels(), new Uint8Array(CARD_IDS.length), emptyTeamLevels()),
  );
  const players: [PlayerRunState, PlayerRunState] = [0, 1].map((i) => ({
    wallet: 0,
    hp: base[i]!.maxHp,
    maxHp: base[i]!.maxHp,
    rows: emptyRowLevels(),
    cards: new Uint8Array(CARD_IDS.length),
    repairsThisVisit: 0,
  })) as [PlayerRunState, PlayerRunState];
  let team: TeamState = {
    kernels: COOP.START_KERNELS,
    kernelsBoughtThisRun: 0,
    levels: emptyTeamLevels(),
    boughtThisVisit: emptyTeamLevels(),
  };
  let locked: [LockedCard | null, LockedCard | null] = [null, null];
  const stats: RunStats = {
    mode,
    buyer,
    visits: Array.from({ length: n }, () => []),
    spent: new Array<number>(n).fill(0),
    earned: new Array<number>(n).fill(0),
    allCapsWave: new Array<number>(n).fill(Infinity),
  };
  for (let wave = 1; wave <= WAVES.TOTAL; wave++) {
    // Income: team pickups split between players (catch-up bonus for the poorer one), sync kills, clear bonus.
    const pool = waveTeamIncome(wave, mode, n, rng);
    const combo = 1 + rng.range(0, 0.15);
    const share0 = n === 1 ? 1 : rng.range(0.35, 0.65);
    for (let i = 0; i < n; i++) {
      const p = players[i]!;
      const gain = computeStats(vehicles[i]!, {}, p.rows, p.cards, team.levels).shardGain;
      let inc = pool * (i === 0 ? share0 : 1 - share0) * combo * gain;
      const other = players[1 - i]!;
      if (n === 2 && p.wallet < other.wallet * PICKUPS.CATCHUP_RATIO) inc *= 1 + PICKUPS.CATCHUP_BONUS;
      if (n === 2 && mode === 'coop') inc += COOP.SYNC_SHARDS * rng.int(0, 6);
      const total = Math.round(inc) + clearBonus(wave);
      p.wallet = Math.min(ECONOMY.WALLET_MAX, p.wallet + total);
      stats.earned[i]! += total;
      p.hp = Math.max(1, Math.round(p.maxHp * (1 - rng.range(0, 0.6))));
    }
    const shop = createShopModel({
      mode,
      wave,
      visit: wave,
      round: 0,
      finalVisit: wave === WAVES.TOTAL,
      joined: [true, n === 2],
      vehicles,
      players,
      team,
      meta: {},
      locked,
      rng: shopRng,
    });
    shop.update(400);
    for (let i = 0; i < n; i++) {
      const p: PlayerIndex = i === 0 ? 0 : 1;
      const wantTeam = rng.chance(0.3);
      let bought = 0;
      for (let guard = 0; guard < 64; guard++) {
        const list = candidates(shop.snapshot().players[p], p, mode === 'coop', wantTeam);
        if (list.length === 0) break;
        const res = shop.apply(pick(list, buyer, rng).tx);
        if (!res.ok) break;
        bought++;
      }
      stats.visits[i]!.push({ wave, purchases: bought });
    }
    shop.commit();
    const res = shop.results();
    for (let i = 0; i < n; i++) {
      const before = players[i]!.wallet;
      players[i] = res.players[i]!;
      players[i]!.repairsThisVisit = 0;
      stats.spent[i]! += Math.max(0, before - players[i]!.wallet);
    }
    team = res.team;
    locked = [res.locked[0], res.locked[1]];
    for (let i = 0; i < n; i++) {
      if (stats.allCapsWave[i] === Infinity && allCaps(players[i]!, vehicles[i]!, team))
        stats.allCapsWave[i] = wave;
    }
  }
  return stats;
}

export function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

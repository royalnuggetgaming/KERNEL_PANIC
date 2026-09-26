/**
 * Run start helpers for RunSession: RunConfig validation, the Firmware snapshot applied through computeStats
 * (vehicle base + meta), starting Shards / Spare Kernels / Overdrive, and fresh per-player economy state.
 */
import {
  CARD_IDS,
  STAT_ROW_IDS,
  TEAM_ITEM_IDS,
  type LoadoutPick,
  type MetaLevels,
  type PlayerIndex,
  type StatRowId,
  type TeamItemId,
  type VehicleId,
} from '../contracts/ids';
import type { RunConfig } from '../contracts/run';
import type { DerivedStats, PlayerRunState, TeamState } from '../contracts/upgrades';
import type { WorldConfig, WorldPlayerInit } from '../contracts/world';
import { invariant } from '../core/assert';
import { META_EFFECTS, metaLevel } from '../config/metaCatalog';
import { COOP } from '../config/tuning';
import { computeStats, emptyRowLevels, emptyTeamLevels } from '../upgrades/stats';

/** Vehicle used for the absent P2 slot in solo (never simulated, only fills fixed-size tuples). */
export const ABSENT_VEHICLE: VehicleId = 'lancer';

/** Throws (InvariantError) on an inconsistent RunConfig: mode/player count, duplicate or missing players. */
export function validateRunConfig(config: RunConfig): void {
  const n = config.players.length;
  invariant(n === 1 || n === 2, `RunConfig: 1 or 2 players expected (got ${n})`);
  invariant(
    config.mode === 'solo' ? n === 1 : n === 2,
    `RunConfig: mode ${config.mode} needs ${config.mode === 'solo' ? 1 : 2} players`,
  );
  invariant(Number.isFinite(config.seed), 'RunConfig: seed must be finite');
  const seen = [false, false];
  for (const pick of config.players) {
    invariant(pick.player === 0 || pick.player === 1, 'RunConfig: player index must be 0 or 1');
    invariant(!seen[pick.player], `RunConfig: player ${pick.player} listed twice`);
    seen[pick.player] = true;
  }
  invariant(seen[0] === true, 'RunConfig: player 0 is always joined');
}

/** The pick for player p, or null when p is not joined. */
export function pickOf(config: RunConfig, p: PlayerIndex): LoadoutPick | null {
  for (const pick of config.players) if (pick.player === p) return pick;
  return null;
}

/** Vehicles of both slots (the absent solo slot gets ABSENT_VEHICLE). */
export function vehiclesOf(config: RunConfig): readonly [VehicleId, VehicleId] {
  return [pickOf(config, 0)?.vehicle ?? ABSENT_VEHICLE, pickOf(config, 1)?.vehicle ?? ABSENT_VEHICLE];
}

/** Run-start stats: vehicle base + Firmware snapshot, no rows, cards or team items yet. */
export function startStats(vehicle: VehicleId, meta: MetaLevels): DerivedStats {
  return computeStats(
    vehicle,
    meta,
    emptyRowLevels(),
    new Uint8Array(CARD_IDS.length),
    emptyTeamLevels(),
  );
}

/** Boot Cache: +25 starting Shards per level. */
export function startShards(meta: MetaLevels): number {
  return metaLevel(meta, 'bootCache') * META_EFFECTS.bootCacheShards;
}

/** 1 Spare Kernel (+1 with Second Boot), never above the hold cap. */
export function startKernels(meta: MetaLevels): number {
  const k = COOP.START_KERNELS + metaLevel(meta, 'secondBoot') * META_EFFECTS.secondBootKernels;
  return Math.min(COOP.MAX_KERNELS, k);
}

/** Pre-Charge: the special starts 50% charged. */
export function startOverdrive(meta: MetaLevels): number {
  return metaLevel(meta, 'preCharge') >= 1 ? META_EFFECTS.preChargeOverdrive : 0;
}

/** Builds the WorldConfig of a run from its RunConfig (validated first). */
export function buildWorldConfig(config: RunConfig): WorldConfig {
  validateRunConfig(config);
  const overdrive = startOverdrive(config.meta);
  const init = (p: PlayerIndex): WorldPlayerInit | null => {
    const pick = pickOf(config, p);
    return pick === null
      ? null
      : { vehicle: pick.vehicle, stats: startStats(pick.vehicle, config.meta), overdrive };
  };
  const p0 = init(0);
  invariant(p0 !== null, 'RunConfig: player 0 is always joined');
  return {
    seed: config.seed,
    mode: config.mode,
    players: [p0, init(1)],
    startShards: startShards(config.meta),
    startKernels: startKernels(config.meta),
  };
}

/** Fresh per-player economy state (rows 0, no cards). Absent players get an empty wallet and 0 hp. */
export function createPlayerRunState(joined: boolean, wallet: number, maxHp: number): PlayerRunState {
  return {
    wallet: joined ? wallet : 0,
    hp: joined ? maxHp : 0,
    maxHp: maxHp >= 1 ? maxHp : 1,
    rows: emptyRowLevels(),
    cards: new Uint8Array(CARD_IDS.length),
    repairsThisVisit: 0,
  };
}

export function createTeamState(kernels: number): TeamState {
  return {
    kernels,
    kernelsBoughtThisRun: 0,
    levels: emptyTeamLevels(),
    boughtThisVisit: emptyTeamLevels(),
  };
}

/** Bit per owned card (1 << CardDef.bit) from stack counts. */
export function cardMaskOf(stacks: Uint8Array): number {
  let mask = 0;
  for (let i = 0; i < stacks.length && i < 31; i++) if (stacks[i]! > 0) mask |= 1 << i;
  return mask;
}

/** Deep copy of a player's economy state (cards copied). */
export function clonePlayer(p: Readonly<PlayerRunState>): PlayerRunState {
  const rows = {} as Record<StatRowId, number>;
  for (const id of STAT_ROW_IDS) rows[id] = p.rows[id];
  const cards = new Uint8Array(CARD_IDS.length);
  cards.set(p.cards.subarray(0, CARD_IDS.length));
  return { wallet: p.wallet, hp: p.hp, maxHp: p.maxHp, rows, cards, repairsThisVisit: p.repairsThisVisit };
}

function copyTeamRecord(src: Readonly<Record<TeamItemId, number>>): Record<TeamItemId, number> {
  const out = {} as Record<TeamItemId, number>;
  for (const id of TEAM_ITEM_IDS) out[id] = src[id];
  return out;
}

/** Deep copy of the team stock. */
export function cloneTeam(t: Readonly<TeamState>): TeamState {
  return {
    kernels: t.kernels,
    kernelsBoughtThisRun: t.kernelsBoughtThisRun,
    levels: copyTeamRecord(t.levels),
    boughtThisVisit: copyTeamRecord(t.boughtThisVisit),
  };
}

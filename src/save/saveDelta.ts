/**
 * Pure SaveDelta application and merging. SaveStore re-reads the stored value, applies the delta with
 * applySaveDelta, then sanitises (validates) the result before writing.
 */
import type { MetaLevels, MetaUpgradeId } from '../contracts/ids';
import type { LeaderboardEntry, SaveDataV1, SaveDelta, SaveRecords } from '../contracts/save';
import type { RunSummary } from '../contracts/run';
import { ECONOMY } from '../config/tuning';
import { sortLeaderboard } from './sanitizeParts';

function clampInt(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  const t = Math.trunc(n);
  return t < lo ? lo : t > hi ? hi : t;
}

function mergeLevels(
  base: MetaLevels,
  d: Partial<Record<MetaUpgradeId, number>> | undefined,
  additive: boolean,
): Partial<Record<MetaUpgradeId, number>> {
  const out: Partial<Record<MetaUpgradeId, number>> = { ...base };
  if (d === undefined) return out;
  for (const key of Object.keys(d) as MetaUpgradeId[]) {
    const v = d[key];
    if (v === undefined || !Number.isFinite(v)) continue;
    out[key] = additive ? (out[key] ?? 0) + v : v;
  }
  return out;
}

function applyRun(records: SaveRecords, run: RunSummary, nowMs: number): SaveRecords {
  const versus = run.mode === 'versus';
  const max = Number.MAX_SAFE_INTEGER;
  const score = clampInt(run.totalScore, 0, max);
  let leaderboard: readonly LeaderboardEntry[] = records.leaderboard;
  if (!versus) {
    const vehicles = run.players.map((p) => p.vehicle).slice(0, 2);
    const entry: LeaderboardEntry = {
      score,
      wave: clampInt(run.waveReached, 0, 1_000_000),
      date: clampInt(nowMs, 0, max),
      players: run.players.length >= 2 ? 2 : 1,
      mode: run.mode,
      vehicles,
    };
    leaderboard = sortLeaderboard([...records.leaderboard, entry]);
  }
  return {
    runs: Math.min(max, records.runs + 1),
    // A run that won and then pushed into OVERFLOW ends by dying or abandoning, but the win was banked.
    victories: records.victories + (!versus && (run.outcome === 'victory' || run.victoryAchieved) ? 1 : 0),
    bestWave: versus ? records.bestWave : Math.max(records.bestWave, clampInt(run.waveReached, 0, 1_000_000)),
    bestScore: versus ? records.bestScore : Math.max(records.bestScore, score),
    versusMatches: records.versusMatches + (versus ? 1 : 0),
    leaderboard,
  };
}

/**
 * Applies a delta: coresDelta/spentDelta are additive, meta levels absolute, respec zeroes levels and spend,
 * positive coresDelta (except a respec refund) counts toward lifetimeCores. `runId` marks a committed run.
 */
export function applySaveDelta(
  s: SaveDataV1,
  d: SaveDelta,
  nowMs: number,
  runId: string | null = null,
): SaveDataV1 {
  const coresDelta =
    d.coresDelta !== undefined && Number.isFinite(d.coresDelta) ? Math.trunc(d.coresDelta) : 0;
  const earned = d.respec === true ? 0 : Math.max(0, coresDelta);
  return {
    cores: clampInt(s.cores + coresDelta, 0, ECONOMY.CORES_MAX),
    lifetimeCores: clampInt(s.lifetimeCores + earned, 0, Number.MAX_SAFE_INTEGER),
    meta: d.respec === true ? {} : mergeLevels(s.meta, d.meta, false),
    firmwareSpent: d.respec === true ? {} : mergeLevels(s.firmwareSpent, d.spentDelta, true),
    unlocks: d.unlock !== undefined && !s.unlocks.includes(d.unlock) ? [...s.unlocks, d.unlock] : s.unlocks,
    settings: d.settings !== undefined ? { ...s.settings, ...d.settings } : s.settings,
    bindings: d.bindings ?? s.bindings,
    lastLoadout: d.lastLoadout ?? s.lastLoadout,
    lastMode: d.lastMode ?? s.lastMode,
    records: d.run !== undefined ? applyRun(s.records, d.run, nowMs) : s.records,
    lastCommittedRunId: runId ?? s.lastCommittedRunId,
    ...(d.cheats !== undefined ? { cheats: d.cheats } : s.cheats !== undefined ? { cheats: s.cheats } : {}),
  };
}

function sumOpt(a: number | undefined, b: number | undefined): number | undefined {
  return a === undefined ? b : b === undefined ? a : a + b;
}

/** Combines two deltas so that applying the result equals applying `a` then `b`. */
export function mergeSaveDelta(a: SaveDelta | null, b: SaveDelta): SaveDelta {
  if (a === null) return b;
  const out: {
    -readonly [K in keyof SaveDelta]: SaveDelta[K];
  } = {};
  const cores = sumOpt(a.coresDelta, b.coresDelta);
  if (cores !== undefined) out.coresDelta = cores;
  if (b.respec === true || a.respec === true) out.respec = true;
  if (b.respec === true) {
    // A respec wipes what came before it; only b's own levels survive.
    if (b.meta !== undefined) out.meta = b.meta;
    if (b.spentDelta !== undefined) out.spentDelta = b.spentDelta;
  } else {
    if (a.meta !== undefined || b.meta !== undefined) out.meta = { ...a.meta, ...b.meta };
    if (a.spentDelta !== undefined || b.spentDelta !== undefined)
      out.spentDelta = mergeLevels(a.spentDelta ?? {}, b.spentDelta, true);
  }
  const unlock = b.unlock ?? a.unlock;
  if (unlock !== undefined) out.unlock = unlock;
  if (a.settings !== undefined || b.settings !== undefined) out.settings = { ...a.settings, ...b.settings };
  const bindings = b.bindings ?? a.bindings;
  if (bindings !== undefined) out.bindings = bindings;
  const loadout = b.lastLoadout ?? a.lastLoadout;
  if (loadout !== undefined) out.lastLoadout = loadout;
  const mode = b.lastMode ?? a.lastMode;
  if (mode !== undefined) out.lastMode = mode;
  const run = b.run ?? a.run;
  if (run !== undefined) out.run = run;
  const cheats = b.cheats ?? a.cheats;
  if (cheats !== undefined) out.cheats = cheats;
  return out;
}

/**
 * Plan section 6 "Writes" VALIDATE step for Hangar deltas computed from a possibly stale cache (another tab
 * wrote in between): true when `d` no longer fits the freshly re-read `base`. A spend must be affordable, a
 * paid Firmware level must be the next one after the stored level, a paid unlock must not be owned already,
 * and a respec must refund exactly the stored recorded spend. Settings and run deltas never conflict.
 */
export function deltaConflicts(base: SaveDataV1, d: SaveDelta): boolean {
  const coresDelta =
    d.coresDelta !== undefined && Number.isFinite(d.coresDelta) ? Math.trunc(d.coresDelta) : 0;
  if (d.respec === true) {
    let spent = 0;
    for (const v of Object.values(base.firmwareSpent)) if (v > 0) spent += v;
    let levels = 0;
    for (const v of Object.values(base.meta)) if (v > 0) levels += v;
    return coresDelta !== spent || (spent === 0 && levels === 0);
  }
  if (coresDelta >= 0) return false;
  if (base.cores + coresDelta < 0) return true;
  if (d.unlock !== undefined && base.unlocks.includes(d.unlock)) return true;
  if (d.meta !== undefined) {
    for (const key of Object.keys(d.meta) as MetaUpgradeId[]) {
      const next = d.meta[key];
      if (next !== undefined && next !== (base.meta[key] ?? 0) + 1) return true;
    }
  }
  return false;
}

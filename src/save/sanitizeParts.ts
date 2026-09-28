/** Type guards and coercions for the individual SaveDataV1 sections (used by sanitize.ts). */
import { ACTIONS, type Action, type Bindings, type KeyCode, type PlayerBindings } from '../contracts/input';
import {
  PLAYER_INDICES,
  RUN_MODES,
  THEME_IDS,
  VEHICLE_IDS,
  type LoadoutPick,
  type PlayerIndex,
  type RunMode,
  type ThemeId,
  type VehicleId,
} from '../contracts/ids';
import {
  DIFFICULTY_IDS,
  QUALITY_LEVELS,
  type DifficultyId,
  type FrameCap,
  type LeaderboardEntry,
  type QualityLevel,
  type SaveRecords,
  type Settings,
} from '../contracts/save';
import { resetInvalidActions } from '../config/bindings';
import { DEFAULT_DIFFICULTY } from '../config/difficulty';
import { DEFAULT_BINDINGS } from '../config/keys';
import { DEFAULT_SETTINGS } from './defaults';

export const LEADERBOARD_SIZE = 10;
const MAX_CODES_PER_ACTION = 4;
const MAX_RUN_ID_LENGTH = 128;

export type Loose = Readonly<Record<string, unknown>>;

export function isRecord(v: unknown): v is Loose {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function oneOf<T extends string | number>(list: readonly T[], v: unknown): v is T {
  return (list as readonly unknown[]).includes(v);
}

/** Finite number -> truncated integer clamped to [lo, hi]; anything else -> fallback. */
export function int(v: unknown, lo: number, hi: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  const t = Math.trunc(v);
  return t < lo ? lo : t > hi ? hi : t;
}

function unit(v: unknown, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function boolPair(v: unknown, fallback: readonly [boolean, boolean]): readonly [boolean, boolean] {
  if (!Array.isArray(v)) return [fallback[0], fallback[1]];
  const a: readonly unknown[] = v;
  return [bool(a[0], fallback[0]), bool(a[1], fallback[1])];
}

export function isVehicle(v: unknown): v is VehicleId {
  return oneOf(VEHICLE_IDS, v);
}

export function sanitizeSettings(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  const r: Loose = isRecord(raw) ? raw : {};
  const frameCaps: readonly FrameCap[] = ['auto', 60, 120, 'uncapped'];
  const out: Settings = {
    master: unit(r.master, d.master),
    music: unit(r.music, d.music),
    sfx: unit(r.sfx, d.sfx),
    quality: oneOf<QualityLevel>(QUALITY_LEVELS, r.quality) ? r.quality : d.quality,
    frameCap: oneOf<FrameCap>(frameCaps, r.frameCap) ? r.frameCap : d.frameCap,
    screenShake: unit(r.screenShake, d.screenShake),
    reduceFlashes: bool(r.reduceFlashes, d.reduceFlashes),
    reduceMotion: bool(r.reduceMotion, d.reduceMotion),
    colorblind: bool(r.colorblind, d.colorblind),
    autofire: boolPair(r.autofire, d.autofire),
    focusToggle: boolPair(r.focusToggle, d.focusToggle),
    showFps: bool(r.showFps, d.showFps),
    themeId: oneOf<ThemeId>(THEME_IDS, r.themeId) ? r.themeId : d.themeId,
  };
  // Pre-difficulty (v1) settings have no key: absent means NORMAL everywhere, and leaving it absent keeps a valid
  // old save byte-identical (no rewrite on load). Garbage settings get the full defaults (difficulty included);
  // a present but unknown value resets to NORMAL.
  if (isRecord(raw) && r.difficulty === undefined) return out;
  return {
    ...out,
    difficulty: oneOf<DifficultyId>(DIFFICULTY_IDS, r.difficulty) ? r.difficulty : DEFAULT_DIFFICULTY,
  };
}

function codeList(v: unknown): KeyCode[] {
  if (!Array.isArray(v)) return [];
  const out: KeyCode[] = [];
  for (const c of v as readonly unknown[]) {
    if (typeof c === 'string' && c.length > 0 && c.length <= 32 && !out.includes(c)) out.push(c);
    if (out.length >= MAX_CODES_PER_ACTION) break;
  }
  return out;
}

function playerBindings(v: unknown, fallback: PlayerBindings): PlayerBindings {
  const r: Loose = isRecord(v) ? v : {};
  const out = {} as Record<Action, readonly KeyCode[]>;
  for (const a of ACTIONS) {
    const codes = codeList(r[a]);
    out[a] = isRecord(v) ? codes : fallback[a];
  }
  return out;
}

/** Structural coercion, then per-action reset of anything invalid (forbidden, reserved, duplicate, empty). */
export function sanitizeBindings(raw: unknown): Bindings {
  const r: Loose = isRecord(raw) ? raw : {};
  const players: readonly unknown[] = Array.isArray(r.players) ? (r.players as readonly unknown[]) : [];
  const b: Bindings = {
    players: [
      playerBindings(players[0], DEFAULT_BINDINGS.players[0]),
      playerBindings(players[1], DEFAULT_BINDINGS.players[1]),
    ],
    pause: DEFAULT_BINDINGS.pause,
  };
  return resetInvalidActions(b, DEFAULT_BINDINGS);
}

export function sanitizeLoadout(raw: unknown, unlocked: readonly VehicleId[]): LoadoutPick[] {
  if (!Array.isArray(raw)) return [];
  const out: LoadoutPick[] = [];
  for (const item of raw as readonly unknown[]) {
    if (!isRecord(item)) continue;
    const player = item.player;
    const vehicle = item.vehicle;
    if (!oneOf<PlayerIndex>(PLAYER_INDICES, player) || !isVehicle(vehicle)) continue;
    if (!unlocked.includes(vehicle) || out.some((p) => p.player === player)) continue;
    out.push({ player, vehicle });
  }
  out.sort((a, b) => a.player - b.player);
  return out;
}

export function sanitizeMode(raw: unknown): RunMode {
  return oneOf<RunMode>(RUN_MODES, raw) ? raw : 'solo';
}

function sanitizeEntry(raw: unknown): LeaderboardEntry | null {
  if (!isRecord(raw)) return null;
  const vehicles: VehicleId[] = [];
  if (Array.isArray(raw.vehicles))
    for (const v of raw.vehicles as readonly unknown[])
      if (isVehicle(v) && vehicles.length < 2) vehicles.push(v);
  const players = raw.players === 2 ? 2 : 1;
  if (typeof raw.score !== 'number' || !Number.isFinite(raw.score)) return null;
  return {
    score: int(raw.score, 0, Number.MAX_SAFE_INTEGER, 0),
    wave: int(raw.wave, 0, 1_000_000, 0),
    date: int(raw.date, 0, Number.MAX_SAFE_INTEGER, 0),
    players,
    mode: sanitizeMode(raw.mode),
    vehicles,
  };
}

/** Sorted by score (descending, stable), capped at 10. */
export function sortLeaderboard(entries: readonly LeaderboardEntry[]): LeaderboardEntry[] {
  const out = entries.slice();
  out.sort((a, b) => b.score - a.score || a.date - b.date);
  return out.slice(0, LEADERBOARD_SIZE);
}

export function sanitizeRecords(raw: unknown): SaveRecords {
  const r: Loose = isRecord(raw) ? raw : {};
  const max = Number.MAX_SAFE_INTEGER;
  const entries: LeaderboardEntry[] = [];
  if (Array.isArray(r.leaderboard)) {
    for (const e of r.leaderboard as readonly unknown[]) {
      const s = sanitizeEntry(e);
      if (s !== null) entries.push(s);
    }
  }
  return {
    runs: int(r.runs, 0, max, 0),
    victories: int(r.victories, 0, max, 0),
    bestWave: int(r.bestWave, 0, 1_000_000, 0),
    bestScore: int(r.bestScore, 0, max, 0),
    versusMatches: int(r.versusMatches, 0, max, 0),
    leaderboard: sortLeaderboard(entries),
  };
}

export function sanitizeRunId(raw: unknown): string | null {
  return typeof raw === 'string' && raw.length > 0 && raw.length <= MAX_RUN_ID_LENGTH ? raw : null;
}

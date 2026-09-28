/**
 * Persistence contracts (localStorage envelope, delta commits). FROZEN after Wave 0.
 */
import type { LoadoutPick, MetaLevels, MetaUpgradeId, Result, RunMode, ThemeId, VehicleId } from './ids';
import type { Bindings } from './input';
import type { RunSummary } from './run';

export const QUALITY_LEVELS = ['low', 'medium', 'high', 'ultra'] as const;
export type QualityLevel = (typeof QUALITY_LEVELS)[number];

export type FrameCap = 'auto' | 60 | 120 | 'uncapped';

/** Run difficulty (multipliers in config/difficulty.ts), snapshotted into RunConfig at run start. */
export const DIFFICULTY_IDS = ['casual', 'normal', 'hard'] as const;
export type DifficultyId = (typeof DIFFICULTY_IDS)[number];

export interface Settings {
  /** Volumes in [0, 1]. */
  readonly master: number;
  readonly music: number;
  readonly sfx: number;
  readonly quality: QualityLevel;
  readonly frameCap: FrameCap;
  /** Screen-shake scale in [0, 1]. */
  readonly screenShake: number;
  readonly reduceFlashes: boolean;
  readonly reduceMotion: boolean;
  readonly colorblind: boolean;
  readonly autofire: readonly [boolean, boolean];
  readonly focusToggle: readonly [boolean, boolean];
  readonly showFps: boolean;
  readonly themeId: ThemeId;
  /** Optional for pre-difficulty saves and fixtures; sanitizeSettings always fills it ('normal'). */
  readonly difficulty?: DifficultyId;
}

export interface LeaderboardEntry {
  readonly score: number;
  readonly wave: number;
  readonly date: number;
  readonly players: 1 | 2;
  readonly mode: RunMode;
  readonly vehicles: readonly VehicleId[];
}

export interface SaveRecords {
  readonly runs: number;
  readonly victories: number;
  readonly bestWave: number;
  readonly bestScore: number;
  readonly versusMatches: number;
  /** Top 10 by score, descending. */
  readonly leaderboard: readonly LeaderboardEntry[];
}

export interface SaveDataV1 {
  readonly cores: number;
  readonly lifetimeCores: number;
  readonly meta: MetaLevels;
  /** Cores actually spent per meta upgrade (respec refunds exactly this). */
  readonly firmwareSpent: MetaLevels;
  readonly unlocks: readonly VehicleId[];
  readonly settings: Settings;
  readonly bindings: Bindings;
  readonly lastLoadout: readonly LoadoutPick[];
  readonly lastMode: RunMode;
  readonly records: SaveRecords;
  readonly lastCommittedRunId: string | null;
}

export const CURRENT_SAVE_VERSION = 1;

export const SAVE_KEYS = {
  main: 'linkline.save',
  backup: 'linkline.save.bak',
  corrupt: 'linkline.save.corrupt',
} as const;

export interface SaveEnvelope {
  readonly v: number;
  readonly ts: number;
  readonly rev: number;
  /** crc32(stableStringify(data)). */
  readonly crc: number;
  readonly data: unknown;
}

/** Pure v -> v + 1 step. Registry: Readonly<Record<number, Migration>>. */
export type Migration = (data: unknown) => unknown;

/** Applied to the freshly re-read stored value, validated, then written (.bak first, then main). */
export interface SaveDelta {
  readonly coresDelta?: number;
  readonly meta?: Partial<Record<MetaUpgradeId, number>>;
  readonly spentDelta?: Partial<Record<MetaUpgradeId, number>>;
  readonly unlock?: VehicleId;
  readonly settings?: Partial<Settings>;
  readonly bindings?: Bindings;
  readonly lastLoadout?: readonly LoadoutPick[];
  readonly lastMode?: RunMode;
  /** Updates records/leaderboard. */
  readonly run?: RunSummary;
  /** Respec: reset meta levels to 0 and firmwareSpent to 0 (the refund goes in coresDelta). */
  readonly respec?: true;
}

export type SaveStatus = 'ok' | 'restoredBackup' | 'reset' | 'readOnlyFuture' | 'memoryOnly';

export type SaveError = 'quota' | 'unavailable' | 'readOnly';

/** Minimal key-value facade used by SaveStore (save/storage.ts wraps localStorage with try/catch). */
export interface KeyValueStorage {
  get(k: string): string | null;
  set(k: string, v: string): void;
  remove(k: string): void;
}

/** The subset of the Web Storage API that save/storage.ts wraps (localStorage or a test double). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SaveStorePort {
  load(): { readonly data: SaveDataV1; readonly status: SaveStatus };
  readonly data: SaveDataV1;
  readonly status: SaveStatus;
  commit(d: SaveDelta): Result<SaveDataV1, SaveError>;
  /** Idempotent by runId (lastCommittedRunId): a second call returns error 'duplicate' and changes nothing. */
  commitRun(runId: string, d: SaveDelta): Result<SaveDataV1, SaveError | 'duplicate'>;
  /** Settings/bindings: 500 ms debounce, flushed by tick() and flush(). */
  commitDebounced(d: SaveDelta): void;
  tick(nowMs: number): void;
  flush(): void;
  /** Storage event from another tab (only applied while not in a run). Returns an unsubscribe function. */
  onExternalChange(cb: (d: SaveDataV1) => void): () => void;
}

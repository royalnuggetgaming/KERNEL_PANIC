/** In-memory SaveStorePort with a default SaveDataV1 built from config (independent of save/defaults.ts). */
import type { Result } from '../../src/contracts/ids';
import type {
  SaveDataV1,
  SaveDelta,
  SaveError,
  SaveStatus,
  SaveStorePort,
  Settings,
} from '../../src/contracts/save';
import { DEFAULT_BINDINGS } from '../../src/config/keys';
import { STARTER_VEHICLES } from '../../src/config/vehicles';
import { CallRecorder } from './callRecorder';

export const TEST_SETTINGS: Settings = {
  master: 0.8,
  music: 0.7,
  sfx: 0.8,
  quality: 'high',
  frameCap: 'auto',
  screenShake: 1,
  reduceFlashes: false,
  reduceMotion: false,
  colorblind: false,
  autofire: [true, true],
  focusToggle: [false, false],
  showFps: false,
  themeId: 'kernelPanic',
};

export function createTestSaveData(patch: Partial<SaveDataV1> = {}): SaveDataV1 {
  return {
    cores: 0,
    lifetimeCores: 0,
    meta: {},
    firmwareSpent: {},
    unlocks: [...STARTER_VEHICLES],
    settings: TEST_SETTINGS,
    bindings: DEFAULT_BINDINGS,
    lastLoadout: [],
    lastMode: 'solo',
    records: { runs: 0, victories: 0, bestWave: 0, bestScore: 0, versusMatches: 0, leaderboard: [] },
    lastCommittedRunId: null,
    ...patch,
  };
}

function addMeta(
  base: Readonly<Partial<Record<string, number>>>,
  d: Readonly<Partial<Record<string, number>>> | undefined,
  replace: boolean,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(base)) if (v !== undefined) out[k] = v;
  if (d)
    for (const [k, v] of Object.entries(d)) if (v !== undefined) out[k] = replace ? v : (out[k] ?? 0) + v;
  return out;
}

/**
 * Applies deltas in memory (a simplified version of the real SaveStore semantics: meta levels are absolute,
 * spentDelta/coresDelta are additive, respec zeroes meta and spend). Records every call.
 */
export class FakeSaveStore implements SaveStorePort {
  readonly rec = new CallRecorder();
  data: SaveDataV1;
  status: SaveStatus = 'ok';
  failWith: SaveError | null = null;
  private pending: SaveDelta[] = [];
  private listeners: ((d: SaveDataV1) => void)[] = [];

  constructor(initial: SaveDataV1 = createTestSaveData()) {
    this.data = initial;
  }

  load(): { readonly data: SaveDataV1; readonly status: SaveStatus } {
    this.rec.record('load');
    return { data: this.data, status: this.status };
  }

  commit(d: SaveDelta): Result<SaveDataV1, SaveError> {
    this.rec.record('commit', d);
    if (this.failWith) return { ok: false, error: this.failWith };
    this.data = applyDelta(this.data, d);
    return { ok: true, value: this.data };
  }

  commitRun(runId: string, d: SaveDelta): Result<SaveDataV1, SaveError | 'duplicate'> {
    this.rec.record('commitRun', runId, d);
    if (this.data.lastCommittedRunId === runId) return { ok: false, error: 'duplicate' };
    if (this.failWith) return { ok: false, error: this.failWith };
    this.data = { ...applyDelta(this.data, d), lastCommittedRunId: runId };
    return { ok: true, value: this.data };
  }

  commitDebounced(d: SaveDelta): void {
    this.rec.record('commitDebounced', d);
    this.pending.push(d);
  }

  tick(nowMs: number): void {
    this.rec.record('tick', nowMs);
  }

  flush(): void {
    this.rec.record('flush');
    for (const d of this.pending) this.data = applyDelta(this.data, d);
    this.pending = [];
  }

  onExternalChange(cb: (d: SaveDataV1) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  /** Simulates a storage event from another tab. */
  emitExternal(d: SaveDataV1): void {
    this.data = d;
    for (const l of [...this.listeners]) l(d);
  }
}

export function applyDelta(s: SaveDataV1, d: SaveDelta): SaveDataV1 {
  const coresDelta = d.coresDelta ?? 0;
  const next: SaveDataV1 = {
    ...s,
    cores: Math.max(0, s.cores + coresDelta),
    lifetimeCores: s.lifetimeCores + Math.max(0, coresDelta),
    meta: d.respec ? {} : addMeta(s.meta, d.meta, true),
    firmwareSpent: d.respec ? {} : addMeta(s.firmwareSpent, d.spentDelta, false),
    unlocks: d.unlock && !s.unlocks.includes(d.unlock) ? [...s.unlocks, d.unlock] : s.unlocks,
    settings: d.settings ? { ...s.settings, ...d.settings } : s.settings,
    bindings: d.bindings ?? s.bindings,
    lastLoadout: d.lastLoadout ?? s.lastLoadout,
    lastMode: d.lastMode ?? s.lastMode,
  };
  if (!d.run) return next;
  const r = d.run;
  return {
    ...next,
    records: {
      ...s.records,
      runs: s.records.runs + 1,
      victories: s.records.victories + (r.outcome === 'victory' && r.mode !== 'versus' ? 1 : 0),
      bestWave: Math.max(s.records.bestWave, r.waveReached),
      bestScore: Math.max(s.records.bestScore, r.totalScore),
      versusMatches: s.records.versusMatches + (r.mode === 'versus' ? 1 : 0),
    },
  };
}

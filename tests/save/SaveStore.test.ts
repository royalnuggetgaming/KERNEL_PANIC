import { describe, expect, it } from 'vitest';
import corruptRaw from '../fixtures/saves/corrupt.txt?raw';
import futureRaw from '../fixtures/saves/future-v99.json?raw';
import overRaw from '../fixtures/saves/v1-overleveled.json?raw';
import validRaw from '../fixtures/saves/v1-valid.json?raw';
import type { RunSummary } from '../../src/contracts/run';
import { SAVE_KEYS, type SaveDataV1 } from '../../src/contracts/save';
import { createMemoryLogger } from '../../src/core/logger';
import { createDefaultSave } from '../../src/save/defaults';
import { decodeEnvelope } from '../../src/save/envelope';
import { MIGRATIONS } from '../../src/save/migrations';
import { createSaveStore, SAVE_DEBOUNCE_MS, type SaveStore } from '../../src/save/SaveStore';
import { createKeyValueStorage } from '../../src/save/storage';
import { FakeClock } from '../helpers/fakeClock';
import { MemoryStorage } from '../helpers/memoryStorage';

interface Harness {
  readonly mem: MemoryStorage;
  readonly clock: FakeClock;
  readonly store: SaveStore;
  inRun: boolean;
}

function harness(mem = new MemoryStorage(), clock = new FakeClock(1000)): Harness {
  const { kv, memoryOnly } = createKeyValueStorage(mem);
  mem.writes.length = 0; // drop the availability probe
  const h: { mem: MemoryStorage; clock: FakeClock; store: SaveStore | null; inRun: boolean } = {
    mem,
    clock,
    store: null,
    inRun: false,
  };
  h.store = createSaveStore({
    storage: kv,
    memoryOnly,
    clock,
    log: createMemoryLogger(),
    inRun: () => h.inRun,
  });
  return h as Harness;
}

function stored(mem: MemoryStorage, key: string = SAVE_KEYS.main): SaveDataV1 {
  const d = decodeEnvelope(mem.rawGet(key), MIGRATIONS);
  if (d.kind !== 'ok') throw new Error(`stored ${key} is ${d.kind}`);
  return d.data;
}

function run(runId: string, patch: Partial<RunSummary> = {}): RunSummary {
  return {
    runId,
    mode: 'coop',
    outcome: 'defeat',
    winner: null,
    waveReached: 8,
    wavesCleared: 7,
    bossesKilled: 1,
    victoryAchieved: false,
    shardsEarnedTotal: 900,
    roundsPlayed: 0,
    roundWins: [0, 0],
    durationS: 400,
    totalScore: 5000,
    players: [
      { player: 0, vehicle: 'lancer', score: 3000, kills: 1, damage: 1, shards: 1, revives: 0, bestCombo: 1, roundWins: 0 },
      { player: 1, vehicle: 'bulwark', score: 2000, kills: 1, damage: 1, shards: 1, revives: 0, bestCombo: 1, roundWins: 0 },
    ],
    mvp: 0,
    ...patch,
  };
}

describe('SaveStore load chain', () => {
  it('creates and persists a fresh profile on first boot', () => {
    const h = harness();
    const r = h.store.load();
    expect(r.status).toBe('ok');
    expect(r.data).toEqual(createDefaultSave());
    expect(stored(h.mem)).toEqual(createDefaultSave());
  });

  it('round trip: a commit is visible to a fresh store on the same storage', () => {
    const h = harness();
    h.store.load();
    const res = h.store.commit({ coresDelta: 75, meta: { hullFw: 1 }, spentDelta: { hullFw: 20 } });
    expect(res.ok).toBe(true);
    const again = harness(h.mem).store.load();
    expect(again.status).toBe('ok');
    expect(again.data.cores).toBe(75);
    expect(again.data.lifetimeCores).toBe(75);
    expect(again.data.meta).toEqual({ hullFw: 1 });
  });

  it('loads a valid v1 save without rewriting it', () => {
    const mem = new MemoryStorage();
    mem.rawSet(SAVE_KEYS.main, validRaw);
    const h = harness(mem);
    const r = h.store.load();
    expect(r.status).toBe('ok');
    expect(r.data.cores).toBe(137);
    expect(mem.writes).toHaveLength(0);
  });

  it('sanitises an over-levelled save with a refund and rewrites it (old envelope to .bak)', () => {
    const mem = new MemoryStorage();
    mem.rawSet(SAVE_KEYS.main, overRaw);
    const r = harness(mem).store.load();
    expect(r.status).toBe('ok');
    expect(r.data.cores).toBe(280);
    expect(stored(mem).meta).toEqual({ hullFw: 5, rerollCache: 2, preCharge: 1 });
    expect(mem.rawGet(SAVE_KEYS.backup)).toBe(overRaw);
  });

  it('a crc mismatch falls back to .bak and quarantines the corrupt blob', () => {
    const mem = new MemoryStorage();
    const tampered = validRaw.replace('"cores": 137', '"cores": 999999');
    mem.rawSet(SAVE_KEYS.main, tampered);
    mem.rawSet(SAVE_KEYS.backup, validRaw);
    const r = harness(mem).store.load();
    expect(r.status).toBe('restoredBackup');
    expect(r.data.cores).toBe(137);
    expect(mem.rawGet(SAVE_KEYS.corrupt)).toBe(tampered);
    expect(stored(mem).cores).toBe(137);
  });

  it('a missing main with a good .bak restores the backup', () => {
    const mem = new MemoryStorage();
    mem.rawSet(SAVE_KEYS.backup, validRaw);
    const r = harness(mem).store.load();
    expect(r.status).toBe('restoredBackup');
    expect(r.data.cores).toBe(137);
  });

  it('main and .bak both corrupt: defaults, quarantine, status reset', () => {
    const mem = new MemoryStorage();
    mem.rawSet(SAVE_KEYS.main, corruptRaw);
    mem.rawSet(SAVE_KEYS.backup, 'garbage');
    const r = harness(mem).store.load();
    expect(r.status).toBe('reset');
    expect(r.data).toEqual(createDefaultSave());
    expect(mem.rawGet(SAVE_KEYS.corrupt)).toBe(corruptRaw);
    expect(stored(mem)).toEqual(createDefaultSave());
  });

  it('future-v99: read-only on defaults and never written', () => {
    const mem = new MemoryStorage();
    mem.rawSet(SAVE_KEYS.main, futureRaw);
    const h = harness(mem);
    const r = h.store.load();
    expect(r.status).toBe('readOnlyFuture');
    expect(h.store.status).toBe('readOnlyFuture');
    expect(r.data).toEqual(createDefaultSave());
    expect(h.store.commit({ coresDelta: 5 })).toEqual({ ok: false, error: 'readOnly' });
    expect(h.store.commitRun('r', { coresDelta: 5 })).toEqual({ ok: false, error: 'readOnly' });
    h.store.commitDebounced({ settings: { master: 0.1 } });
    expect(h.store.data.settings.master).toBe(0.1); // usable in memory
    h.store.tick(1e9);
    h.store.flush();
    expect(mem.writes).toHaveLength(0);
    expect(mem.rawGet(SAVE_KEYS.main)).toBe(futureRaw);
  });

  it('a future .bak behind a corrupt main is also read-only', () => {
    const mem = new MemoryStorage();
    mem.rawSet(SAVE_KEYS.main, corruptRaw);
    mem.rawSet(SAVE_KEYS.backup, futureRaw);
    expect(harness(mem).store.load().status).toBe('readOnlyFuture');
    expect(mem.rawGet(SAVE_KEYS.backup)).toBe(futureRaw);
  });

  it('MemoryStorage that throws SecurityError: memory-only mode that still works', () => {
    const mem = new MemoryStorage();
    mem.failMode = 'security';
    const h = harness(mem);
    const r = h.store.load();
    expect(r.status).toBe('memoryOnly');
    expect(h.store.commit({ coresDelta: 10 }).ok).toBe(true);
    expect(h.store.data.cores).toBe(10);
  });
});

describe('SaveStore writes', () => {
  it('writes .bak (previous good envelope) before main and bumps rev', () => {
    const h = harness();
    h.store.load();
    const first = h.mem.rawGet(SAVE_KEYS.main);
    h.mem.writes.length = 0;
    h.store.commit({ coresDelta: 1 });
    expect(h.mem.writes.map((w) => w.key)).toEqual([SAVE_KEYS.backup, SAVE_KEYS.main]);
    expect(h.mem.rawGet(SAVE_KEYS.backup)).toBe(first);
    const env = JSON.parse(h.mem.rawGet(SAVE_KEYS.main)!) as { rev: number; v: number };
    expect(env.v).toBe(1);
    expect(env.rev).toBe(2);
  });

  it('QuotaExceeded: evicts .corrupt and retries once', () => {
    const h = harness();
    h.store.load();
    h.mem.rawSet(SAVE_KEYS.corrupt, 'x'.repeat(100));
    h.mem.failNextWrites = 1;
    const r = h.store.commit({ coresDelta: 3 });
    expect(r.ok).toBe(true);
    expect(h.mem.rawGet(SAVE_KEYS.corrupt)).toBeNull();
    expect(stored(h.mem).cores).toBe(3);
  });

  it('QuotaExceeded twice: error, in-memory state kept', () => {
    const h = harness();
    h.store.load();
    h.mem.failMode = 'quota';
    const r = h.store.commit({ coresDelta: 3 });
    expect(r).toEqual({ ok: false, error: 'quota' });
    expect(h.store.data.cores).toBe(3);
    expect(stored(h.mem).cores).toBe(0);
  });

  it('a storage that becomes unusable reports unavailable', () => {
    const h = harness();
    h.store.load();
    h.mem.failMode = 'security';
    expect(h.store.commit({ coresDelta: 3 })).toEqual({ ok: false, error: 'unavailable' });
  });

  it('delta commit preserves a simulated second tab write', () => {
    const mem = new MemoryStorage();
    const a = harness(mem);
    a.store.load();
    const b = harness(mem);
    b.store.load();
    expect(b.store.commit({ coresDelta: 50, unlock: 'specter' }).ok).toBe(true);
    const r = a.store.commit({ coresDelta: -20, meta: { magnetFw: 1 }, spentDelta: { magnetFw: 15 } });
    expect(r.ok).toBe(true);
    const s = stored(mem);
    expect(s.cores).toBe(30);
    expect(s.unlocks).toContain('specter');
    expect(s.meta).toEqual({ magnetFw: 1 });
    expect(a.store.data).toEqual(s);
  });

  it('commitRun twice with the same runId: duplicate, granted once (also across tabs)', () => {
    const mem = new MemoryStorage();
    const a = harness(mem);
    a.store.load();
    const b = harness(mem);
    b.store.load();
    const first = a.store.commitRun('run-1', { coresDelta: 40, run: run('run-1') });
    expect(first.ok).toBe(true);
    expect(a.store.commitRun('run-1', { coresDelta: 40, run: run('run-1') })).toEqual({
      ok: false,
      error: 'duplicate',
    });
    expect(b.store.commitRun('run-1', { coresDelta: 40, run: run('run-1') })).toEqual({
      ok: false,
      error: 'duplicate',
    });
    const s = stored(mem);
    expect(s.cores).toBe(40);
    expect(s.lastCommittedRunId).toBe('run-1');
    expect(s.records.runs).toBe(1);
    expect(s.records.bestWave).toBe(8);
    expect(s.records.leaderboard).toHaveLength(1);
    expect(a.store.commitRun('run-2', { coresDelta: 1 }).ok).toBe(true);
  });

  it('debounce is flushed by tick() after 500 ms and by flush()', () => {
    const h = harness();
    h.store.load();
    h.mem.writes.length = 0;
    h.store.commitDebounced({ settings: { music: 0.2 } });
    h.store.commitDebounced({ settings: { sfx: 0.3 } });
    expect(h.store.data.settings).toMatchObject({ music: 0.2, sfx: 0.3 });
    h.store.tick(h.clock.now() + SAVE_DEBOUNCE_MS - 1);
    expect(h.mem.writes).toHaveLength(0);
    h.store.tick(h.clock.now() + SAVE_DEBOUNCE_MS);
    expect(stored(h.mem).settings).toMatchObject({ music: 0.2, sfx: 0.3 });
    h.store.commitDebounced({ settings: { master: 0.4 } });
    h.store.flush();
    expect(stored(h.mem).settings.master).toBe(0.4);
    const writes = h.mem.writes.length;
    h.store.flush();
    h.store.tick(1e12);
    expect(h.mem.writes).toHaveLength(writes);
  });

  it('a commit keeps pending debounced settings visible in memory', () => {
    const h = harness();
    h.store.load();
    h.store.commitDebounced({ settings: { showFps: true } });
    h.store.commit({ coresDelta: 5 });
    expect(h.store.data.settings.showFps).toBe(true);
    expect(stored(h.mem).settings.showFps).toBe(false);
    h.store.flush();
    expect(stored(h.mem)).toMatchObject({ cores: 5 });
    expect(stored(h.mem).settings.showFps).toBe(true);
  });

  it('respec deltas do not count toward lifetime Cores', () => {
    const h = harness();
    h.store.load();
    h.store.commit({ coresDelta: 100 });
    h.store.commit({ coresDelta: -20, meta: { hullFw: 1 }, spentDelta: { hullFw: 20 } });
    h.store.commit({ coresDelta: 20, respec: true });
    expect(h.store.data).toMatchObject({ cores: 100, lifetimeCores: 100, meta: {}, firmwareSpent: {} });
  });
});

describe('SaveStore storage events', () => {
  it('reloads the cache from another tab while not in a run', () => {
    const mem = new MemoryStorage();
    const a = harness(mem);
    a.store.load();
    const seen: number[] = [];
    const off = a.store.onExternalChange((d) => seen.push(d.cores));
    harness(mem).store.commit({ coresDelta: 9 });
    a.store.handleStorageEvent('some.other.key');
    expect(seen).toEqual([]);
    a.store.handleStorageEvent(SAVE_KEYS.main);
    expect(seen).toEqual([9]);
    expect(a.store.data.cores).toBe(9);
    off();
    harness(mem).store.commit({ coresDelta: 1 });
    a.store.handleStorageEvent(null);
    expect(seen).toEqual([9]);
  });

  it('defers external changes until the run ends', () => {
    const mem = new MemoryStorage();
    const a = harness(mem);
    a.store.load();
    const seen: number[] = [];
    a.store.onExternalChange((d) => seen.push(d.cores));
    a.inRun = true;
    const b = harness(mem);
    b.store.load();
    b.store.commit({ coresDelta: 4 });
    a.store.handleStorageEvent(SAVE_KEYS.main);
    a.store.tick(0);
    expect(seen).toEqual([]);
    a.inRun = false;
    a.store.tick(0);
    expect(seen).toEqual([4]);
  });

  it('a newer build in another tab switches this tab to read-only', () => {
    const mem = new MemoryStorage();
    const a = harness(mem);
    a.store.load();
    mem.rawSet(SAVE_KEYS.main, futureRaw);
    a.store.handleStorageEvent(SAVE_KEYS.main);
    expect(a.store.status).toBe('readOnlyFuture');
    expect(a.store.commit({ coresDelta: 1 })).toEqual({ ok: false, error: 'readOnly' });
  });

  it('a commit that finds a newer-build save refuses to overwrite it', () => {
    const mem = new MemoryStorage();
    const a = harness(mem);
    a.store.load();
    mem.rawSet(SAVE_KEYS.main, futureRaw);
    expect(a.store.commit({ coresDelta: 1 })).toEqual({ ok: false, error: 'readOnly' });
    expect(mem.rawGet(SAVE_KEYS.main)).toBe(futureRaw);
  });

  it('a commit over a corrupted stored value quarantines it and writes from the cache', () => {
    const mem = new MemoryStorage();
    const a = harness(mem);
    a.store.load();
    a.store.commit({ coresDelta: 7 });
    mem.rawSet(SAVE_KEYS.main, corruptRaw);
    expect(a.store.commit({ coresDelta: 1 }).ok).toBe(true);
    expect(mem.rawGet(SAVE_KEYS.corrupt)).toBe(corruptRaw);
    expect(stored(mem).cores).toBe(8);
  });
});

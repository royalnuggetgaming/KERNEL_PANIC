/**
 * SaveStorePort implementation (plan section 6 "PERSISTENCE"):
 * - load chain: main -> .bak -> defaults (the corrupt blob is quarantined in .corrupt);
 * - crc check, migrations, sanitisation; a save from a newer build runs read-only on defaults, never written;
 * - DELTA commits: re-read the stored value, validate the delta against it (deltaConflicts: a stale Hangar
 *   delta from another tab's write is refused and the re-read value adopted), apply, sanitise, write .bak
 *   (previous good envelope) then main;
 * - QuotaExceeded: evict .corrupt and retry once, then keep the in-memory state and report 'quota'; a failed
 *   write (boot included) sets status 'memoryOnly' until a later write succeeds, so it can be surfaced (a
 *   refused stale delta, by contrast, leaves the status alone);
 * - commitRun idempotency via lastCommittedRunId; 500 ms debounce driven by tick(nowMs), deferred while a run
 *   is live (plan: never write while Playing; flush() on pagehide/hidden still writes); storage-event sync.
 */
import type { Logger, Result, ThemeId } from '../contracts/ids';
import {
  CURRENT_SAVE_VERSION,
  SAVE_KEYS,
  type KeyValueStorage,
  type Migration,
  type SaveDataV1,
  type SaveDelta,
  type SaveError,
  type SaveStatus,
  type SaveStorePort,
} from '../contracts/save';
import type { ClockPort } from '../contracts/services';
import { err, ok } from '../core/result';
import { createDefaultSave } from './defaults';
import { decodeEnvelope, encodeEnvelope } from './envelope';
import { MIGRATIONS } from './migrations';
import { sanitizeSave } from './sanitize';
import { applySaveDelta, deltaConflicts, mergeSaveDelta } from './saveDelta';
import { StorageWriteError, isQuotaError } from './storage';

export const SAVE_DEBOUNCE_MS = 500;

export interface SaveStoreDeps {
  readonly storage: KeyValueStorage;
  readonly memoryOnly: boolean;
  readonly clock: ClockPort;
  readonly log: Logger;
  readonly migrations?: Readonly<Record<number, Migration>>;
  /** External (other-tab) changes are applied only while this returns false. */
  readonly inRun: () => boolean;
}

export interface SaveStore extends SaveStorePort {
  /** Wire to window 'storage' events (Wave 3). */
  handleStorageEvent(key: string | null): void;
  /**
   * The saved theme id read without loading (no writes, no state change), so app/createServices can build the
   * theme's shaders before Boot. Main save, then backup, then the default theme.
   */
  peekThemeId(): ThemeId;
}

type WriteResult = Result<true, 'quota' | 'unavailable'>;

export function createSaveStore(deps: SaveStoreDeps): SaveStore {
  const kv = deps.storage;
  const log = deps.log;
  const migrations = deps.migrations ?? MIGRATIONS;
  const baseStatus: SaveStatus = deps.memoryOnly ? 'memoryOnly' : 'ok';

  /** Last state known to be in storage (or kept in memory after a failed write), without pending edits. */
  let persisted: SaveDataV1 = createDefaultSave();
  /** What the game sees: persisted plus the pending debounced delta. */
  let data: SaveDataV1 = persisted;
  let status: SaveStatus = baseStatus;
  let readOnly = false;
  let rev = 0;
  /** Raw envelope most recently loaded or written successfully (becomes .bak on the next write). */
  let lastGoodRaw: string | null = null;
  let pending: SaveDelta | null = null;
  let dueAt = 0;
  let externalDirty = false;
  const listeners = new Set<(d: SaveDataV1) => void>();

  const decode = (raw: string | null) => decodeEnvelope(raw, migrations);

  const quarantine = (raw: string): void => {
    try {
      kv.set(SAVE_KEYS.corrupt, raw);
    } catch (e) {
      log.warn('save: could not quarantine corrupt blob', e);
    }
  };

  const writePair = (raw: string, prevGood: string | null): void => {
    if (prevGood !== null) kv.set(SAVE_KEYS.backup, prevGood);
    kv.set(SAVE_KEYS.main, raw);
  };

  const failureOf = (e: unknown): 'quota' | 'unavailable' =>
    e instanceof StorageWriteError ? e.kind : isQuotaError(e) ? 'quota' : 'unavailable';

  const failed = (kind: 'quota' | 'unavailable'): WriteResult => {
    if (status !== 'readOnlyFuture') status = 'memoryOnly';
    return err(kind);
  };

  /** Writes `next` as rev + 1; evicts .corrupt and retries once on QuotaExceeded. */
  const write = (next: SaveDataV1, prevGood: string | null, baseRev: number): WriteResult => {
    const raw = encodeEnvelope(next, baseRev + 1, deps.clock.now());
    try {
      writePair(raw, prevGood);
    } catch (e) {
      const kind = failureOf(e);
      if (kind !== 'quota') {
        log.warn('save: storage unavailable', e);
        return failed('unavailable');
      }
      kv.remove(SAVE_KEYS.corrupt);
      try {
        writePair(raw, prevGood);
      } catch (e2) {
        log.warn('save: quota exceeded after evicting .corrupt', e2);
        return failed(failureOf(e2));
      }
    }
    if (status === 'memoryOnly' && !deps.memoryOnly) status = 'ok';
    rev = baseRev + 1;
    lastGoodRaw = raw;
    return ok(true);
  };

  const withPending = (d: SaveDataV1): SaveDataV1 =>
    pending === null ? d : sanitizeSave(applySaveDelta(d, pending, deps.clock.now())).data;

  const enterReadOnly = (): void => {
    readOnly = true;
    status = 'readOnlyFuture';
    pending = null;
  };

  const setLoaded = (d: SaveDataV1): void => {
    persisted = d;
    data = d;
  };

  const load = (): {
    readonly data: SaveDataV1;
    readonly status: SaveStatus;
    readonly migratedFrom?: number;
  } => {
    readOnly = false;
    pending = null;
    externalDirty = false;
    rev = 0;
    lastGoodRaw = null;
    const rawMain = kv.get(SAVE_KEYS.main);
    const rawBak = kv.get(SAVE_KEYS.backup);
    if (rawMain === null && rawBak === null) {
      setLoaded(createDefaultSave());
      status = baseStatus;
      const w = write(data, null, 0);
      if (!w.ok) log.warn('save: could not write the fresh profile', w.error);
      return { data, status };
    }
    const main = rawMain === null ? null : decode(rawMain);
    if (main?.kind === 'ok') {
      setLoaded(main.data);
      rev = main.rev;
      lastGoodRaw = rawMain;
      status = baseStatus;
      if (main.dirty) {
        const w = write(data, rawMain, rev);
        if (!w.ok) log.warn('save: could not rewrite the migrated save', w.error);
      }
      return main.from < CURRENT_SAVE_VERSION ? { data, status, migratedFrom: main.from } : { data, status };
    }
    if (main?.kind === 'future') {
      enterReadOnly();
      setLoaded(createDefaultSave());
      log.warn('save: written by a newer build; running read-only on defaults', main.v);
      return { data, status };
    }
    if (rawMain !== null) {
      log.warn('save: main save unreadable', main?.kind === 'corrupt' ? main.reason : null);
      quarantine(rawMain);
    }
    const bak = decode(rawBak);
    if (bak.kind === 'ok') {
      setLoaded(bak.data);
      rev = bak.rev;
      lastGoodRaw = rawBak;
      status = deps.memoryOnly ? baseStatus : 'restoredBackup';
      const w = write(data, rawBak, rev);
      if (!w.ok) log.warn('save: could not restore the backup to main', w.error);
      return { data, status };
    }
    if (bak.kind === 'future') {
      enterReadOnly();
      setLoaded(createDefaultSave());
      return { data, status };
    }
    setLoaded(createDefaultSave());
    status = deps.memoryOnly ? baseStatus : 'reset';
    const w = write(data, null, 0);
    if (!w.ok) log.warn('save: could not write the reset profile', w.error);
    return { data, status };
  };

  /** Adopts a re-read stored value as the persisted state (pending edits stay on top) and tells listeners. */
  const adopt = (raw: string, d: SaveDataV1, storedRev: number): void => {
    rev = Math.max(rev, storedRev);
    lastGoodRaw = raw;
    persisted = d;
    data = withPending(d);
    for (const cb of [...listeners]) cb(data);
  };

  /** Delta commit against the freshly re-read stored value. */
  const commitDelta = (
    d: SaveDelta,
    runId: string | null,
  ): Result<SaveDataV1, SaveError | 'duplicate' | 'conflict'> => {
    if (readOnly) return err('readOnly');
    const stored = kv.get(SAVE_KEYS.main);
    let base = persisted;
    let baseRev = rev;
    let prevGood = lastGoodRaw;
    let fresh: { readonly raw: string; readonly rev: number } | null = null;
    if (stored !== null && stored !== lastGoodRaw) {
      const dec = decode(stored);
      if (dec.kind === 'ok') {
        base = dec.data;
        baseRev = Math.max(rev, dec.rev);
        prevGood = stored;
        fresh = { raw: stored, rev: dec.rev };
      } else if (dec.kind === 'future') {
        enterReadOnly();
        return err('readOnly');
      } else {
        quarantine(stored);
      }
    }
    if (runId !== null && (base.lastCommittedRunId === runId || persisted.lastCommittedRunId === runId))
      return err('duplicate');
    if (deltaConflicts(base, d)) {
      // Computed from a stale cache: refuse it and show the stored truth instead.
      if (fresh !== null) adopt(fresh.raw, base, fresh.rev);
      return err('conflict');
    }
    const next = sanitizeSave(applySaveDelta(base, d, deps.clock.now(), runId)).data;
    const w = write(next, prevGood, baseRev);
    // The in-memory state always moves on (even when storage failed) so the session stays consistent.
    persisted = next;
    data = withPending(next);
    if (!w.ok) return err(w.error);
    return ok(data);
  };

  const flush = (): void => {
    if (pending === null) return;
    const d = pending;
    pending = null;
    const r = commitDelta(d, null);
    if (!r.ok) log.warn('save: debounced commit failed', r.error);
  };

  const reloadExternal = (): void => {
    externalDirty = false;
    if (readOnly) return;
    const raw = kv.get(SAVE_KEYS.main);
    if (raw === null || raw === lastGoodRaw) return;
    const dec = decode(raw);
    if (dec.kind === 'future') {
      enterReadOnly();
      return;
    }
    if (dec.kind !== 'ok') return;
    adopt(raw, dec.data, dec.rev);
  };

  const peekThemeId = (): ThemeId => {
    for (const key of [SAVE_KEYS.main, SAVE_KEYS.backup]) {
      const dec = decode(kv.get(key));
      if (dec.kind === 'ok') return dec.data.settings.themeId;
      if (dec.kind === 'future') break;
    }
    return createDefaultSave().settings.themeId;
  };

  return {
    load,
    peekThemeId,
    get data(): SaveDataV1 {
      return data;
    },
    get status(): SaveStatus {
      return status;
    },
    commit(d: SaveDelta): Result<SaveDataV1, SaveError> {
      const r = commitDelta(d, null);
      if (r.ok) return r;
      // A conflict leaves `data` refreshed from storage; callers re-evaluate their operation against it.
      return err(r.error === 'duplicate' || r.error === 'conflict' ? 'unavailable' : r.error);
    },
    commitRun(runId: string, d: SaveDelta): Result<SaveDataV1, SaveError | 'duplicate'> {
      const r = commitDelta(d, runId);
      if (r.ok) return r;
      return err(r.error === 'conflict' ? 'unavailable' : r.error);
    },
    commitDebounced(d: SaveDelta): void {
      data = sanitizeSave(applySaveDelta(data, d, deps.clock.now())).data;
      if (readOnly) {
        persisted = data;
        return;
      }
      pending = mergeSaveDelta(pending, d);
      dueAt = deps.clock.now() + SAVE_DEBOUNCE_MS;
    },
    tick(nowMs: number): void {
      if (externalDirty && !deps.inRun()) reloadExternal();
      // Never while a run is live (localStorage is synchronous): Paused edits wait for the run to end, or for
      // pagehide/hidden, which call flush() directly.
      if (pending !== null && nowMs >= dueAt && !deps.inRun()) flush();
    },
    flush,
    onExternalChange(cb: (d: SaveDataV1) => void): () => void {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    handleStorageEvent(key: string | null): void {
      if (key !== null && key !== SAVE_KEYS.main) return;
      externalDirty = true;
      if (!deps.inRun()) reloadExternal();
    },
  };
}

/**
 * SaveStorePort implementation (plan section 6 "PERSISTENCE"):
 * - load chain: main -> .bak -> defaults (the corrupt blob is quarantined in .corrupt);
 * - crc check, migrations, sanitisation; a save from a newer build runs read-only on defaults, never written;
 * - DELTA commits: re-read the stored value, apply, validate, write .bak (previous good envelope) then main;
 * - QuotaExceeded: evict .corrupt and retry once, then keep the in-memory state and report 'quota';
 * - commitRun idempotency via lastCommittedRunId; 500 ms debounce driven by tick(nowMs); storage-event sync.
 */
import type { Logger, Result } from '../contracts/ids';
import {
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
import { applySaveDelta, mergeSaveDelta } from './saveDelta';
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
}

type WriteResult = Result<true, 'quota' | 'unavailable'>;

export function createSaveStore(deps: SaveStoreDeps): SaveStore {
  const kv = deps.storage;
  const log = deps.log;
  const migrations = deps.migrations ?? MIGRATIONS;
  const baseStatus: SaveStatus = deps.memoryOnly ? 'memoryOnly' : 'ok';

  let data: SaveDataV1 = createDefaultSave();
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

  /** Writes `next` as rev + 1; evicts .corrupt and retries once on QuotaExceeded. */
  const write = (next: SaveDataV1, prevGood: string | null, baseRev: number): WriteResult => {
    const raw = encodeEnvelope(next, baseRev + 1, deps.clock.now());
    try {
      writePair(raw, prevGood);
    } catch (e) {
      const kind = failureOf(e);
      if (kind !== 'quota') {
        log.warn('save: storage unavailable', e);
        return err('unavailable');
      }
      kv.remove(SAVE_KEYS.corrupt);
      try {
        writePair(raw, prevGood);
      } catch (e2) {
        log.warn('save: quota exceeded after evicting .corrupt', e2);
        return err(failureOf(e2));
      }
    }
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

  const load = (): { readonly data: SaveDataV1; readonly status: SaveStatus } => {
    readOnly = false;
    pending = null;
    externalDirty = false;
    rev = 0;
    lastGoodRaw = null;
    const rawMain = kv.get(SAVE_KEYS.main);
    const rawBak = kv.get(SAVE_KEYS.backup);
    if (rawMain === null && rawBak === null) {
      data = createDefaultSave();
      status = baseStatus;
      const w = write(data, null, 0);
      if (!w.ok) log.warn('save: could not write the fresh profile', w.error);
      return { data, status };
    }
    const main = rawMain === null ? null : decode(rawMain);
    if (main?.kind === 'ok') {
      data = main.data;
      rev = main.rev;
      lastGoodRaw = rawMain;
      status = baseStatus;
      if (main.dirty) {
        const w = write(data, rawMain, rev);
        if (!w.ok) log.warn('save: could not rewrite the migrated save', w.error);
      }
      return { data, status };
    }
    if (main?.kind === 'future') {
      enterReadOnly();
      data = createDefaultSave();
      log.warn('save: written by a newer build; running read-only on defaults', main.v);
      return { data, status };
    }
    if (rawMain !== null) {
      log.warn('save: main save unreadable', main?.kind === 'corrupt' ? main.reason : null);
      quarantine(rawMain);
    }
    const bak = decode(rawBak);
    if (bak.kind === 'ok') {
      data = bak.data;
      rev = bak.rev;
      lastGoodRaw = rawBak;
      status = deps.memoryOnly ? baseStatus : 'restoredBackup';
      const w = write(data, rawBak, rev);
      if (!w.ok) log.warn('save: could not restore the backup to main', w.error);
      return { data, status };
    }
    if (bak.kind === 'future') {
      enterReadOnly();
      data = createDefaultSave();
      return { data, status };
    }
    data = createDefaultSave();
    status = deps.memoryOnly ? baseStatus : 'reset';
    const w = write(data, null, 0);
    if (!w.ok) log.warn('save: could not write the reset profile', w.error);
    return { data, status };
  };

  /** Delta commit against the freshly re-read stored value. */
  const commitDelta = (
    d: SaveDelta,
    runId: string | null,
  ): Result<SaveDataV1, SaveError | 'duplicate'> => {
    if (readOnly) return err('readOnly');
    const stored = kv.get(SAVE_KEYS.main);
    let base = data;
    let baseRev = rev;
    let prevGood = lastGoodRaw;
    if (stored !== null && stored !== lastGoodRaw) {
      const dec = decode(stored);
      if (dec.kind === 'ok') {
        base = dec.data;
        baseRev = Math.max(rev, dec.rev);
        prevGood = stored;
      } else if (dec.kind === 'future') {
        enterReadOnly();
        return err('readOnly');
      } else {
        quarantine(stored);
      }
    }
    if (runId !== null && (base.lastCommittedRunId === runId || data.lastCommittedRunId === runId))
      return err('duplicate');
    const next = sanitizeSave(applySaveDelta(base, d, deps.clock.now(), runId)).data;
    const w = write(next, prevGood, baseRev);
    // The in-memory state always moves on (even when storage failed) so the session stays consistent.
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
    rev = Math.max(rev, dec.rev);
    lastGoodRaw = raw;
    data = withPending(dec.data);
    for (const cb of [...listeners]) cb(data);
  };

  return {
    load,
    get data(): SaveDataV1 {
      return data;
    },
    get status(): SaveStatus {
      return status;
    },
    commit(d: SaveDelta): Result<SaveDataV1, SaveError> {
      const r = commitDelta(d, null);
      if (r.ok) return r;
      return err(r.error === 'duplicate' ? 'unavailable' : r.error);
    },
    commitRun(runId: string, d: SaveDelta): Result<SaveDataV1, SaveError | 'duplicate'> {
      return commitDelta(d, runId);
    },
    commitDebounced(d: SaveDelta): void {
      data = sanitizeSave(applySaveDelta(data, d, deps.clock.now())).data;
      if (readOnly) return;
      pending = mergeSaveDelta(pending, d);
      dueAt = deps.clock.now() + SAVE_DEBOUNCE_MS;
    },
    tick(nowMs: number): void {
      if (externalDirty && !deps.inRun()) reloadExternal();
      if (pending !== null && nowMs >= dueAt) flush();
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

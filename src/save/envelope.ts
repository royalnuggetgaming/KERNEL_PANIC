/**
 * The localStorage envelope { v, ts, rev, crc: crc32(stableStringify(data)), data }: encoding and the
 * decode chain (parse without prototype keys, version gate, crc check, migrations, sanitise).
 */
import { CURRENT_SAVE_VERSION, type Migration, type SaveDataV1 } from '../contracts/save';
import { crc32, stableStringify } from '../core/hash';
import { migrate } from './migrations';
import { safeJsonParse, sanitizeSave } from './sanitize';
import { isRecord } from './sanitizeParts';

export type Decoded =
  | {
      readonly kind: 'ok';
      readonly data: SaveDataV1;
      readonly rev: number;
      /** Migrated or sanitised: the stored copy should be rewritten. */
      readonly dirty: boolean;
      /** Version the stored copy was written with (< CURRENT_SAVE_VERSION = migrated now). */
      readonly from: number;
    }
  | { readonly kind: 'future'; readonly v: number }
  | { readonly kind: 'corrupt'; readonly reason: string };

export function encodeEnvelope(data: SaveDataV1, rev: number, ts: number): string {
  return JSON.stringify({ v: CURRENT_SAVE_VERSION, ts, rev, crc: crc32(stableStringify(data)), data });
}

function corrupt(reason: string): Decoded {
  return { kind: 'corrupt', reason };
}

export function decodeEnvelope(
  raw: string | null,
  migrations: Readonly<Record<number, Migration>>,
  target: number = CURRENT_SAVE_VERSION,
): Decoded {
  if (raw === null) return corrupt('missing');
  const env = safeJsonParse(raw);
  if (!isRecord(env)) return corrupt('not an envelope');
  const v = env.v;
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) return corrupt('bad version');
  if (v > target) return { kind: 'future', v };
  if (!('data' in env)) return corrupt('no data');
  if (typeof env.crc !== 'number' || env.crc !== crc32(stableStringify(env.data)))
    return corrupt('crc mismatch');
  let migrated: unknown;
  try {
    migrated = migrate(env.data, v, migrations, target);
  } catch (e) {
    return corrupt(e instanceof Error ? e.message : 'migration failed');
  }
  const s = sanitizeSave(migrated);
  const rev = typeof env.rev === 'number' && Number.isSafeInteger(env.rev) && env.rev >= 0 ? env.rev : 0;
  return { kind: 'ok', data: s.data, rev, dirty: s.changed || v !== target, from: v };
}

/**
 * Save migration chain: registry[v] is a pure v -> v + 1 step (tests may inject their own registries).
 *
 * v1 -> v2 (Firmware redesign): Magnet FW and Reroll Cache were merged into Boot Cache and Field Medic into
 * Hull FW. Every Core recorded in firmwareSpent for a removed line is refunded to `cores` (never lost), their
 * levels are dropped, and an empty `cheats` section is added. Unknown shapes pass through for sanitizeSave.
 */
import { CURRENT_SAVE_VERSION, type Migration } from '../contracts/save';
import { ECONOMY } from '../config/tuning';

/** Firmware ids removed by the v2 merge. */
export const RETIRED_FIRMWARE_V2: readonly string[] = ['rerollCache', 'magnetFw', 'fieldMedic'];

type Loose = Record<string, unknown>;

function isRecord(v: unknown): v is Loose {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function spentOf(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0
    ? Math.min(ECONOMY.CORES_MAX, Math.floor(v))
    : 0;
}

/** v1 -> v2: refund and drop the retired Firmware lines, add `cheats`. */
export function migrateV1toV2(data: unknown): unknown {
  if (!isRecord(data)) return data;
  const meta: Loose = isRecord(data.meta) ? { ...data.meta } : {};
  const spent: Loose = isRecord(data.firmwareSpent) ? { ...data.firmwareSpent } : {};
  let refund = 0;
  for (const id of RETIRED_FIRMWARE_V2) {
    refund += spentOf(spent[id]);
    delete spent[id];
    delete meta[id];
  }
  const cores = spentOf(data.cores);
  return {
    ...data,
    cores: Math.min(ECONOMY.CORES_MAX, cores + refund),
    meta,
    firmwareSpent: spent,
    cheats: isRecord(data.cheats) ? data.cheats : { unlocked: [], enabled: [] },
  };
}

export const MIGRATIONS: Readonly<Record<number, Migration>> = Object.freeze({ 1: migrateV1toV2 });

/** Applies registry[v] for v = from .. target-1. Throws on a missing step or a version above the target. */
export function migrate(
  data: unknown,
  fromVersion: number,
  registry: Readonly<Record<number, Migration>> = MIGRATIONS,
  target: number = CURRENT_SAVE_VERSION,
): unknown {
  if (!Number.isSafeInteger(fromVersion) || fromVersion < 0)
    throw new RangeError(`migrate: invalid source version ${fromVersion}`);
  if (fromVersion > target) throw new RangeError(`migrate: version ${fromVersion} is newer than ${target}`);
  let out = data;
  for (let v = fromVersion; v < target; v++) {
    const step = Object.prototype.hasOwnProperty.call(registry, v) ? registry[v] : undefined;
    if (step === undefined) throw new RangeError(`migrate: no migration from v${v} to v${v + 1}`);
    out = step(out);
  }
  return out;
}

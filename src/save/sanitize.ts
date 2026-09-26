/**
 * Save sanitisation (plan section 6 "Load" step 4): prototype-key stripping, type guards, integer coercion,
 * Firmware level clamping with Core refunds from firmwareSpent, unknown ids dropped, unlock dedupe (starters
 * always unlocked), binding re-validation and the 10-entry leaderboard cap. Never throws.
 */
import { META_UPGRADE_IDS, type MetaUpgradeId, type VehicleId } from '../contracts/ids';
import type { SaveDataV1 } from '../contracts/save';
import { metaDef, metaMaxLevel } from '../config/metaCatalog';
import { ECONOMY } from '../config/tuning';
import { STARTER_VEHICLES } from '../config/vehicles';
import { stableStringify } from '../core/hash';
import {
  int,
  isRecord,
  isVehicle,
  sanitizeBindings,
  sanitizeLoadout,
  sanitizeMode,
  sanitizeRecords,
  sanitizeRunId,
  sanitizeSettings,
  type Loose,
} from './sanitizeParts';

const BANNED_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);
const META_SET: ReadonlySet<string> = new Set(META_UPGRADE_IDS);

/** JSON.parse with a reviver dropping __proto__/constructor/prototype keys; null on syntax error. */
export function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text, (key: string, value: unknown) => (BANNED_KEYS.has(key) ? undefined : value));
  } catch {
    return null;
  }
}

export interface SanitizeResult {
  readonly data: SaveDataV1;
  readonly refunded: number;
  readonly changed: boolean;
}

/** Catalog cost of Firmware levels [0, level). */
function costUpTo(id: MetaUpgradeId, level: number): number {
  const prices = metaDef(id).prices;
  let sum = 0;
  for (let i = 0; i < level && i < prices.length; i++) sum += prices[i]!;
  return sum;
}

interface MetaResult {
  readonly meta: Partial<Record<MetaUpgradeId, number>>;
  readonly spent: Partial<Record<MetaUpgradeId, number>>;
  readonly refunded: number;
}

/**
 * Clamps each level to [0, max]. Recorded spend above the catalog cost of the kept levels is refunded;
 * spend recorded for unknown ids is refunded in full.
 */
function sanitizeMeta(rawMeta: unknown, rawSpent: unknown): MetaResult {
  const metaIn: Loose = isRecord(rawMeta) ? rawMeta : {};
  const spentIn: Loose = isRecord(rawSpent) ? rawSpent : {};
  const meta: Partial<Record<MetaUpgradeId, number>> = {};
  const spent: Partial<Record<MetaUpgradeId, number>> = {};
  let refunded = 0;
  for (const id of META_UPGRADE_IDS) {
    const level = int(metaIn[id], 0, metaMaxLevel(id), 0);
    const recorded = int(spentIn[id], 0, ECONOMY.CORES_MAX, 0);
    const kept = Math.min(recorded, costUpTo(id, level));
    refunded += recorded - kept;
    if (level > 0) meta[id] = level;
    if (kept > 0) spent[id] = kept;
  }
  for (const key of Object.keys(spentIn)) {
    if (!META_SET.has(key)) refunded += int(spentIn[key], 0, ECONOMY.CORES_MAX, 0);
  }
  return { meta, spent, refunded };
}

function sanitizeUnlocks(raw: unknown): VehicleId[] {
  const out: VehicleId[] = [...STARTER_VEHICLES];
  if (Array.isArray(raw)) for (const v of raw as readonly unknown[]) if (isVehicle(v) && !out.includes(v)) out.push(v);
  return out;
}

/** Builds a valid SaveDataV1 from anything. `changed` is true when the output differs from the input. */
export function sanitizeSave(raw: unknown): SanitizeResult {
  const r: Loose = isRecord(raw) ? raw : {};
  const meta = sanitizeMeta(r.meta, r.firmwareSpent);
  const unlocks = sanitizeUnlocks(r.unlocks);
  const cores = Math.min(ECONOMY.CORES_MAX, int(r.cores, 0, ECONOMY.CORES_MAX, 0) + meta.refunded);
  const data: SaveDataV1 = {
    cores,
    lifetimeCores: int(r.lifetimeCores, 0, Number.MAX_SAFE_INTEGER, 0),
    meta: meta.meta,
    firmwareSpent: meta.spent,
    unlocks,
    settings: sanitizeSettings(r.settings),
    bindings: sanitizeBindings(r.bindings),
    lastLoadout: sanitizeLoadout(r.lastLoadout, unlocks),
    lastMode: sanitizeMode(r.lastMode),
    records: sanitizeRecords(r.records),
    lastCommittedRunId: sanitizeRunId(r.lastCommittedRunId),
  };
  const changed = !isRecord(raw) || stableStringify(raw) !== stableStringify(data);
  return { data, refunded: meta.refunded, changed };
}

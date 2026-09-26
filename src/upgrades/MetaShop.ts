/**
 * Persistent Firmware (Hangar) operations: pure functions over SaveDataV1 that return the SaveDelta to
 * commit. Respec refunds the recorded firmwareSpent (never current prices); vehicle unlocks are permanent.
 */
import { META_UPGRADE_IDS, VEHICLE_IDS, type MetaUpgradeId, type VehicleId } from '../contracts/ids';
import type { SaveDataV1, SaveDelta } from '../contracts/save';
import { VEHICLE_UNLOCKS, metaLevel } from '../config/metaCatalog';
import { STARTER_VEHICLES } from '../config/vehicles';
import { metaPrice } from './pricing';

export type MetaFailure = 'funds' | 'maxLevel' | 'alreadyUnlocked' | 'nothingToRefund' | 'invalid';

export type MetaResult =
  | { readonly ok: true; readonly price: number; readonly delta: SaveDelta }
  | { readonly ok: false; readonly reason: MetaFailure };

const META_SET: ReadonlySet<string> = new Set(META_UPGRADE_IDS);
const VEHICLE_SET: ReadonlySet<string> = new Set(VEHICLE_IDS);

function fail(reason: MetaFailure): MetaResult {
  return { ok: false, reason };
}

function safeCores(save: SaveDataV1): number {
  return Number.isSafeInteger(save.cores) && save.cores > 0 ? save.cores : 0;
}

/** Buys the next level of a Firmware upgrade. */
export function metaBuy(save: SaveDataV1, id: MetaUpgradeId): MetaResult {
  if (!META_SET.has(id)) return fail('invalid');
  const level = metaLevel(save.meta, id);
  if (!Number.isSafeInteger(level) || level < 0) return fail('invalid');
  const price = metaPrice(id, level);
  if (price === null) return fail('maxLevel');
  if (safeCores(save) < price) return fail('funds');
  return {
    ok: true,
    price,
    delta: { coresDelta: -price, meta: { [id]: level + 1 }, spentDelta: { [id]: price } },
  };
}

export function isVehicleUnlocked(save: SaveDataV1, vehicle: VehicleId): boolean {
  return STARTER_VEHICLES.includes(vehicle) || save.unlocks.includes(vehicle);
}

function unlockPrice(vehicle: VehicleId): number | null {
  switch (vehicle) {
    case 'specter':
      return VEHICLE_UNLOCKS.specter;
    case 'tinker':
      return VEHICLE_UNLOCKS.tinker;
    case 'lancer':
    case 'bulwark':
      return null;
  }
}

/** Unlocks a vehicle for Cores (not refundable by respec). */
export function metaUnlock(save: SaveDataV1, vehicle: VehicleId): MetaResult {
  if (!VEHICLE_SET.has(vehicle)) return fail('invalid');
  if (isVehicleUnlocked(save, vehicle)) return fail('alreadyUnlocked');
  const price = unlockPrice(vehicle);
  if (price === null) return fail('invalid');
  if (safeCores(save) < price) return fail('funds');
  return { ok: true, price, delta: { coresDelta: -price, unlock: vehicle } };
}

/** Total Cores a respec would refund: the recorded firmwareSpent. */
export function respecRefund(save: SaveDataV1): number {
  let sum = 0;
  for (const id of META_UPGRADE_IDS) {
    const v = save.firmwareSpent[id];
    if (v !== undefined && Number.isSafeInteger(v) && v > 0) sum += v;
  }
  return sum;
}

/** Resets every Firmware level and refunds the recorded spend; unlocks stay. `price` is the refund. */
export function metaRespec(save: SaveDataV1): MetaResult {
  const refund = respecRefund(save);
  let anyLevel = false;
  for (const id of META_UPGRADE_IDS) if (metaLevel(save.meta, id) > 0) anyLevel = true;
  if (refund === 0 && !anyLevel) return fail('nothingToRefund');
  return { ok: true, price: refund, delta: { coresDelta: refund, respec: true } };
}

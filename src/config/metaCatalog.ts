/** Persistent Firmware (Cores) catalog with explicit per-level prices (plan section 6). */
import type { MetaLevels, MetaUpgradeId, VehicleId } from '../contracts/ids';
import type { MetaUpgradeDef } from '../contracts/upgrades';

export const META_UPGRADES: readonly MetaUpgradeDef[] = [
  {
    id: 'hullFw',
    label: 'Hull FW',
    blurb: '+5% max HP',
    prices: [20, 35, 55, 80, 110],
    modifiers: [{ stat: 'maxHp', op: 'add', value: 0.05 }],
  },
  {
    id: 'bootCache',
    label: 'Boot Cache',
    blurb: '+25 starting Shards',
    prices: [25, 45, 70, 100],
    modifiers: [],
  },
  {
    id: 'rerollCache',
    label: 'Reroll Cache',
    blurb: '+1 free reroll per visit',
    prices: [60, 120],
    modifiers: [],
  },
  {
    id: 'magnetFw',
    label: 'Magnet FW',
    blurb: '+10% pickup radius',
    prices: [15, 30, 50],
    modifiers: [{ stat: 'magnetRadius', op: 'add', value: 0.1 }],
  },
  {
    id: 'overclockFw',
    label: 'Overclock FW',
    blurb: '+3% fire rate',
    prices: [25, 40, 60, 85, 115],
    modifiers: [{ stat: 'fireRate', op: 'add', value: 0.03 }],
  },
  {
    id: 'fieldMedic',
    label: 'Field Medic',
    blurb: '-10% revive time',
    prices: [30, 55, 85],
    modifiers: [{ stat: 'reviveTime', op: 'add', value: -0.1 }],
  },
  {
    id: 'preCharge',
    label: 'Pre-Charge',
    blurb: 'Special starts 50% charged',
    prices: [80],
    modifiers: [],
  },
  {
    id: 'secondBoot',
    label: 'Second Boot',
    blurb: '+1 starting Spare Kernel',
    prices: [150],
    modifiers: [],
  },
  {
    id: 'legendaryPool',
    label: 'Legendary Pool',
    blurb: 'Unlocks Legendary patch cards',
    prices: [120],
    modifiers: [],
  },
];

export function metaDef(id: MetaUpgradeId): MetaUpgradeDef {
  for (const m of META_UPGRADES) if (m.id === id) return m;
  throw new RangeError(`unknown meta upgrade ${id}`);
}

export function metaMaxLevel(id: MetaUpgradeId): number {
  return metaDef(id).prices.length;
}

export function metaLevel(levels: MetaLevels, id: MetaUpgradeId): number {
  return levels[id] ?? 0;
}

/** Non-stat meta effects applied at run start. */
export const META_EFFECTS = {
  bootCacheShards: 25,
  rerollCachePerLevel: 1,
  preChargeOverdrive: 50,
  secondBootKernels: 1,
} as const;

/** Core price of each lockable vehicle. */
export const VEHICLE_UNLOCKS = { specter: 60, tinker: 90 } as const satisfies Readonly<
  Partial<Record<VehicleId, number>>
>;

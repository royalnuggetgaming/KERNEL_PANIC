/** Persistent Firmware (Cores) catalog with explicit per-level prices (plan section 6). */
import type { MetaLevels, MetaUpgradeId, VehicleId } from '../contracts/ids';
import type { MetaUpgradeDef } from '../contracts/upgrades';

/** Hangar sections in display order (vehicle unlocks are the separate CRAFT section). */
export const META_GROUPS = ['SURVIVAL', 'FIREPOWER', 'ECONOMY'] as const;
export type MetaGroup = (typeof META_GROUPS)[number];

/** Section of each Firmware line in the Hangar. */
export const META_GROUP_OF: Readonly<Record<MetaUpgradeId, MetaGroup>> = {
  hullFw: 'SURVIVAL',
  secondBoot: 'SURVIVAL',
  overclockFw: 'FIREPOWER',
  preCharge: 'FIREPOWER',
  bootCache: 'ECONOMY',
  legendaryPool: 'ECONOMY',
};

/**
 * Six Firmware lines (v3). Merged: Field Medic into Hull FW (revive time), Magnet FW and Reroll Cache into
 * Boot Cache (pickup radius, a free reroll every 2 levels). Display order follows META_GROUPS.
 */
export const META_UPGRADES: readonly MetaUpgradeDef[] = [
  {
    id: 'hullFw',
    label: 'Hull FW',
    blurb: '+5% max HP and -5% revive time',
    prices: [20, 35, 55, 80, 110],
    modifiers: [
      { stat: 'maxHp', op: 'add', value: 0.05 },
      { stat: 'reviveTime', op: 'add', value: -0.05 },
    ],
  },
  {
    id: 'secondBoot',
    label: 'Second Boot',
    blurb: '+1 starting Spare Kernel',
    prices: [150],
    modifiers: [],
  },
  {
    id: 'overclockFw',
    label: 'Overclock FW',
    blurb: '+3% fire rate',
    prices: [25, 40, 60, 85, 115],
    modifiers: [{ stat: 'fireRate', op: 'add', value: 0.03 }],
  },
  {
    id: 'preCharge',
    label: 'Pre-Charge',
    blurb: 'Special starts 50% charged',
    prices: [80],
    modifiers: [],
  },
  {
    id: 'bootCache',
    label: 'Boot Cache',
    blurb: '+25 starting Shards, +8% pickup radius, free rerolls',
    prices: [25, 45, 70, 100],
    modifiers: [{ stat: 'magnetRadius', op: 'add', value: 0.08 }],
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

/** Free rerolls per visit from Boot Cache. */
export function freeRerolls(levels: MetaLevels): number {
  return Math.floor(metaLevel(levels, 'bootCache') / META_EFFECTS.bootCacheRerollEvery);
}

/** Non-stat meta effects applied at run start. */
export const META_EFFECTS = {
  bootCacheShards: 25,
  /** Boot Cache: one free Patch Bay reroll per visit for every this-many levels (levels 2 and 4). */
  bootCacheRerollEvery: 2,
  preChargeOverdrive: 50,
  secondBootKernels: 1,
} as const;

/** Core price of each lockable vehicle. */
export const VEHICLE_UNLOCKS = { specter: 60, tinker: 90 } as const satisfies Readonly<
  Partial<Record<VehicleId, number>>
>;

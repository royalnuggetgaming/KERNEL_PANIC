/** Mid-run shop catalog: stat rows, repair, team row, utility prices (plan section 6). Catalog order matters. */
import type { StatRowId, TeamItemId } from '../contracts/ids';
import type { StatRowDef, TeamItemDef } from '../contracts/upgrades';

export const STAT_ROWS: readonly StatRowDef[] = [
  {
    id: 'thrusters',
    label: 'Thrusters',
    blurb: '+7% move speed',
    maxLevel: 6,
    base: 30,
    growth: 1.35,
    perLevel: [{ stat: 'moveSpeed', op: 'add', value: 0.07 }],
  },
  {
    id: 'plating',
    label: 'Plating',
    blurb: '+20 max HP (heals by the delta)',
    maxLevel: 8,
    base: 25,
    growth: 1.3,
    perLevel: [{ stat: 'maxHp', op: 'flat', value: 20 }],
  },
  {
    id: 'overclock',
    label: 'Overclock',
    blurb: '+12% fire rate',
    maxLevel: 8,
    base: 35,
    growth: 1.35,
    perLevel: [{ stat: 'fireRate', op: 'add', value: 0.12 }],
  },
  {
    id: 'payload',
    label: 'Payload',
    blurb: '+15% damage',
    maxLevel: 8,
    base: 35,
    growth: 1.35,
    perLevel: [{ stat: 'damageMul', op: 'add', value: 0.15 }],
  },
  {
    id: 'magnet',
    label: 'Magnet',
    blurb: '+25% pickup radius',
    maxLevel: 5,
    base: 20,
    growth: 1.3,
    perLevel: [{ stat: 'magnetRadius', op: 'add', value: 0.25 }],
  },
  {
    id: 'coolant',
    label: 'Coolant',
    blurb: '-12% dash cooldown',
    maxLevel: 5,
    base: 30,
    growth: 1.35,
    perLevel: [{ stat: 'dashCooldown', op: 'add', value: -0.12 }],
  },
  {
    id: 'capacitor',
    label: 'Capacitor',
    blurb: '+20% special charge',
    maxLevel: 5,
    base: 30,
    growth: 1.35,
    perLevel: [{ stat: 'specialChargeMul', op: 'add', value: 0.2 }],
  },
  {
    id: 'specialTuning',
    label: 'Special Tuning',
    blurb: 'Tier II/III: +25% radius, duration, damage',
    maxLevel: 2,
    base: 90,
    growth: 1.8,
    perLevel: [{ stat: 'specialTier', op: 'flat', value: 1 }],
  },
];

export function statRowDef(id: StatRowId): StatRowDef {
  for (const r of STAT_ROWS) if (r.id === id) return r;
  throw new RangeError(`unknown stat row ${id}`);
}

/** Repair: heals 35% max HP; price (15 + 4w) x 1.5^boughtThisVisit; max 2 per visit; rejected at full HP. */
export const REPAIR = {
  healFrac: 0.35,
  base: 15,
  perWave: 4,
  visitMul: 1.5,
  maxPerVisit: 2,
} as const;

export const TEAM_ITEMS: readonly TeamItemDef[] = [
  {
    id: 'spareKernel',
    label: 'Spare Kernel',
    blurb: 'Team extra life (hold 3)',
    prices: 'kernel',
    maxLevel: Number.POSITIVE_INFINITY,
    perVisit: 1,
    holdCap: 3,
    modifiers: [],
  },
  {
    id: 'linkAmp',
    label: 'Link Amplifier',
    blurb: '+40% link beam DPS',
    prices: [90, 150, 240],
    maxLevel: 3,
    perVisit: 3,
    holdCap: null,
    modifiers: [{ stat: 'linkDps', op: 'add', value: 0.4 }],
  },
  {
    id: 'linkRange',
    label: 'Link Range',
    blurb: 'Max link length 14 -> 18 -> 22',
    prices: [70, 130],
    maxLevel: 2,
    perVisit: 2,
    holdCap: null,
    modifiers: [{ stat: 'linkRange', op: 'flat', value: 4 }],
  },
  {
    id: 'reviveProtocol',
    label: 'Revive Protocol',
    blurb: 'Revive 2.0 s -> 1.2 s, revive HP 40% -> 60%',
    prices: [110],
    maxLevel: 1,
    perVisit: 1,
    holdCap: null,
    modifiers: [
      { stat: 'reviveTime', op: 'flat', value: -0.8 },
      { stat: 'reviveHpFrac', op: 'flat', value: 0.2 },
    ],
  },
];

export function teamItemDef(id: TeamItemId): TeamItemDef {
  for (const t of TEAM_ITEMS) if (t.id === id) return t;
  throw new RangeError(`unknown team item ${id}`);
}

/** Spare Kernel price: 150 x (1 + 0.5 x boughtThisRun). */
export const KERNEL_PRICE = { base: 150, perBought: 0.5 } as const;

export const UTILITY_PRICES = {
  /** Reroll: (5 + 5 x rerollsThisVisit) x inflation; free Firmware rerolls first. */
  rerollBase: 5,
  rerollStep: 5,
  giftAmount: 10,
  /** Only a fresh press after this guard can buy. */
  openGuardMs: 350,
  readyCountdownMs: 1500,
  maxLocks: 1,
} as const;

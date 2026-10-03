/** Patch cards (plan section 6). Order and `bit` follow CARD_IDS exactly. */
import { CARD_IDS, type CardId } from '../contracts/ids';
import type { CardDef, Rarity } from '../contracts/upgrades';

/** Per-tick behaviour flags (bitmask checks in entities/cardEffects.ts, weapons.ts, specials.ts, combo.ts). */
export const CARD_EFFECT = {
  none: 0,
  splitShot: 1 << 0,
  afterimage: 1 << 1,
  vampireCode: 1 << 2,
  overheat: 1 << 3,
  chainArc: 1 << 4,
  microMissiles: 1 << 5,
  nanoshield: 1 << 6,
  orbitals: 1 << 7,
  glassLens: 1 << 8,
  forkCall: 1 << 9,
  sudo: 1 << 10,
  rootAccess: 1 << 11,
  shardCache: 1 << 12,
  rootOfAllEvil: 1 << 13,
} as const;

/** Card behaviour numbers. */
export const CARD_PARAMS = {
  splitShot: { sideBullets: 2, angleDeg: 12, damageMul: 0.85 },
  afterimage: { trailTime: 1.5, dps: 30, radius: 0.9, sampleEvery: 0.05 },
  vampireCode: { killsPerHp: 12 },
  overheat: { hpFrac: 0.3, fireRateBonus: 0.4 },
  chainArc: { chance: 0.15, targets: 3, damageMul: 0.5, range: 7 },
  microMissiles: { count: 2, interval: 1.2, damage: 20, speed: 22, turnRate: 6, life: 2.5 },
  nanoshield: { interval: 12 },
  orbitals: { blades: 2, dps: 18, radius: 2.4, bladeRadius: 0.6, angularSpeed: 4 },
  glassLens: { damage: 0.35, maxHpMul: 0.8 },
  forkCall: { every: 5 },
  sudo: { casts: 2 },
  rootAccess: { tierBonus: 1 },
  shardCache: { shards: 25 },
  /**
   * MYTHIC: every weapon hit arcs to `arcTargets` enemies for `arcDamageMul`; a purge field of `purgeRadius`
   * around the craft deletes enemy bullets (checked every `purgeEvery` ticks) and burns enemies inside.
   */
  rootOfAllEvil: { arcTargets: 3, arcDamageMul: 0.6, arcRange: 8, purgeRadius: 3.2, purgeEvery: 2, dps: 60 },
} as const;

/** Mythic offers: chance per fresh offer slot, from this sector on (not gated by the Legendary Pool). */
export const MYTHIC = { offerChance: 0.005, fromSector: 2 } as const;

function card(
  id: CardId,
  label: string,
  blurb: string,
  rarity: Rarity,
  stackMax: number,
  unique: boolean,
  modifiers: CardDef['modifiers'],
  effectFlag: number,
): CardDef {
  const bit = CARD_IDS.indexOf(id);
  return {
    id,
    bit,
    label,
    blurb,
    rarity,
    stackMax,
    unique,
    requiresMeta: rarity === 'L' ? 'legendaryPool' : null,
    modifiers,
    effectFlag,
  };
}

export const CARDS: readonly CardDef[] = [
  card(
    'splitShot',
    'Split Shot',
    '+2 side bullets at 12 deg, -15% damage',
    'C',
    2,
    false,
    [{ stat: 'damageMul', op: 'mul', value: 0.85 }],
    CARD_EFFECT.splitShot,
  ),
  card(
    'overdriveBattery',
    'Overdrive Battery',
    '+25% special charge',
    'C',
    3,
    false,
    [{ stat: 'specialChargeMul', op: 'add', value: 0.25 }],
    0,
  ),
  card('bounty', 'Bounty', '+20% Shards', 'C', 2, false, [{ stat: 'shardGain', op: 'add', value: 0.2 }], 0),
  card('pierce', 'Pierce', '+1 pierce', 'U', 3, false, [{ stat: 'pierce', op: 'flat', value: 1 }], 0),
  card(
    'afterimage',
    'Afterimage',
    'Dash leaves a 1.5 s trail (30 DPS)',
    'U',
    1,
    true,
    [],
    CARD_EFFECT.afterimage,
  ),
  card(
    'doubleBuffer',
    'Double Buffer',
    '+1 dash charge',
    'U',
    1,
    true,
    [{ stat: 'dashCharges', op: 'flat', value: 1 }],
    0,
  ),
  card('vampireCode', 'Vampire Code', '+1 HP per 12 kills', 'U', 2, false, [], CARD_EFFECT.vampireCode),
  card('overheat', 'Overheat', '+40% fire rate below 30% HP', 'U', 1, true, [], CARD_EFFECT.overheat),
  card('ricochet', 'Ricochet', '+1 bounce', 'R', 2, false, [{ stat: 'bounces', op: 'flat', value: 1 }], 0),
  card('chainArc', 'Chain Arc', '15%: arc to 3 enemies for 50%', 'R', 1, true, [], CARD_EFFECT.chainArc),
  card(
    'microMissiles',
    'Micro-Missiles',
    '2 homing missiles every 1.2 s (20 dmg)',
    'R',
    2,
    false,
    [],
    CARD_EFFECT.microMissiles,
  ),
  card('nanoshield', 'Nanoshield', 'Blocks 1 hit every 12 s', 'R', 1, true, [], CARD_EFFECT.nanoshield),
  card('orbitals', 'Orbitals', '2 orbiting blades (18 DPS)', 'R', 1, true, [], CARD_EFFECT.orbitals),
  card(
    'glassLens',
    'Glass Lens',
    '+35% damage, -20% max HP',
    'R',
    1,
    true,
    [
      { stat: 'damageMul', op: 'add', value: 0.35 },
      { stat: 'maxHp', op: 'mul', value: 0.8 },
    ],
    CARD_EFFECT.glassLens,
  ),
  card('forkCall', 'FORK()', 'Every 5th shot doubles', 'L', 1, true, [], CARD_EFFECT.forkCall),
  card('sudo', 'SUDO', 'Special fires twice', 'L', 1, true, [], CARD_EFFECT.sudo),
  card('rootAccess', 'ROOT ACCESS', 'Combo tier +1 permanently', 'L', 1, true, [], CARD_EFFECT.rootAccess),
  {
    ...card('shardCache', 'Shard Cache', '+25 Shards', 'C', 255, false, [], CARD_EFFECT.shardCache),
    requiresMeta: null,
  },
  card(
    'rootOfAllEvil',
    'ROOT OF ALL EVIL',
    'x2 fire rate, +50% damage, +4 pierce; every hit chains; a purge field deletes bullets',
    'M',
    1,
    true,
    [
      { stat: 'fireRate', op: 'mul', value: 2 },
      { stat: 'damageMul', op: 'add', value: 0.5 },
      { stat: 'pierce', op: 'flat', value: 4 },
    ],
    CARD_EFFECT.rootOfAllEvil,
  ),
];

export function cardDef(id: CardId): CardDef {
  const c = CARDS[CARD_IDS.indexOf(id)];
  if (c?.id !== id) throw new RangeError(`unknown card ${id}`);
  return c;
}

/** Price by rarity before wave inflation. Shard Cache is always free. */
export const CARD_PRICES = { C: 45, U: 75, R: 120, L: 190, M: 250 } as const satisfies Readonly<
  Record<Rarity, number>
>;

/** Rarities drawn by weight (Mythic has its own per-slot roll, see MYTHIC). */
export const RARITIES: readonly Rarity[] = ['C', 'U', 'R', 'L'];

/** Rarity weights [C, U, R, L] by sector (index 0 = sector 1). */
export const RARITY_WEIGHTS = [
  [60, 28, 10, 2],
  [50, 30, 15, 5],
  [40, 32, 20, 8],
] as const;

export const OFFERS_PER_VISIT = 3;

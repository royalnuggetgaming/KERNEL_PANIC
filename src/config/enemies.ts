/** Theme-neutral enemy mechanics (plan section 1 "ENEMIES"). */
import type { EnemyKind } from '../contracts/ids';

export type EnemyBehavior = 'seek' | 'lunge' | 'split' | 'ringBurst' | 'shielded' | 'latch';

export interface EnemyDef {
  readonly kind: EnemyKind;
  readonly behavior: EnemyBehavior;
  readonly hp: number;
  readonly speed: number;
  readonly radius: number;
  /** Threat budget cost. */
  readonly cost: number;
  readonly unlockWave: number;
  /** Shards dropped on death. */
  readonly drop: number;
  readonly contactDamage: number;
  /** Enemy shot damage (0 = does not shoot). */
  readonly shotDamage: number;
  readonly shotSpeed: number;
  /** Behaviour-specific numbers. */
  readonly params: Readonly<Record<string, number>>;
}

export const ENEMY_DEFS = {
  shard: {
    kind: 'shard',
    behavior: 'seek',
    hp: 20,
    speed: 6.5,
    radius: 0.7,
    cost: 1,
    unlockWave: 1,
    drop: 1,
    contactDamage: 10,
    shotDamage: 0,
    shotSpeed: 0,
    params: { turnRate: 4 },
  },
  dart: {
    kind: 'dart',
    behavior: 'lunge',
    hp: 30,
    speed: 5,
    radius: 0.7,
    cost: 2,
    unlockWave: 2,
    drop: 2,
    contactDamage: 14,
    shotDamage: 0,
    shotSpeed: 0,
    params: { triggerRange: 11, telegraph: 0.6, lungeSpeed: 24, lungeTime: 0.45, recover: 0.9 },
  },
  fork: {
    kind: 'fork',
    behavior: 'split',
    hp: 45,
    speed: 4.5,
    radius: 0.9,
    cost: 4,
    unlockWave: 3,
    drop: 3,
    contactDamage: 12,
    shotDamage: 0,
    shotSpeed: 0,
    params: { splitCount: 2, splitInto: 0, splitSpeed: 6 },
  },
  spiker: {
    kind: 'spiker',
    behavior: 'ringBurst',
    hp: 60,
    speed: 3,
    radius: 1,
    cost: 6,
    unlockWave: 4,
    drop: 4,
    contactDamage: 10,
    shotDamage: 9,
    shotSpeed: 9,
    params: { keepRange: 12, interval: 3.2, pulse: 0.7, bullets: 12 },
  },
  warden: {
    kind: 'warden',
    behavior: 'shielded',
    hp: 90,
    speed: 3.5,
    radius: 1.2,
    cost: 7,
    unlockWave: 6,
    drop: 5,
    contactDamage: 18,
    shotDamage: 10,
    shotSpeed: 12,
    params: { shieldArcDeg: 100, turnRate: 1.6, volleyInterval: 2.6, volleyShots: 3, volleySpreadDeg: 10 },
  },
  leech: {
    kind: 'leech',
    behavior: 'latch',
    hp: 35,
    speed: 7,
    radius: 0.7,
    cost: 4,
    unlockWave: 7,
    drop: 3,
    contactDamage: 6,
    shotDamage: 0,
    shotSpeed: 0,
    params: { latchRange: 1.2, drainPerS: 0 },
  },
} as const satisfies Readonly<Record<EnemyKind, EnemyDef>>;

/** CORRUPTED elites from sector 2: 6% chance + 2% per sector, 2.5x HP, x3 drops, glitch shader. */
export const CORRUPTED = {
  fromSector: 2,
  chanceBase: 0.06,
  chancePerSector: 0.02,
  hpMul: 2.5,
  dropMul: 3,
} as const;

/** Behaviour state machine budgets (plan section 10.8). */
export const ENEMY_AI = {
  SEPARATION_NEIGHBOURS: 6,
  SEPARATION_RADIUS: 1.6,
  SEPARATION_FORCE: 8,
  RETARGET_STAGGER: 30,
} as const;

/** Elite chance for a sector (0 before CORRUPTED.fromSector). */
export function eliteChance(sector: number): number {
  if (sector < CORRUPTED.fromSector) return 0;
  return CORRUPTED.chanceBase + CORRUPTED.chancePerSector * (sector - CORRUPTED.fromSector);
}

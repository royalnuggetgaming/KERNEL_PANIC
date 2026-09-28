/**
 * Bosses as data: each phase is a looping list of shared attack primitives (plan section 1 "BOSSES").
 * Angles in degrees in data; convert with DEG2RAD at use.
 */
import type { BossId, EnemyKind } from '../contracts/ids';

export type AttackStep =
  | {
      readonly prim: 'ring';
      readonly bullets: number;
      readonly speed: number;
      readonly damage: number;
      readonly repeats: number;
      readonly interval: number;
    }
  | {
      readonly prim: 'spiral';
      readonly arms: number;
      readonly speed: number;
      readonly damage: number;
      readonly turnDegPerS: number;
      readonly rate: number;
      readonly duration: number;
    }
  | {
      readonly prim: 'aimed';
      readonly shots: number;
      readonly spreadDeg: number;
      readonly speed: number;
      readonly damage: number;
      readonly volleys: number;
      readonly interval: number;
    }
  | {
      readonly prim: 'sweep';
      readonly beams: number;
      readonly length: number;
      readonly width: number;
      readonly damagePerS: number;
      readonly turnDegPerS: number;
      readonly warmup: number;
      readonly duration: number;
    }
  | {
      readonly prim: 'firewall';
      readonly segments: number;
      readonly radius: number;
      readonly arcDeg: number;
      readonly width: number;
      readonly damagePerS: number;
      readonly turnDegPerS: number;
      readonly warmup: number;
      readonly duration: number;
    }
  | {
      readonly prim: 'charge';
      readonly speed: number;
      readonly telegraph: number;
      readonly duration: number;
      readonly damage: number;
    }
  | { readonly prim: 'summon'; readonly kind: EnemyKind; readonly count: number; readonly elite: boolean }
  | { readonly prim: 'wait'; readonly duration: number };

export type AttackPrim = AttackStep['prim'];

export interface BossPhaseDef {
  /** Phase starts when hp fraction <= this (phase 0 uses 1). */
  readonly hpFrac: number;
  readonly steps: readonly AttackStep[];
}

export interface BossDef {
  readonly id: BossId;
  readonly wave: number;
  readonly hp: number;
  /** Parts alive at spawn (Race Condition = 2 twins). */
  readonly parts: number;
  readonly radius: number;
  readonly speed: number;
  readonly contactDamage: number;
  readonly phases: readonly BossPhaseDef[];
}

export const BOSS_COMMON = {
  TWO_PLAYER_HP_MUL: 1.6,
  ENRAGE_AT: 150,
  ENRAGE_RATE_MUL: 1.5,
  INTRO_TIME: 1.2,
  PHASE_THRESHOLDS: [0.66, 0.33],
} as const;

export const BOSS_DEFS = {
  forkBomb: {
    id: 'forkBomb',
    wave: 5,
    hp: 1600,
    parts: 1,
    radius: 2.6,
    speed: 3,
    contactDamage: 8,
    phases: [
      {
        hpFrac: 1,
        steps: [
          { prim: 'ring', bullets: 10, speed: 9, damage: 5, repeats: 2, interval: 0.6 },
          { prim: 'wait', duration: 1.4 },
          { prim: 'aimed', shots: 3, spreadDeg: 12, speed: 12, damage: 5, volleys: 2, interval: 0.5 },
          { prim: 'wait', duration: 1.5 },
        ],
      },
      {
        hpFrac: 0.66,
        steps: [
          { prim: 'charge', speed: 18, telegraph: 0.8, duration: 0.9, damage: 9 },
          { prim: 'ring', bullets: 10, speed: 9, damage: 5, repeats: 2, interval: 0.5 },
          { prim: 'wait', duration: 1.2 },
        ],
      },
      {
        hpFrac: 0.33,
        steps: [
          { prim: 'spiral', arms: 3, speed: 9, damage: 5, turnDegPerS: 90, rate: 6, duration: 3 },
          { prim: 'summon', kind: 'shard', count: 4, elite: false },
          { prim: 'wait', duration: 1.5 },
        ],
      },
    ],
  },
  raceCondition: {
    id: 'raceCondition',
    wave: 10,
    hp: 2100,
    parts: 2,
    radius: 2.2,
    speed: 4,
    contactDamage: 10,
    phases: [
      {
        hpFrac: 1,
        steps: [
          { prim: 'aimed', shots: 4, spreadDeg: 30, speed: 13, damage: 6, volleys: 2, interval: 0.6 },
          { prim: 'wait', duration: 0.8 },
          { prim: 'spiral', arms: 2, speed: 10, damage: 5, turnDegPerS: 120, rate: 10, duration: 2.5 },
          { prim: 'wait', duration: 1 },
        ],
      },
      {
        hpFrac: 0.66,
        steps: [
          {
            prim: 'sweep',
            beams: 1,
            length: 26,
            width: 1,
            damagePerS: 25,
            turnDegPerS: 50,
            warmup: 0.9,
            duration: 3.5,
          },
          { prim: 'ring', bullets: 14, speed: 9, damage: 5, repeats: 2, interval: 0.7 },
          { prim: 'wait', duration: 1 },
        ],
      },
      {
        hpFrac: 0.33,
        steps: [
          { prim: 'charge', speed: 22, telegraph: 0.7, duration: 0.8, damage: 12 },
          { prim: 'spiral', arms: 3, speed: 11, damage: 5, turnDegPerS: -140, rate: 10, duration: 3 },
          { prim: 'wait', duration: 0.8 },
        ],
      },
    ],
  },
  kernel: {
    id: 'kernel',
    wave: 15,
    hp: 5600,
    parts: 1,
    radius: 3.2,
    speed: 2,
    contactDamage: 12,
    phases: [
      {
        hpFrac: 1,
        steps: [
          {
            prim: 'firewall',
            segments: 4,
            radius: 10,
            arcDeg: 40,
            width: 1.2,
            damagePerS: 28,
            turnDegPerS: 35,
            warmup: 1,
            duration: 6,
          },
          { prim: 'aimed', shots: 3, spreadDeg: 15, speed: 13, damage: 6, volleys: 4, interval: 0.5 },
          { prim: 'wait', duration: 1 },
        ],
      },
      {
        hpFrac: 0.66,
        steps: [
          { prim: 'spiral', arms: 4, speed: 10, damage: 6, turnDegPerS: 80, rate: 12, duration: 4 },
          { prim: 'ring', bullets: 18, speed: 9, damage: 6, repeats: 3, interval: 0.6 },
          { prim: 'wait', duration: 1 },
        ],
      },
      {
        hpFrac: 0.33,
        steps: [
          { prim: 'summon', kind: 'dart', count: 4, elite: false },
          { prim: 'summon', kind: 'spiker', count: 2, elite: false },
          { prim: 'spiral', arms: 5, speed: 11, damage: 6, turnDegPerS: -110, rate: 13, duration: 3.5 },
          {
            prim: 'sweep',
            beams: 2,
            length: 30,
            width: 1.2,
            damagePerS: 32,
            turnDegPerS: 60,
            warmup: 0.8,
            duration: 3,
          },
          { prim: 'wait', duration: 0.8 },
        ],
      },
    ],
  },
} as const satisfies Readonly<Record<BossId, BossDef>>;

/** Fork Bomb split thresholds: 1 -> 2 parts at 66% and 2 -> 4 at 33% (each child gets the parent's hp share). */
export const FORK_BOMB_SPLITS = [0.66, 0.33] as const;

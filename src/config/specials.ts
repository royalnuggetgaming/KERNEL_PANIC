/** Special abilities (plan section 2). Special Tuning tiers II/III add +25% radius, duration and damage each. */
import type { SpecialKind } from '../contracts/ids';

export const SPECIAL_TIER_BONUS = 0.25;

export const SPECIALS = {
  railburst: { duration: 0.25, length: 40, width: 1.2, damage: 400 },
  firewall: { duration: 3.5, radius: 4.5 },
  blinkSwarm: {
    distance: 8,
    mines: 6,
    mineDamage: 45,
    mineRadius: 0.5,
    mineTriggerRadius: 2.2,
    mineLife: 8,
    mineSeekSpeed: 14,
    scatter: 2.5,
  },
  patchDrone: {
    duration: 6,
    healPerS: 8,
    radius: 6,
    turretRate: 4,
    turretDamage: 8,
    turretRange: 14,
    orbit: 2.2,
  },
} as const;

/** Multiplier applied to radius/duration/damage for a Special Tuning tier (0, 1, 2). */
export function specialTierMul(tier: number): number {
  return 1 + SPECIAL_TIER_BONUS * tier;
}

export const SPECIAL_KIND_LIST: readonly SpecialKind[] = [
  'railburst',
  'firewall',
  'blinkSwarm',
  'patchDrone',
];

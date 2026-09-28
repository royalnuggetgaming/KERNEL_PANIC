/** Special abilities (plan section 2). Special Tuning tiers II/III add +25% radius, duration and damage each. */
import type { SpecialKind } from '../contracts/ids';
import { ARENA } from './tuning';

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

/** One-line "what it does" text per special (Character Select, How to Play). */
export const SPECIAL_BLURBS: Readonly<Record<SpecialKind, string>> = {
  railburst: 'Piercing rail through everything in your aim line.',
  firewall: 'Dome that follows you and deletes enemy bullets inside it.',
  blinkSwarm: 'Teleport ahead; leave seeker mines where you were.',
  patchDrone: 'Orbiting drone heals nearby allies and shoots enemies.',
};

/**
 * Railburst rail length from (x, z) along the unit direction (dx, dz): SPECIALS.railburst.length, clipped to the
 * arena wall so the hit segment and the drawn beam both stop at the edge (the sim and BeamView share this).
 */
export function railLength(x: number, z: number, dx: number, dz: number): number {
  const max = SPECIALS.railburst.length;
  const r = ARENA.RADIUS;
  // Ray/circle exit distance: t^2 + 2 t (p.d) + |p|^2 - r^2 = 0 (|d| = 1).
  const b = x * dx + z * dz;
  const c = x * x + z * z - r * r;
  const disc = b * b - c;
  if (disc <= 0) return 0;
  const t = -b + Math.sqrt(disc);
  return t <= 0 ? 0 : t < max ? t : max;
}

/** Theme-neutral vehicle mechanics (plan section 2). Display names come from the theme. */
import type { SpecialKind, VehicleId } from '../contracts/ids';
import type { DerivedStats } from '../contracts/upgrades';
import { COOP, DASH, PICKUPS } from './tuning';

export type WeaponKind = 'twin' | 'spread' | 'needle' | 'arc';

export interface WeaponDef {
  readonly kind: WeaponKind;
  /** Shots (volleys) per second. */
  readonly fireRate: number;
  readonly damage: number;
  /** Projectiles per volley. */
  readonly projectiles: number;
  readonly spreadDeg: number;
  readonly projectileSpeed: number;
  readonly radius: number;
  /** Projectile lifetime in seconds. */
  readonly life: number;
  readonly pierce: number;
  /** Arc pistol: extra enemies the shot chains to. */
  readonly chain: number;
  readonly chainRange: number;
  /** Twin blaster lateral muzzle offset. */
  readonly muzzleOffset: number;
}

export interface VehicleDef {
  readonly id: VehicleId;
  readonly maxHp: number;
  readonly moveSpeed: number;
  /** Contact damage reduction fraction. */
  readonly armor: number;
  readonly dashCharges: number;
  /** Ram dash damage (0 = none). */
  readonly ramDamage: number;
  readonly radius: number;
  readonly weapon: WeaponDef;
  readonly special: SpecialKind;
  /** Core price to unlock; 0 = starter. */
  readonly unlockCost: number;
}

export const VEHICLES = {
  lancer: {
    id: 'lancer',
    maxHp: 100,
    moveSpeed: 12,
    armor: 0,
    dashCharges: 1,
    ramDamage: 0,
    radius: 0.9,
    weapon: {
      kind: 'twin',
      fireRate: 9,
      damage: 10,
      projectiles: 1,
      spreadDeg: 2,
      projectileSpeed: 48,
      radius: 0.25,
      life: 0.9,
      pierce: 0,
      chain: 0,
      chainRange: 0,
      muzzleOffset: 0.35,
    },
    special: 'railburst',
    unlockCost: 0,
  },
  bulwark: {
    id: 'bulwark',
    maxHp: 150,
    moveSpeed: 10,
    armor: 0.2,
    dashCharges: 1,
    ramDamage: DASH.RAM_DAMAGE,
    radius: 1.1,
    weapon: {
      kind: 'spread',
      fireRate: 3.5,
      damage: 9,
      projectiles: 3,
      spreadDeg: 14,
      projectileSpeed: 40,
      radius: 0.3,
      life: 0.7,
      pierce: 0,
      chain: 0,
      chainRange: 0,
      muzzleOffset: 0,
    },
    special: 'firewall',
    unlockCost: 0,
  },
  specter: {
    id: 'specter',
    maxHp: 75,
    moveSpeed: 14,
    armor: 0,
    dashCharges: 2,
    ramDamage: 0,
    radius: 0.8,
    weapon: {
      kind: 'needle',
      fireRate: 14,
      damage: 5,
      projectiles: 1,
      spreadDeg: 1,
      projectileSpeed: 60,
      radius: 0.18,
      life: 0.8,
      pierce: 1,
      chain: 0,
      chainRange: 0,
      muzzleOffset: 0,
    },
    special: 'blinkSwarm',
    unlockCost: 60,
  },
  tinker: {
    id: 'tinker',
    maxHp: 110,
    moveSpeed: 11,
    armor: 0,
    dashCharges: 1,
    ramDamage: 0,
    radius: 0.95,
    weapon: {
      kind: 'arc',
      fireRate: 6,
      damage: 12,
      projectiles: 1,
      spreadDeg: 2,
      projectileSpeed: 44,
      radius: 0.3,
      life: 0.75,
      pierce: 0,
      chain: 1,
      chainRange: 7,
      muzzleOffset: 0,
    },
    special: 'patchDrone',
    unlockCost: 90,
  },
} as const satisfies Readonly<Record<VehicleId, VehicleDef>>;

export const STARTER_VEHICLES: readonly VehicleId[] = ['lancer', 'bulwark'];

/** Base DerivedStats of a vehicle before any modifiers (upgrades/stats.ts stacks on top of this). */
export function vehicleBaseStats(id: VehicleId): DerivedStats {
  const v: VehicleDef = VEHICLES[id];
  return {
    maxHp: v.maxHp,
    moveSpeed: v.moveSpeed,
    fireRate: v.weapon.fireRate,
    damageMul: 1,
    projectiles: v.weapon.projectiles,
    spreadDeg: v.weapon.spreadDeg,
    pierce: v.weapon.pierce,
    bounces: 0,
    projectileSpeed: v.weapon.projectileSpeed,
    critChance: 0,
    magnetRadius: PICKUPS.MAGNET_BASE,
    dashCooldown: DASH.BASE_COOLDOWN,
    dashCharges: v.dashCharges,
    specialChargeMul: 1,
    specialTier: 0,
    shardGain: 1,
    linkDps: COOP.LINK_DPS,
    linkRange: COOP.LINK_MAX,
    reviveTime: COOP.REVIVE_TIME,
    reviveHpFrac: COOP.REVIVE_HP_FRAC,
    armor: v.armor,
  };
}

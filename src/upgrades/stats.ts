/**
 * Stat stacking (plan section 6 "STACKING"): stat = clamp((base + sum(flat)) x (1 + sum(add)) x product(mul)).
 * Vehicle base, Firmware snapshot, stat rows, cards and team items feed the same three pools in catalog order,
 * so the result depends only on levels and stacks, never on purchase order. Hard caps are applied last and
 * fire-rate overflow above the cap becomes a damage multiplier.
 */
import { NUMERIC_STATS, type DerivedStats, type NumericStat, type StatModifier } from '../contracts/upgrades';
import {
  STAT_ROW_IDS,
  TEAM_ITEM_IDS,
  type MetaLevels,
  type StatRowId,
  type TeamItemId,
  type VehicleId,
} from '../contracts/ids';
import { CARDS } from '../config/cards';
import { META_UPGRADES, metaLevel } from '../config/metaCatalog';
import { STAT_ROWS, TEAM_ITEMS } from '../config/runCatalog';
import { STAT_CAPS } from '../config/tuning';
import { vehicleBaseStats } from '../config/vehicles';

/** Hard caps; tests and balancing tools may pass a partial override. */
export type StatCaps = { readonly [K in keyof typeof STAT_CAPS]: number };

const STAT_INDEX: Readonly<Record<NumericStat, number>> = (() => {
  const out = {} as Record<NumericStat, number>;
  for (let i = 0; i < NUMERIC_STATS.length; i++) out[NUMERIC_STATS[i]!] = i;
  return out;
})();

/** Stats that are counts and are floored to integers after stacking. */
const INTEGER_STATS: readonly NumericStat[] = [
  'maxHp',
  'projectiles',
  'pierce',
  'bounces',
  'dashCharges',
  'specialTier',
];

const N = NUMERIC_STATS.length;
const flat = new Float64Array(N);
const add = new Float64Array(N);
const mul = new Float64Array(N);

function resetPools(): void {
  flat.fill(0);
  add.fill(0);
  mul.fill(1);
}

function applyModifiers(mods: readonly StatModifier[], times: number): void {
  if (times <= 0) return;
  for (let i = 0; i < mods.length; i++) {
    const m = mods[i]!;
    const idx = STAT_INDEX[m.stat];
    if (m.op === 'flat') flat[idx]! += m.value * times;
    else if (m.op === 'add') add[idx]! += m.value * times;
    else mul[idx]! *= Math.pow(m.value, times);
  }
}

function safeCount(n: number | undefined): number {
  return n !== undefined && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function resolveCaps(caps: Partial<StatCaps> | undefined): StatCaps {
  return caps === undefined ? STAT_CAPS : { ...STAT_CAPS, ...caps };
}

/** Pure, order-independent stacking + hard caps; fire-rate overflow above the cap becomes damage. */
export function computeStats(
  vehicle: VehicleId,
  meta: MetaLevels,
  rows: Readonly<Record<StatRowId, number>>,
  cards: Uint8Array,
  team: Readonly<Record<TeamItemId, number>>,
  capsOverride?: Partial<StatCaps>,
): DerivedStats {
  const caps = resolveCaps(capsOverride);
  const base = vehicleBaseStats(vehicle);
  resetPools();
  for (const m of META_UPGRADES) applyModifiers(m.modifiers, safeCount(metaLevel(meta, m.id)));
  for (const r of STAT_ROWS) applyModifiers(r.perLevel, safeCount(rows[r.id]));
  for (const c of CARDS) applyModifiers(c.modifiers, safeCount(cards[c.bit]));
  for (const t of TEAM_ITEMS) applyModifiers(t.modifiers, safeCount(team[t.id]));

  const out = { ...base };
  for (let i = 0; i < N; i++) {
    const stat = NUMERIC_STATS[i]!;
    out[stat] = (base[stat] + flat[i]!) * (1 + add[i]!) * mul[i]!;
  }
  for (const s of INTEGER_STATS) out[s] = Math.floor(out[s] + 1e-9);

  // Fire-rate overflow -> damage, then the damage cap.
  if (out.fireRate > caps.fireRateMax) {
    out.damageMul *= out.fireRate / caps.fireRateMax;
    out.fireRate = caps.fireRateMax;
  }
  out.fireRate = Math.max(0.1, out.fireRate);
  out.damageMul = clamp(out.damageMul, 0, caps.damageMulMax);
  out.moveSpeed = clamp(out.moveSpeed, 0, base.moveSpeed * caps.moveSpeedMulMax);
  out.projectiles = clamp(out.projectiles, 1, caps.projectilesMax);
  out.pierce = clamp(out.pierce, 0, caps.pierceMax);
  out.bounces = clamp(out.bounces, 0, caps.bouncesMax);
  out.dashCooldown = Math.max(caps.dashCooldownMin, out.dashCooldown);
  out.dashCharges = clamp(out.dashCharges, 1, caps.dashChargesMax);
  out.maxHp = clamp(out.maxHp, caps.maxHpMin, caps.maxHpMax);
  out.magnetRadius = clamp(out.magnetRadius, 0, caps.magnetRadiusMax);
  out.critChance = clamp(out.critChance, 0, caps.critChanceMax);
  out.specialTier = clamp(out.specialTier, 0, caps.specialTierMax);
  out.armor = clamp(out.armor, 0, caps.armorMax);
  out.spreadDeg = Math.max(0, out.spreadDeg);
  out.projectileSpeed = Math.max(1, out.projectileSpeed);
  out.specialChargeMul = Math.max(0, out.specialChargeMul);
  out.shardGain = Math.max(0, out.shardGain);
  out.linkDps = Math.max(0, out.linkDps);
  out.linkRange = Math.max(0, out.linkRange);
  out.reviveTime = Math.max(0.1, out.reviveTime);
  out.reviveHpFrac = clamp(out.reviveHpFrac, 0.01, 1);
  return out;
}

const EPS = 1e-9;

/** Stats sitting at their hard cap (the shop shows CAPPED rows for these). */
export function capsReached(
  stats: DerivedStats,
  vehicle: VehicleId,
  capsOverride?: Partial<StatCaps>,
): ReadonlySet<NumericStat> {
  const caps = resolveCaps(capsOverride);
  const base = vehicleBaseStats(vehicle);
  const out = new Set<NumericStat>();
  if (stats.moveSpeed >= base.moveSpeed * caps.moveSpeedMulMax - EPS) out.add('moveSpeed');
  if (stats.fireRate >= caps.fireRateMax - EPS) out.add('fireRate');
  if (stats.damageMul >= caps.damageMulMax - EPS) out.add('damageMul');
  if (stats.projectiles >= caps.projectilesMax) out.add('projectiles');
  if (stats.pierce >= caps.pierceMax) out.add('pierce');
  if (stats.bounces >= caps.bouncesMax) out.add('bounces');
  if (stats.dashCooldown <= caps.dashCooldownMin + EPS) out.add('dashCooldown');
  if (stats.dashCharges >= caps.dashChargesMax) out.add('dashCharges');
  if (stats.maxHp >= caps.maxHpMax) out.add('maxHp');
  if (stats.magnetRadius >= caps.magnetRadiusMax - EPS) out.add('magnetRadius');
  if (stats.critChance >= caps.critChanceMax - EPS) out.add('critChance');
  if (stats.specialTier >= caps.specialTierMax) out.add('specialTier');
  if (stats.armor >= caps.armorMax - EPS) out.add('armor');
  return out;
}

/** True when every stat is identical (used by the 'capped' purchase rule). */
export function statsEqual(a: DerivedStats, b: DerivedStats): boolean {
  for (let i = 0; i < N; i++) {
    const s = NUMERIC_STATS[i]!;
    if (Math.abs(a[s] - b[s]) > EPS) return false;
  }
  return true;
}

export function emptyRowLevels(): Record<StatRowId, number> {
  const out = {} as Record<StatRowId, number>;
  for (const id of STAT_ROW_IDS) out[id] = 0;
  return out;
}

export function emptyTeamLevels(): Record<TeamItemId, number> {
  const out = {} as Record<TeamItemId, number>;
  for (const id of TEAM_ITEM_IDS) out[id] = 0;
  return out;
}

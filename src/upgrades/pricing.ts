/**
 * Pure integer price functions (plan section 6 "PRICING"). Every result is a non-negative safe integer:
 * price = max(5, round5(base x growth^level x (1 + 0.06 x (w - 1)))).
 */
import type { CardId, MetaUpgradeId, StatRowId, TeamItemId } from '../contracts/ids';
import { CARD_PRICES, cardDef } from '../config/cards';
import { metaDef } from '../config/metaCatalog';
import { KERNEL_PRICE, REPAIR, UTILITY_PRICES, statRowDef, teamItemDef } from '../config/runCatalog';
import { ECONOMY } from '../config/tuning';

function assertLevel(level: number, what: string): void {
  if (!Number.isSafeInteger(level) || level < 0) throw new RangeError(`${what}: invalid level ${level}`);
}

/** Wave index clamped to a safe integer >= 1 (NaN and fractions are rejected). */
function waveIndex(wave: number): number {
  if (!Number.isFinite(wave)) throw new RangeError(`invalid wave ${wave}`);
  return Math.max(1, Math.floor(wave));
}

/** Rounds to the nearest multiple of 5 (halves round up). Non-finite input throws. */
export function round5(n: number): number {
  if (!Number.isFinite(n)) throw new RangeError(`round5: non-finite ${n}`);
  // The epsilon absorbs float noise such as 37.49999999 from growth powers.
  return Math.round(n / 5 + 1e-9) * 5;
}

/** 1 + 0.06 (w - 1); waves below 1 count as wave 1. */
export function waveInflation(wave: number): number {
  return 1 + ECONOMY.INFLATION_PER_WAVE * (waveIndex(wave) - 1);
}

/** max(5, round5(raw)) as a safe integer. */
function finalPrice(raw: number): number {
  const p = Math.max(ECONOMY.MIN_PRICE, round5(raw));
  if (!Number.isSafeInteger(p)) throw new RangeError(`price overflow ${raw}`);
  return p;
}

/** Price of a stat row going from `level` to `level + 1`. Throws when the row is already maxed. */
export function statRowPrice(id: StatRowId, level: number, wave: number): number {
  const def = statRowDef(id);
  assertLevel(level, id);
  if (level >= def.maxLevel) throw new RangeError(`${id} is maxed at ${def.maxLevel}`);
  return finalPrice(def.base * Math.pow(def.growth, level) * waveInflation(wave));
}

/** Card price by rarity x wave inflation. Shard Cache is always 0. */
export function cardPrice(id: CardId, wave: number): number {
  if (id === 'shardCache') return 0;
  return finalPrice(CARD_PRICES[cardDef(id).rarity] * waveInflation(wave));
}

/** (15 + 4w) x 1.5^boughtThisVisit, rounded to 5. */
export function repairPrice(wave: number, boughtThisVisit: number): number {
  assertLevel(boughtThisVisit, 'repair');
  const w = waveIndex(wave);
  return finalPrice((REPAIR.base + REPAIR.perWave * w) * Math.pow(REPAIR.visitMul, boughtThisVisit));
}

/** Spare Kernel: 150 x (1 + 0.5 x boughtThisRun). */
export function kernelPrice(boughtThisRun: number): number {
  assertLevel(boughtThisRun, 'spareKernel');
  return finalPrice(KERNEL_PRICE.base * (1 + KERNEL_PRICE.perBought * boughtThisRun));
}

/** Explicit (not wave-inflated) team prices; null when maxed. Spare Kernel uses kernelPrice. */
export function teamPrice(id: TeamItemId, level: number, kernelsBoughtThisRun: number): number | null {
  const def = teamItemDef(id);
  assertLevel(level, id);
  if (def.prices === 'kernel') return kernelPrice(kernelsBoughtThisRun);
  const p = def.prices[level];
  return p ?? null;
}

/** (5 + 5 x paid rerolls this visit) x wave inflation. */
export function rerollPrice(rerollsThisVisit: number, wave: number): number {
  assertLevel(rerollsThisVisit, 'reroll');
  return finalPrice(
    (UTILITY_PRICES.rerollBase + UTILITY_PRICES.rerollStep * rerollsThisVisit) * waveInflation(wave),
  );
}

/** Explicit Firmware price for level -> level + 1, null when maxed. */
export function metaPrice(id: MetaUpgradeId, level: number): number | null {
  assertLevel(level, id);
  return metaDef(id).prices[level] ?? null;
}

/** Sum of the Firmware prices for levels [0, level). */
export function metaCostUpTo(id: MetaUpgradeId, level: number): number {
  const prices = metaDef(id).prices;
  let sum = 0;
  const n = Math.min(Math.max(0, Math.floor(level)), prices.length);
  for (let i = 0; i < n; i++) sum += prices[i]!;
  return sum;
}

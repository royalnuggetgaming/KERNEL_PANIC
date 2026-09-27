/**
 * Pure display formatters for the DOM UI (no DOM, no locale dependence: output is identical on every machine).
 */
import type { ShopItemStatus } from '../contracts/run';

const MINUS = '-';

/** Integer with comma thousands grouping ("1,234,567"). Non-finite input formats as "0"; fractions are floored. */
export function formatShards(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const neg = n < 0;
  const digits = String(Math.floor(Math.abs(n)));
  let out = '';
  let count = 0;
  for (let i = digits.length - 1; i >= 0; i--) {
    out = digits.charAt(i) + out;
    count++;
    if (count % 3 === 0 && i > 0) out = ',' + out;
  }
  return neg ? MINUS + out : out;
}

/** m:ss (minutes are not wrapped: 75:00). Negative and non-finite values clamp to 0:00; seconds are floored. */
export function formatTime(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/** Shop price: null (maxed/unpriced) is an em dash, 0 is FREE, otherwise a grouped integer. */
export function formatPrice(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—';
  if (n <= 0) return 'FREE';
  return formatShards(n);
}

/** Fraction 0..1 as a rounded percentage ("80%"). */
export function formatPercent(f: number): string {
  if (!Number.isFinite(f)) return '0%';
  return `${Math.round(f * 100)}%`;
}

/** Whole seconds left, rounded up, for countdowns ("3", "2", "1"); 0 at or below zero. */
export function formatCountdown(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0';
  return String(Math.ceil(seconds - 1e-9));
}

/** Tenths for short countdowns ("1.2"). */
export function formatTenths(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0.0';
  return (Math.ceil(seconds * 10 - 1e-9) / 10).toFixed(1);
}

/** Level readout: "3/5"; an unbounded or zero max shows only the level. */
export function formatLevel(level: number, maxLevel: number): string {
  const lv = Math.max(0, Math.floor(level));
  if (!Number.isFinite(maxLevel) || maxLevel <= 0 || maxLevel > 999) return String(lv);
  return `${lv}/${Math.floor(maxLevel)}`;
}

/** Signed integer ("+40", "-5", "0"). */
export function formatSigned(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '0';
  return n > 0 ? '+' + formatShards(n) : MINUS + formatShards(-n);
}

/** HP readout "82/100" (both rounded up so a sliver of HP never reads 0). */
export function formatHp(hp: number, maxHp: number): string {
  const cur = Number.isFinite(hp) && hp > 0 ? Math.ceil(hp) : 0;
  const max = Number.isFinite(maxHp) && maxHp > 0 ? Math.ceil(maxHp) : 0;
  return `${cur}/${max}`;
}

/** Combo chain readout ("x12"); empty below 2 kills. */
export function formatCombo(n: number): string {
  if (!Number.isFinite(n) || n < 2) return '';
  return `x${Math.floor(n)}`;
}

/** Versus score line "2 : 1". */
export function formatScoreLine(a: number, b: number): string {
  return `${Math.max(0, Math.floor(a))} : ${Math.max(0, Math.floor(b))}`;
}

/** 0xRRGGBB integer to "#rrggbb". */
export function formatHexColor(rgb: number): string {
  const v = Math.max(0, Math.min(0xffffff, Math.floor(rgb)));
  return '#' + v.toString(16).padStart(6, '0');
}

/** 0xRRGGBB integer to "r, g, b" for rgba(var(--x-rgb), a) in CSS. */
export function formatRgbTriplet(rgb: number): string {
  const v = Math.max(0, Math.min(0xffffff, Math.floor(rgb)));
  return `${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}`;
}

/** Short tag shown instead of a price for a non-buyable shop item; '' when the price should be shown. */
export function shopStatusLabel(status: ShopItemStatus): string {
  switch (status) {
    case 'available':
    case 'unaffordable':
      return '';
    case 'maxed':
      return 'MAX';
    case 'capped':
      return 'CAPPED';
    case 'soldOut':
      return 'SOLD OUT';
    case 'locked':
      return 'LOCKED';
    case 'owned':
      return 'OWNED';
    case 'unavailable':
      return 'N/A';
    case 'heldCap':
      return 'HOLD MAX';
  }
}

/** Player tag ("P1"/"P2") from a 0-based index. */
export function playerTag(p: 0 | 1): string {
  return p === 0 ? 'P1' : 'P2';
}

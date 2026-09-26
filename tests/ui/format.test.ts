import { describe, expect, it } from 'vitest';
import {
  formatCombo,
  formatCountdown,
  formatHexColor,
  formatHp,
  formatLevel,
  formatPercent,
  formatPrice,
  formatRgbTriplet,
  formatScoreLine,
  formatShards,
  formatSigned,
  formatTenths,
  formatTime,
  playerTag,
  shopStatusLabel,
} from '../../src/ui/format';

describe('ui/format', () => {
  it('formatShards groups thousands, floors, handles negatives and non-finite', () => {
    expect(formatShards(0)).toBe('0');
    expect(formatShards(7)).toBe('7');
    expect(formatShards(999)).toBe('999');
    expect(formatShards(1000)).toBe('1,000');
    expect(formatShards(12345)).toBe('12,345');
    expect(formatShards(9999999)).toBe('9,999,999');
    expect(formatShards(1234.9)).toBe('1,234');
    expect(formatShards(-1500)).toBe('-1,500');
    expect(formatShards(Number.NaN)).toBe('0');
    expect(formatShards(Number.POSITIVE_INFINITY)).toBe('0');
  });

  it('formatTime is m:ss, floors seconds, clamps negatives', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(5.9)).toBe('0:05');
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(600)).toBe('10:00');
    expect(formatTime(4500)).toBe('75:00');
    expect(formatTime(-3)).toBe('0:00');
    expect(formatTime(Number.NaN)).toBe('0:00');
  });

  it('formatPrice: null -> dash, 0 -> FREE, grouping otherwise', () => {
    expect(formatPrice(null)).toBe('—');
    expect(formatPrice(0)).toBe('FREE');
    expect(formatPrice(45)).toBe('45');
    expect(formatPrice(12000)).toBe('12,000');
    expect(formatPrice(Number.NaN)).toBe('—');
  });

  it('formatPercent rounds', () => {
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(0.8)).toBe('80%');
    expect(formatPercent(0.456)).toBe('46%');
    expect(formatPercent(1)).toBe('100%');
    expect(formatPercent(Number.NaN)).toBe('0%');
  });

  it('countdowns round up', () => {
    expect(formatCountdown(2.01)).toBe('3');
    expect(formatCountdown(3)).toBe('3');
    expect(formatCountdown(0.2)).toBe('1');
    expect(formatCountdown(0)).toBe('0');
    expect(formatCountdown(-1)).toBe('0');
    expect(formatTenths(0.55)).toBe('0.6');
    expect(formatTenths(1.5)).toBe('1.5');
    expect(formatTenths(0)).toBe('0.0');
  });

  it('formatLevel hides unbounded or zero maxima', () => {
    expect(formatLevel(3, 5)).toBe('3/5');
    expect(formatLevel(0, 0)).toBe('0');
    expect(formatLevel(2, Number.POSITIVE_INFINITY)).toBe('2');
    expect(formatLevel(-1, 5)).toBe('0/5');
  });

  it('signed, hp, combo, score line', () => {
    expect(formatSigned(40)).toBe('+40');
    expect(formatSigned(-5)).toBe('-5');
    expect(formatSigned(0)).toBe('0');
    expect(formatSigned(1200)).toBe('+1,200');
    expect(formatHp(81.2, 100)).toBe('82/100');
    expect(formatHp(0.1, 100)).toBe('1/100');
    expect(formatHp(-4, 100)).toBe('0/100');
    expect(formatHp(10, Number.NaN)).toBe('10/0');
    expect(formatCombo(1)).toBe('');
    expect(formatCombo(12)).toBe('x12');
    expect(formatScoreLine(2, 1)).toBe('2 : 1');
    expect(formatScoreLine(-1, 0)).toBe('0 : 0');
  });

  it('colours', () => {
    expect(formatHexColor(0x19e6ff)).toBe('#19e6ff');
    expect(formatHexColor(0x05060d)).toBe('#05060d');
    expect(formatHexColor(-5)).toBe('#000000');
    expect(formatRgbTriplet(0xff3fd0)).toBe('255, 63, 208');
  });

  it('shop status labels cover every status', () => {
    expect(shopStatusLabel('available')).toBe('');
    expect(shopStatusLabel('unaffordable')).toBe('');
    expect(shopStatusLabel('maxed')).toBe('MAX');
    expect(shopStatusLabel('capped')).toBe('CAPPED');
    expect(shopStatusLabel('soldOut')).toBe('SOLD OUT');
    expect(shopStatusLabel('locked')).toBe('LOCKED');
    expect(shopStatusLabel('owned')).toBe('OWNED');
    expect(shopStatusLabel('unavailable')).toBe('N/A');
    expect(shopStatusLabel('heldCap')).toBe('HOLD MAX');
    expect(playerTag(0)).toBe('P1');
    expect(playerTag(1)).toBe('P2');
  });
});

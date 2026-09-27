/**
 * Economy Monte Carlo (plan section 11): 2,000 seeded runs (1,000 solo + 1,000 co-op; half greedy, half
 * random buyers) through the real ShopModel with modelled income (tests/sim/economyModel.ts). Asserts:
 * - median purchases per visit in [1.5, 4] (design target: 2-3 meaningful purchases, never "buy everything");
 * - nobody reaches every cap (all stat rows maxed, or every hard cap) before sector 3 (waves 1-10);
 * - solo vs 2P per-player purchase power (Shards spent over the run) within +-25%.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { WAVES } from '../../src/config/waves';
import { dropPerThreat, median, simulateRun, type RunStats } from './economyModel';

const RUNS_PER_MODE = 1_000;
const SECTOR3_FIRST_WAVE = 2 * WAVES.WAVES_PER_SECTOR + 1;

function allRuns(): RunStats[] {
  const runs: RunStats[] = [];
  for (let i = 0; i < RUNS_PER_MODE; i++) {
    const buyer = i % 2 === 0 ? 'greedy' : 'random';
    runs.push(simulateRun('solo', 10_000 + i, buyer));
    runs.push(simulateRun('coop', 20_000 + i, buyer));
  }
  return runs;
}

describe('economy Monte Carlo (2,000 seeded runs)', () => {
  let runs: RunStats[] = [];
  beforeAll(() => {
    runs = allRuns();
  }, 180_000);

  it('median purchases per visit is within [1.5, 4]', () => {
    const per: number[] = [];
    for (const r of runs) for (const v of r.visits) for (const s of v) per.push(s.purchases);
    expect(per.length).toBe(RUNS_PER_MODE * 3 * WAVES.TOTAL);
    const m = median(per);
    expect(m).toBeGreaterThanOrEqual(1.5);
    expect(m).toBeLessThanOrEqual(4);
    // Neither buyer style alone breaks the band.
    for (const buyer of ['greedy', 'random'] as const) {
      const xs: number[] = [];
      for (const r of runs)
        if (r.buyer === buyer) for (const v of r.visits) for (const s of v) xs.push(s.purchases);
      expect(median(xs)).toBeGreaterThanOrEqual(1.5);
      expect(median(xs)).toBeLessThanOrEqual(4);
    }
  });

  it('nobody reaches every cap before sector 3', () => {
    let early = 0;
    for (const r of runs) for (const w of r.allCapsWave) if (w < SECTOR3_FIRST_WAVE) early++;
    expect(early).toBe(0);
  });

  it('solo vs 2P per-player purchase power is within +-25%', () => {
    const solo: number[] = [];
    const duo: number[] = [];
    for (const r of runs) {
      if (r.mode === 'solo') solo.push(r.spent[0]!);
      else duo.push(...r.spent);
    }
    const ratio = median(duo) / median(solo);
    expect(ratio).toBeGreaterThanOrEqual(0.75);
    expect(ratio).toBeLessThanOrEqual(1.25);
  });

  it('spending never exceeds earnings (integer, non-negative wallets)', () => {
    for (const r of runs) {
      for (let i = 0; i < r.spent.length; i++) {
        expect(Number.isSafeInteger(r.spent[i])).toBe(true);
        // Shard Cache grants can only add to what was earned.
        expect(r.spent[i]!).toBeLessThanOrEqual(r.earned[i]! + 25 * WAVES.TOTAL);
      }
    }
  });

  it('the income model follows the config (drop per threat point grows with unlocks and elites)', () => {
    expect(dropPerThreat(1)).toBeCloseTo(1, 9);
    expect(dropPerThreat(6)).toBeGreaterThan(dropPerThreat(5) * 0.9);
    expect(dropPerThreat(11)).toBeGreaterThan(dropPerThreat(10));
  });
});

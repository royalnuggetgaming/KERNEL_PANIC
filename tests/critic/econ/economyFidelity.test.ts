/**
 * ECON critic reproduction (FAILS on current code): the economy Monte Carlo (tests/sim/economy.test.ts via
 * tests/sim/economyModel.ts) is not faithful to the real sim's income. Real RunSession runs with the test
 * Autopilot (same buyer policy as the model) show:
 * - co-op SYNC KILL Shards are 3-13x what the model assumes (model: 2 x U{0..6} = 0..12 per player per wave;
 *   real: ~36-51 per player per wave in sector 1, 56-160 later), i.e. 25-45% of co-op income;
 * - so the per-player purchase power of 2P vs solo is ~1.3x in sector 1 (target: within +-25%), while the
 *   model reports ~1.0 (its pickup share and sync terms cancel differently).
 * The Monte Carlo's pass therefore does not guard the real economy targets.
 */
import { describe, expect, it } from 'vitest';
import type { PlayerIndex, RunMode } from '../../../src/contracts/ids';
import { NullLogger } from '../../../src/core/logger';
import { COOP } from '../../../src/config/tuning';
import { createRunSession } from '../../../src/sim/RunSession';
import { Autopilot } from '../../sim/autopilot';
import { runConfigFor } from '../../sim/runDriver';

const SEEDS = [100, 101, 102, 103];
const WAVES_MEASURED = 3;
/** economyModel.ts: `inc += COOP.SYNC_SHARDS * rng.int(0, 6)` per player per co-op wave. */
const MODEL_SYNC_MAX = COOP.SYNC_SHARDS * 6;

interface WaveIncome {
  income: number[];
  syncPerPlayer: number;
}

function measure(mode: RunMode, seed: number): WaveIncome[] {
  const s = createRunSession(runConfigFor(mode, seed), { log: NullLogger });
  const ap = new Autopilot();
  const n = mode === 'solo' ? 1 : 2;
  const out: WaveIncome[] = [];
  let before = [0, 0];
  let sync = 0;
  s.beginNextWave();
  for (let t = 0; t < 100_000 && out.length < WAVES_MEASURED; t++) {
    s.tick(ap.at(s.state));
    const ev = s.state.events.wave;
    for (let k = 0; k < ev.count; k++) if (ev.get(k).what === 'sync') sync++;
    s.clearEvents();
    if (s.flags.defeat) break;
    if (!s.flags.waveClearReady) continue;
    const w = s.state;
    const income: number[] = [];
    for (let i = 0; i < n; i++) income.push(w.run.shardsEarned[i as PlayerIndex] - before[i]!);
    before = [w.run.shardsEarned[0], w.run.shardsEarned[1]];
    out.push({ income, syncPerPlayer: sync * COOP.SYNC_SHARDS });
    sync = 0;
    const shop = s.openShop();
    shop.update(400);
    shop.commit();
    s.applyShopResults();
    s.beginNextWave();
  }
  return out;
}

describe('ECON: the Monte Carlo income model matches the real sim', () => {
  const coop = SEEDS.map((seed) => measure('coop', seed));
  const solo = SEEDS.map((seed) => measure('solo', seed));

  it('co-op sync-kill Shards per player per wave stay within the model (<= 12)', () => {
    let sum = 0;
    let n = 0;
    for (const r of coop)
      for (const w of r) {
        sum += w.syncPerPlayer;
        n++;
      }
    expect(n).toBe(SEEDS.length * WAVES_MEASURED);
    // Observed: ~40 per player per wave in waves 1-3.
    expect(sum / n).toBeLessThanOrEqual(MODEL_SYNC_MAX);
  });

  it('2P vs solo per-player income in sector 1 is within +-25%', () => {
    const perPlayer = (runs: WaveIncome[][]): number => {
      let sum = 0;
      let n = 0;
      for (const r of runs)
        for (const w of r)
          for (const x of w.income) {
            sum += x;
            n++;
          }
      return sum / n;
    };
    const ratio = perPlayer(coop) / perPlayer(solo);
    // Observed: ~1.3.
    expect(ratio).toBeGreaterThanOrEqual(0.75);
    expect(ratio).toBeLessThanOrEqual(1.25);
  });
});

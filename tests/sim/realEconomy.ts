/**
 * Real-sim economy runs for tests/sim/economyFidelity.test.ts: RunSession driven by the test Autopilot with the
 * players kept invulnerable (the Monte Carlo models surviving players), buying through the real shop with the
 * Monte Carlo's greedy buyer. Records per-player Shards earned per wave and the sync kills of each wave.
 */
import type { PlayerIndex, RunMode } from '../../src/contracts/ids';
import { createRng } from '../../src/core/rng';
import { WAVES } from '../../src/config/waves';
import { Autopilot } from './autopilot';
import { candidates, pick } from './economyModel';
import { newSession } from './runDriver';

export interface RealWave {
  readonly wave: number;
  /** Per joined player: Shards earned this wave (pickups, sync kills, clear bonus). */
  readonly earned: readonly number[];
  readonly syncKills: number;
}

export function realRun(mode: RunMode, seed: number, waves: number = WAVES.TOTAL): RealWave[] {
  const s = newSession(mode, seed);
  const ap = new Autopilot();
  const buyer = createRng(seed).fork('buyer');
  const n = mode === 'solo' ? 1 : 2;
  const out: RealWave[] = [];
  const before = [0, 0];
  let sync = 0;
  s.beginNextWave();
  for (let t = 0; t < 400_000 && out.length < waves; t++) {
    s.tick(ap.at(s.state));
    const w = s.state;
    for (const pl of w.players) if (pl.life === 'alive') pl.invulnUntil = w.time + 1;
    const ev = w.events.wave;
    for (let k = 0; k < ev.count; k++) if (ev.get(k).what === 'sync') sync++;
    s.clearEvents();
    if (s.flags.defeat) break;
    if (!s.flags.waveClearReady) continue;
    const earned: number[] = [];
    for (let i = 0; i < n; i++) {
      earned.push(w.run.shardsEarned[i as PlayerIndex] - before[i]!);
      before[i] = w.run.shardsEarned[i as PlayerIndex];
    }
    out.push({ wave: w.run.wave, earned, syncKills: sync });
    sync = 0;
    const shop = s.openShop();
    shop.update(400);
    for (let i = 0; i < n; i++) {
      const p: PlayerIndex = i === 0 ? 0 : 1;
      const wantTeam = buyer.chance(0.3);
      for (let guard = 0; guard < 64; guard++) {
        const list = candidates(shop.snapshot().players[p], p, mode === 'coop', wantTeam);
        if (list.length === 0 || !shop.apply(pick(list, 'greedy', buyer).tx).ok) break;
      }
    }
    if (shop.finalVisit) break;
    shop.commit();
    s.applyShopResults();
    s.beginNextWave();
  }
  return out;
}

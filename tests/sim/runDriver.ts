/**
 * Drives a real RunSession like PlayingState + UpgradesShopState would: one tick per call, events cleared
 * every 2 ticks (a 60 Hz frame), shop visits on waveClearReady / roundOver with a deterministic buyer,
 * PUSH DEEPER on the final visit, and a stop on defeat / matchOver.
 */
import { STAT_ROW_IDS, type PlayerIndex, type RunMode } from '../../src/contracts/ids';
import type { Intents } from '../../src/contracts/input';
import type { RunConfig, ShopApi } from '../../src/contracts/run';
import type { WorldState } from '../../src/contracts/world';
import { NullLogger } from '../../src/core/logger';
import { createRunSession, type RunSession } from '../../src/sim/RunSession';
import { stateHash } from '../../src/sim/stateHash';
import { testRunConfig } from '../helpers/fakeRun';

export function runConfigFor(mode: RunMode, seed: number, patch: Partial<RunConfig> = {}): RunConfig {
  return testRunConfig({
    seed,
    mode,
    runId: `run-${mode}-${seed}`,
    players:
      mode === 'solo'
        ? [{ player: 0, vehicle: 'lancer' }]
        : [
            { player: 0, vehicle: 'lancer' },
            { player: 1, vehicle: 'bulwark' },
          ],
    ...patch,
  });
}

export function newSession(mode: RunMode, seed: number, patch: Partial<RunConfig> = {}): RunSession {
  return createRunSession(runConfigFor(mode, seed, patch), { log: NullLogger });
}

/** Deterministic buyer: cheapest-first sweep over the stat rows and card slot 0, then both players Ready. */
export function autoShop(shop: ShopApi, joined: readonly [boolean, boolean]): number {
  shop.update(400);
  let bought = 0;
  for (let i = 0; i < 2; i++) {
    const p: PlayerIndex = i === 0 ? 0 : 1;
    if (!joined[p]) continue;
    for (let round = 0; round < 3; round++) {
      for (const id of STAT_ROW_IDS) if (shop.apply({ kind: 'buyRow', player: p, id }).ok) bought++;
      if (shop.apply({ kind: 'buyCard', player: p, slot: 0 }).ok) bought++;
    }
  }
  if (shop.finalVisit) shop.apply({ kind: 'choose', player: 0, choice: 'pushDeeper' });
  for (let i = 0; i < 2; i++) if (joined[i]) shop.apply({ kind: 'toggleReady', player: i === 0 ? 0 : 1 });
  shop.update(16);
  shop.update(2000);
  return bought;
}

export interface DriveResult {
  ticks: number;
  visits: number;
  purchases: number;
  ended: 'defeat' | 'matchOver' | null;
}

/** Runs up to `ticks` ticks; `intents(w)` supplies each tick's intents. Calls `sample` after every tick. */
export function drive(
  s: RunSession,
  ticks: number,
  intents: (w: WorldState) => Intents,
  sample?: (w: WorldState, tick: number) => void,
): DriveResult {
  const joined: readonly [boolean, boolean] = [true, s.state.players[1].life !== 'absent'];
  const res: DriveResult = { ticks: 0, visits: 0, purchases: 0, ended: null };
  for (let t = 0; t < ticks; t++) {
    s.tick(intents(s.state));
    res.ticks++;
    if ((t & 1) === 1) s.clearEvents();
    sample?.(s.state, t);
    const f = s.flags;
    if (f.defeat || f.matchOver) {
      res.ended = f.defeat ? 'defeat' : 'matchOver';
      return res;
    }
    if (f.waveClearReady || f.roundOver) {
      const shop = s.openShop();
      res.purchases += autoShop(shop, joined);
      shop.commit();
      s.applyShopResults();
      s.beginNextWave();
      res.visits++;
    }
  }
  return res;
}

/** Hash samples every `every` ticks plus the final hash. */
export function hashTrace(
  s: RunSession,
  ticks: number,
  every: number,
  intents: (w: WorldState) => Intents,
): number[] {
  const out: number[] = [];
  drive(s, ticks, intents, (w, t) => {
    if ((t + 1) % every === 0) out.push(stateHash(w));
  });
  out.push(stateHash(s.state));
  return out;
}

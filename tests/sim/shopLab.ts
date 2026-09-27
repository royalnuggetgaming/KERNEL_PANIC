/**
 * Shop-to-sim lab helpers: A/B RunSession pairs where A buys an item through the real RunSession -> ShopModel ->
 * applyShopResults path and B (control) buys nothing; both are then frozen in a "lab" (countdown phase with a
 * huge timer: no spawns, enemies frozen, weapons live) and run identical scripted ticks.
 */
import { expect } from 'vitest';
import type { CardId, MetaLevels, PlayerIndex, RunMode, StatRowId } from '../../src/contracts/ids';
import type { PlayerIntent } from '../../src/contracts/input';
import type { WorldState } from '../../src/contracts/world';
import { NullLogger } from '../../src/core/logger';
import { createRunSession, type RunSession } from '../../src/sim/RunSession';
import { clearBoss } from '../../src/sim/worldRecords';
import { createIntents, resetIntent } from '../helpers/scriptedIntents';
import { runConfigFor } from './runDriver';

export const IDLE = createIntents();

export function session(mode: RunMode, seed: number, meta: MetaLevels = {}): RunSession {
  return createRunSession(runConfigFor(mode, seed, { meta }), { log: NullLogger });
}

/** Runs wave 1's countdown, removes every enemy and the budget, and ticks to waveClearReady. */
export function toFirstShop(s: RunSession): void {
  s.beginNextWave();
  const w = s.state;
  for (let i = 0; i < 2_000 && w.run.phase !== 'combat'; i++) s.tick(IDLE);
  w.enemies.clear();
  w.director.pending.clear();
  w.director.budgetLeft = 0;
  for (const b of w.bosses) clearBoss(b);
  for (let i = 0; i < 2_000 && !s.flags.waveClearReady; i++) s.tick(IDLE);
  expect(s.flags.waveClearReady).toBe(true);
}

export type Buy = (s: RunSession) => void;

/** Opens a visit with rich wallets, runs `buy`, commits, applies the results and starts wave 2. */
export function visit(s: RunSession, buy: Buy | null): void {
  s.state.run.wallets[0] = 1_000_000;
  if (s.state.players[1].life !== 'absent') s.state.run.wallets[1] = 1_000_000;
  const shop = s.openShop();
  shop.update(400);
  buy?.(s);
  shop.commit();
  s.applyShopResults();
  s.beginNextWave();
}

export function buyRowTx(id: StatRowId, times = 1, p: PlayerIndex = 0): Buy {
  return (s) => {
    for (let i = 0; i < times; i++) expect(s.shop!.apply({ kind: 'buyRow', player: p, id }).ok).toBe(true);
  };
}

/** Rerolls (paid) until `id` is offered, then buys it. */
export function buyCardTx(id: CardId, p: PlayerIndex = 0): Buy {
  return (s) => {
    const shop = s.shop!;
    for (let tries = 0; tries < 400; tries++) {
      const slot = shop.snapshot().players[p].cards.find((c) => c.id === id);
      if (slot !== undefined) {
        const r = shop.apply({ kind: 'buyCard', player: p, slot: slot.slot });
        expect(r.ok).toBe(true);
        return;
      }
      expect(shop.apply({ kind: 'reroll', player: p }).ok).toBe(true);
    }
    throw new Error(`card ${id} never offered`);
  };
}

/** Freezes the world into a lab: countdown forever (no spawns, enemies frozen), empty pools, no i-frames. */
export function lab(s: RunSession): WorldState {
  const w = s.state;
  w.run.phase = 'countdown';
  w.run.phaseTimer = 1e9;
  w.director.pending.clear();
  w.director.budgetLeft = 0;
  w.enemies.clear();
  w.enemyShots.clear();
  w.playerShots.clear();
  w.pickups.clear();
  w.lasers.clear();
  for (const p of w.players) {
    if (p.life === 'absent') continue;
    p.invulnUntil = 0;
    p.x = p.prevX = p.index === 0 ? -4 : 4;
    p.z = p.prevZ = 0;
    p.vx = p.vz = 0;
    p.aimX = 0;
    p.aimZ = 1;
    p.yaw = p.prevYaw = 0;
    p.fireAcc = 0;
  }
  return w;
}

/** A/B pair: A buys, B does not; both are put in the lab. */
export function pair(
  buy: Buy,
  mode: RunMode = 'solo',
  meta: MetaLevels = {},
  seed = 5,
): [RunSession, RunSession] {
  const a = session(mode, seed, meta);
  const b = session(mode, seed, meta);
  toFirstShop(a);
  toFirstShop(b);
  visit(a, buy);
  visit(b, null);
  lab(a);
  lab(b);
  return [a, b];
}

export function run(
  s: RunSession,
  ticks: number,
  fill: (i: PlayerIntent, w: WorldState, t: number) => void,
): void {
  const intents = createIntents();
  for (let t = 0; t < ticks; t++) {
    resetIntent(intents[0]);
    resetIntent(intents[1]);
    fill(intents[0], s.state, t);
    s.tick(intents);
    s.clearEvents();
  }
}

export function shotsFired(s: RunSession, ticks: number, patch?: (w: WorldState) => void): number {
  let n = 0;
  const intents = createIntents();
  for (let t = 0; t < ticks; t++) {
    patch?.(s.state);
    resetIntent(intents[0]);
    intents[0].fireHeld = true;
    s.tick(intents);
    n += s.state.events.shot.count;
    s.clearEvents();
  }
  return n;
}

export function firstVolley(s: RunSession): {
  count: number;
  damage: number;
  pierce: number;
  bounces: number;
} {
  const w = s.state;
  w.playerShots.clear();
  const intents = createIntents();
  intents[0].fireHeld = true;
  for (let t = 0; t < 60 && w.playerShots.count === 0; t++) s.tick(intents);
  const shot = w.playerShots.active[0]!;
  return { count: w.playerShots.count, damage: shot.damage, pierce: shot.pierce, bounces: shot.bounces };
}

/**
 * Kill chains: 2 s window, tiers at 10/25/50/100 (score x1.5..x4, Shards +10..40%), halving on hit,
 * sync kills (co-op only: both players kill within 0.4 s -> +2 Shards and +3 Overdrive each, at most one per
 * SYNC_COOLDOWN), Vampire Code kill counting and ROOT ACCESS (+1 tier).
 */
import type { PlayerIndex } from '../contracts/ids';
import type { Intents } from '../contracts/input';
import type { PlayerEntity } from '../contracts/sim';
import { SOURCE_LINK, type DamageSource } from '../contracts/simEvents';
import type { SimSystem, WorldState } from '../contracts/world';
import { CARD_PARAMS } from '../config/cards';
import { COMBO, COOP, OVERDRIVE } from '../config/tuning';
import { CARD_BIT, cardStacks, hasCard } from './cardBits';
import { addOverdrive } from './overdrive';
import { emitWave } from './simEventsOut';
import { grantShards } from './wallet';

const MAX_TIER = COMBO.TIERS.length;
/**
 * Seconds after a sync kill before the next one can pay (ECON-3). Without it, two players trading kills in a
 * busy wave "sync" on nearly every other kill (~20 syncs = ~45 Shards per player per wave in sector 1, more than
 * their pickups), and 2P per-player income ran 1.3-1.5x solo against the +-25% target. With 2 s the real sim
 * measures ~20-25 sync Shards per player per wave, and 2P/solo per-player income ~1.0 over waves 1-3 of normal
 * play and 0.8-0.95 per sector with invulnerable players (tests/sim/economyFidelity.test.ts). A tuning value: it
 * belongs next to COOP.SYNC_WINDOW in config/tuning.ts, which is frozen in this wave.
 */
export const SYNC_COOLDOWN = 2;

/** Raw tier (0..4) reached by a chain length, before ROOT ACCESS. */
export function comboTierFor(chain: number): number {
  let t = 0;
  for (let i = 0; i < COMBO.TIERS.length; i++) if (chain >= COMBO.TIERS[i]!) t = i + 1;
  return t;
}

/** Effective tier including ROOT ACCESS (+1 permanently), clamped to the top tier. */
export function effectiveComboTier(p: Readonly<PlayerEntity>): number {
  const t = p.comboTier + (hasCard(p, CARD_BIT.rootAccess) ? CARD_PARAMS.rootAccess.tierBonus : 0);
  return t > MAX_TIER ? MAX_TIER : t;
}

/** Current tier multipliers (ROOT ACCESS adds a tier). */
export function comboScoreMul(p: Readonly<PlayerEntity>): number {
  return COMBO.SCORE_MUL[effectiveComboTier(p)] ?? 1;
}

export function comboShardBonus(p: Readonly<PlayerEntity>): number {
  return COMBO.SHARD_BONUS[effectiveComboTier(p)] ?? 0;
}

/**
 * Sim time of the last sync kill per world (each kill takes part in at most one sync). The entry remembers
 * the run it belongs to (world config identity) so a world recycled by resetWorld starts clean.
 */
interface SyncMemory {
  config: WorldState['config'];
  /** [last sync time]. */
  readonly last: Float64Array;
}
const lastSync = new WeakMap<WorldState, SyncMemory>();

function isStale(m: SyncMemory, w: WorldState): boolean {
  return m.config !== w.config || m.last[0]! > w.time;
}

function syncState(w: WorldState): Float64Array {
  let s = lastSync.get(w);
  if (s === undefined) {
    s = { config: w.config, last: new Float64Array(1) };
    s.last[0] = -1;
    lastSync.set(w, s);
  } else if (isStale(s, w)) {
    s.config = w.config;
    s.last[0] = -1;
  }
  return s.last;
}

/** Sim time of this run's last sync kill, -1 when none (read-only; used by sim/stateHash). */
export function lastSyncTime(w: WorldState): number {
  const s = lastSync.get(w);
  return s === undefined || isStale(s, w) ? -1 : s.last[0]!;
}

function extendChain(w: WorldState, p: PlayerEntity): void {
  const inWindow = p.comboTimer > 0 && p.combo > 0;
  p.combo = inWindow ? p.combo + 1 : 1;
  p.comboTimer = COMBO.WINDOW;
  if (p.combo > p.bestCombo) p.bestCombo = p.combo;
  const before = effectiveComboTier(p);
  p.comboTier = comboTierFor(p.combo);
  const after = effectiveComboTier(p);
  if (after > before) emitWave(w, 'comboTier', after, p.index);
}

function trySync(w: WorldState, p: PlayerEntity): void {
  if (w.mode !== 'coop') return;
  const q = w.players[p.index === 0 ? 1 : 0];
  if (q.life !== 'alive' || q.lastKillTime < 0) return;
  const s = syncState(w);
  if (s[0]! >= 0 && w.time - s[0]! < SYNC_COOLDOWN) return;
  if (w.time - q.lastKillTime > COOP.SYNC_WINDOW || q.lastKillTime <= s[0]!) return;
  s[0] = w.time;
  grantShards(w, p.index, COOP.SYNC_SHARDS);
  grantShards(w, q.index, COOP.SYNC_SHARDS);
  addOverdrive(w, p.index, COOP.SYNC_OVERDRIVE);
  addOverdrive(w, q.index, COOP.SYNC_OVERDRIVE);
  emitWave(w, 'sync', COOP.SYNC_SHARDS, p.index);
}

function creditKiller(w: WorldState, p: PlayerEntity, baseScore: number): void {
  trySync(w, p);
  extendChain(w, p);
  p.score += Math.round(baseScore * comboScoreMul(p));
  p.kills++;
  p.lastKillTime = w.time;
  addOverdrive(w, p.index, OVERDRIVE.PER_KILL);
  if (cardStacks(p, CARD_BIT.vampireCode) > 0) p.cards.vampireKills++;
}

/** Called by applyDamage on every kill; handles chains, tiers, sync kills (co-op only), score. */
export function registerKill(
  w: WorldState,
  by: DamageSource,
  _x: number,
  _z: number,
  baseScore: number,
): void {
  if (by === 0 || by === 1) {
    const p = w.players[by];
    if (p.life !== 'absent') creditKiller(w, p, baseScore);
    return;
  }
  if (by !== SOURCE_LINK || w.mode === 'versus') return;
  // Link beam kills count for both players' combos; the score is shared.
  const n = w.run.playerCount;
  for (let i = 0; i < n; i++) {
    const p = w.players[i as PlayerIndex];
    if (p.life !== 'alive') continue;
    extendChain(w, p);
    p.score += Math.round((baseScore / n) * comboScoreMul(p));
  }
}

/** Halves the chain on hit (COMBO.HIT_KEEP). */
export function registerPlayerHit(w: WorldState, p: PlayerIndex): void {
  const pl = w.players[p];
  pl.combo = Math.floor(pl.combo * COMBO.HIT_KEEP);
  pl.comboTier = comboTierFor(pl.combo);
  if (pl.combo === 0) pl.comboTimer = 0;
}

/** Chain timers: a chain whose window expires resets to 0. */
export const stepCombo: SimSystem = (w: WorldState, _intents: Intents, dt: number): void => {
  for (let i = 0; i < 2; i++) {
    const p = w.players[i as PlayerIndex];
    if (p.comboTimer <= 0) continue;
    p.comboTimer -= dt;
    if (p.comboTimer <= 0) {
      p.comboTimer = 0;
      p.combo = 0;
      p.comboTier = 0;
    }
  }
};

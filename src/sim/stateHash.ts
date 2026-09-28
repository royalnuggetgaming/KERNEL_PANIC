/**
 * Deterministic 32-bit FNV-1a hash of the simulation state (determinism and soak tests, debug overlay).
 * Covers the clock, players, every pool (dense order, which is itself deterministic), bosses, lasers, link,
 * run counters, flags, director, the sim/shop rng states, W1-COMBAT's per-world memory (sync kills, ram
 * stamps) and the fractional Shard carry. Presentation-only data (events, view rect, hit flashes) is excluded. Allocation-free.
 */
import {
  BOSS_IDS,
  ENEMY_KINDS,
  RUN_MODES,
  SPECIAL_KINDS,
  VEHICLE_IDS,
  type BossId,
  type EnemyKind,
  type SpecialKind,
  type VehicleId,
} from '../contracts/ids';
import type {
  BossEntity,
  EnemyEntity,
  EntityPoolApi,
  LifeState,
  PickupEntity,
  PlayerEntity,
  ProjectileEntity,
} from '../contracts/sim';
import { DIFFICULTY_IDS } from '../contracts/save';
import { NUMERIC_STATS } from '../contracts/upgrades';
import type { WavePhase, WorldState } from '../contracts/world';
import { FNV_OFFSET, fnv1aMixF64, fnv1aMixU32 } from '../core/hash';
import { lastSyncTime } from '../entities/combo';
import { ramStamps } from '../entities/playerDash';
import { shardCarryOf } from '../entities/wallet';

const LIFE: readonly LifeState[] = ['alive', 'downed', 'offline', 'respawning', 'absent'];
const PHASES: readonly WavePhase[] = [
  'idle',
  'countdown',
  'combat',
  'boss',
  'purge',
  'clearOutro',
  'roundOutro',
  'done',
];
const RNG_STATE = new Uint32Array(4);

function idx<T>(list: readonly T[], v: T): number {
  return list.indexOf(v);
}

function mixBool(h: number, b: boolean): number {
  return fnv1aMixU32(h, b ? 1 : 0);
}

function mixPlayer(h0: number, p: Readonly<PlayerEntity>): number {
  let h = h0;
  h = fnv1aMixU32(h, idx(LIFE, p.life));
  h = fnv1aMixU32(h, idx<VehicleId>(VEHICLE_IDS, p.vehicle));
  h = fnv1aMixF64(h, p.x);
  h = fnv1aMixF64(h, p.z);
  h = fnv1aMixF64(h, p.vx);
  h = fnv1aMixF64(h, p.vz);
  h = fnv1aMixF64(h, p.yaw);
  h = fnv1aMixF64(h, p.hp);
  h = fnv1aMixF64(h, p.overdrive);
  h = fnv1aMixF64(h, p.fireAcc);
  h = fnv1aMixF64(h, p.dashCharges);
  h = fnv1aMixF64(h, p.dashCooldownLeft);
  h = fnv1aMixF64(h, p.invulnUntil);
  h = fnv1aMixF64(h, p.bleedLeft);
  h = fnv1aMixF64(h, p.reviveProgress);
  h = fnv1aMixF64(h, p.respawnTimer);
  h = fnv1aMixF64(h, p.score);
  h = fnv1aMixU32(h, p.kills);
  h = fnv1aMixF64(h, p.damageDealt);
  h = fnv1aMixF64(h, p.damageTaken);
  h = fnv1aMixU32(h, p.combo);
  h = fnv1aMixF64(h, p.comboTimer);
  h = fnv1aMixU32(h, p.cardMask);
  for (let i = 0; i < p.cardStacks.length; i++) h = fnv1aMixU32(h, p.cardStacks[i]!);
  for (let i = 0; i < NUMERIC_STATS.length; i++) h = fnv1aMixF64(h, p.stats[NUMERIC_STATS[i]!]);
  const s = p.special;
  h = mixBool(h, s.active);
  h = fnv1aMixU32(h, idx<SpecialKind>(SPECIAL_KINDS, s.kind));
  h = fnv1aMixF64(h, s.timer);
  h = fnv1aMixF64(h, s.x);
  h = fnv1aMixF64(h, s.z);
  h = fnv1aMixU32(h, s.pendingCasts);
  const c = p.cards;
  h = fnv1aMixF64(h, c.missileTimer);
  h = fnv1aMixF64(h, c.nanoshieldTimer);
  h = mixBool(h, c.nanoshieldReady);
  h = fnv1aMixU32(h, c.vampireKills);
  h = fnv1aMixF64(h, c.orbitAngle);
  h = fnv1aMixU32(h, c.forkShotCounter);
  return h;
}

function mixEnemies(h0: number, pool: EntityPoolApi<EnemyEntity>): number {
  let h = fnv1aMixU32(h0, pool.count);
  for (let i = 0; i < pool.count; i++) {
    const e = pool.active[i]!;
    h = fnv1aMixU32(h, e.slot);
    h = fnv1aMixU32(h, idx<EnemyKind>(ENEMY_KINDS, e.kind));
    h = mixBool(h, e.elite);
    h = mixBool(h, e.dying);
    h = fnv1aMixF64(h, e.x);
    h = fnv1aMixF64(h, e.z);
    h = fnv1aMixF64(h, e.vx);
    h = fnv1aMixF64(h, e.vz);
    h = fnv1aMixF64(h, e.hp);
    h = fnv1aMixU32(h, e.ai);
    h = fnv1aMixF64(h, e.aiTimer);
    h = fnv1aMixU32(h, e.target);
    h = fnv1aMixU32(h, e.latched);
  }
  return h;
}

function mixShots(h0: number, pool: EntityPoolApi<ProjectileEntity>): number {
  let h = fnv1aMixU32(h0, pool.count);
  for (let i = 0; i < pool.count; i++) {
    const p = pool.active[i]!;
    h = fnv1aMixU32(h, p.slot);
    h = fnv1aMixU32(h, p.kind);
    h = fnv1aMixF64(h, p.x);
    h = fnv1aMixF64(h, p.z);
    h = fnv1aMixF64(h, p.vx);
    h = fnv1aMixF64(h, p.vz);
    h = fnv1aMixF64(h, p.damage);
    h = fnv1aMixF64(h, p.life);
    h = fnv1aMixU32(h, p.pierce);
    h = fnv1aMixU32(h, p.owner + 8);
  }
  return h;
}

function mixPickups(h0: number, pool: EntityPoolApi<PickupEntity>): number {
  let h = fnv1aMixU32(h0, pool.count);
  for (let i = 0; i < pool.count; i++) {
    const k = pool.active[i]!;
    h = fnv1aMixU32(h, k.slot);
    h = fnv1aMixF64(h, k.x);
    h = fnv1aMixF64(h, k.z);
    h = fnv1aMixU32(h, k.value);
    h = fnv1aMixF64(h, k.age);
  }
  return h;
}

function mixBoss(h0: number, b: Readonly<BossEntity>): number {
  let h = mixBool(h0, b.alive);
  if (!b.alive) return h;
  h = fnv1aMixU32(h, idx<BossId>(BOSS_IDS, b.id));
  h = fnv1aMixF64(h, b.x);
  h = fnv1aMixF64(h, b.z);
  h = fnv1aMixF64(h, b.hp);
  h = fnv1aMixU32(h, b.phase);
  h = fnv1aMixU32(h, b.patternStep);
  h = fnv1aMixF64(h, b.patternTimer);
  h = fnv1aMixF64(h, b.aimAngle);
  h = mixBool(h, b.enraged);
  return fnv1aMixF64(h, b.deathTime);
}

function mixWorldTail(h0: number, w: WorldState): number {
  let h = h0;
  const lasers = w.lasers;
  h = fnv1aMixU32(h, lasers.count);
  for (let i = 0; i < lasers.count; i++) {
    const l = lasers.active[i]!;
    h = fnv1aMixF64(h, l.angle);
    h = fnv1aMixF64(h, l.life);
    h = fnv1aMixF64(h, l.warmup);
  }
  for (let i = 0; i < w.bosses.length; i++) h = mixBoss(h, w.bosses[i]!);
  const link = w.link;
  h = mixBool(h, link.active);
  h = mixBool(h, link.cut);
  h = fnv1aMixF64(h, link.droneAngle);
  h = fnv1aMixU32(h, link.latchedCount);
  const d = w.director;
  h = fnv1aMixF64(h, d.budgetLeft);
  h = fnv1aMixF64(h, d.pulseTimer);
  h = fnv1aMixU32(h, d.pulseIndex);
  h = fnv1aMixU32(h, d.pending.count);
  for (let i = 0; i < d.pending.count; i++) {
    const p = d.pending.active[i]!;
    h = fnv1aMixF64(h, p.x);
    h = fnv1aMixF64(h, p.z);
    h = fnv1aMixF64(h, p.delay);
  }
  return h;
}

function mixRun(h0: number, w: WorldState): number {
  const r = w.run;
  let h = fnv1aMixU32(h0, idx(RUN_MODES, r.mode));
  h = fnv1aMixU32(h, idx(DIFFICULTY_IDS, w.config.difficulty ?? 'normal'));
  h = fnv1aMixU32(h, r.wave);
  h = fnv1aMixU32(h, idx(PHASES, r.phase));
  h = fnv1aMixF64(h, r.phaseTimer);
  h = fnv1aMixF64(h, r.waveTimer);
  h = fnv1aMixU32(h, r.wallets[0]);
  h = fnv1aMixU32(h, r.wallets[1]);
  h = fnv1aMixU32(h, r.shardsEarned[0]);
  h = fnv1aMixU32(h, r.shardsEarned[1]);
  h = fnv1aMixU32(h, r.spareKernels);
  h = fnv1aMixU32(h, r.bossesKilled);
  h = fnv1aMixU32(h, r.wavesCleared);
  h = fnv1aMixF64(h, r.enemyHpMul);
  h = fnv1aMixF64(h, r.wipeGrace);
  h = fnv1aMixF64(h, r.elapsed);
  h = fnv1aMixU32(h, r.round);
  h = fnv1aMixU32(h, r.roundWins[0]);
  h = fnv1aMixU32(h, r.roundWins[1]);
  h = mixBool(h, r.suddenDeath);
  h = fnv1aMixU32(h, r.roundWinner + 8);
  h = fnv1aMixU32(h, r.matchWinner + 8);
  const f = w.flags;
  h = mixBool(h, f.waveClearReady);
  h = mixBool(h, f.defeat);
  h = mixBool(h, f.finalVisit);
  h = mixBool(h, f.roundOver);
  return mixBool(h, f.matchOver);
}

function mixRng(h0: number, w: WorldState): number {
  let h = h0;
  w.rng.sim.getState(RNG_STATE);
  for (let i = 0; i < 4; i++) h = fnv1aMixU32(h, RNG_STATE[i]!);
  w.rng.shop.getState(RNG_STATE);
  for (let i = 0; i < 4; i++) h = fnv1aMixU32(h, RNG_STATE[i]!);
  return h;
}

/**
 * Per-world memory kept outside the world object: W1-COMBAT's sync kills and Bulwark ram stamps, and the
 * players' fractional Shard carry.
 */
function mixCombatMemory(h0: number, w: WorldState): number {
  let h = fnv1aMixF64(h0, lastSyncTime(w));
  h = fnv1aMixF64(h, shardCarryOf(w, 0));
  h = fnv1aMixF64(h, shardCarryOf(w, 1));
  const ram = ramStamps(w);
  if (ram === null) return fnv1aMixU32(h, 0);
  h = fnv1aMixU32(h, ram.length);
  for (let i = 0; i < ram.length; i++) h = fnv1aMixU32(h, ram[i]!);
  return h;
}

/** fnv1a over tick, positions, hp, wallets, pool counts and rng state (core/hash fnv1aMix*). */
export function stateHash(w: WorldState): number {
  let h = fnv1aMixU32(FNV_OFFSET, w.tick);
  h = fnv1aMixF64(h, w.time);
  h = mixPlayer(h, w.players[0]);
  h = mixPlayer(h, w.players[1]);
  h = mixEnemies(h, w.enemies);
  h = mixShots(h, w.playerShots);
  h = mixShots(h, w.enemyShots);
  h = mixPickups(h, w.pickups);
  h = mixWorldTail(h, w);
  h = mixRun(h, w);
  h = mixRng(h, w);
  return mixCombatMemory(h, w) >>> 0;
}

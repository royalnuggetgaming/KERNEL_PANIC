/**
 * Co-op/solo wave rules: countdown, wave timer + PURGE, boss-wave clear, the wave-clear outro (bullet wipe,
 * invulnerability, slow-mo request, vacuum, clear bonus, reboot), waveClearReady / finalVisit / victory flags
 * and the team-wipe grace -> defeat. The clear check always runs before the wipe check (clear beats wipe).
 */
import type { PlayerIndex } from '../contracts/ids';
import type { Intents } from '../contracts/input';
import type { SimSystem, WorldState } from '../contracts/world';
import { CORRUPTED, ENEMY_DEFS } from '../config/enemies';
import { COOP } from '../config/tuning';
import { WAVES, bossForWave, clearBonus, sectorOf } from '../config/waves';
import { bossAlive } from '../entities/bosses';
import { emitExplosionEvent, emitWaveEvent } from '../entities/contentShared';
import { grantShards, dropShards, vacuumPickups } from '../entities/pickups';
import { livingPlayerCount, rebootAtWaveEnd } from '../entities/revive';
import { directorDone, generateWavePlan, startWave } from './WaveDirector';

/** Sim seconds of 0.35x slow-mo at the start of the outro (0.6 s of wall-clock time at 0.35x). */
export const SLOWMO_SIM_TIME = WAVES.SLOWMO_TIME * WAVES.SLOWMO_SCALE;

function protectPlayers(w: WorldState, seconds: number): void {
  const until = w.time + seconds;
  for (let i = 0; i < 2; i++) {
    const p = w.players[i === 0 ? 0 : 1];
    if (p.life !== 'absent' && p.invulnUntil < until) p.invulnUntil = until;
  }
}

/** Starts wave `wave`'s countdown: sets wave/sector/overflow, fixes enemyHpMul/threatMul, startWave(generateWavePlan(...)). */
export function beginWave(w: WorldState, wave: number): void {
  const run = w.run;
  run.wave = wave;
  run.sector = sectorOf(wave);
  run.overflow = wave > WAVES.TOTAL;
  const plan = generateWavePlan(wave, run.playerCount, w.mode, w.config.difficulty);
  run.enemyHpMul = plan.hpMul;
  run.threatMul = plan.threatMul;
  run.waveDuration = plan.duration;
  run.waveTimer = plan.duration;
  run.phase = 'countdown';
  run.phaseTimer = WAVES.COUNTDOWN;
  run.timeScaleRequest = 1;
  run.wipeGrace = -1;
  w.flags.waveClearReady = false;
  w.flags.defeat = false;
  w.flags.finalVisit = false;
  w.enemyShots.clear();
  w.lasers.clear();
  startWave(w, plan);
  w.players[0].downsThisWave = 0;
  w.players[1].downsThisWave = 0;
  protectPlayers(w, WAVES.COUNTDOWN);
  emitWaveEvent(w, 'countdown', WAVES.COUNTDOWN, -1);
}

/** Counts a phase timer down, emitting a 'countdown' wave event on every whole second. True when it ends. */
export function tickCountdown(w: WorldState, dt: number): boolean {
  const run = w.run;
  const before = Math.ceil(run.phaseTimer);
  run.phaseTimer -= dt;
  const after = Math.ceil(run.phaseTimer);
  if (after < before && after > 0) emitWaveEvent(w, 'countdown', after, -1);
  return run.phaseTimer <= 0;
}

/** Shards an enemy pays when purged: 50% of its drop (elite x3), rounded down. */
export function purgePayout(kind: keyof typeof ENEMY_DEFS, elite: boolean): number {
  const drop = ENEMY_DEFS[kind].drop * (elite ? CORRUPTED.dropMul : 1);
  return Math.floor(drop * WAVES.PURGE_PAYOUT);
}

function purgeAt(w: WorldState, i: number): void {
  const pool = w.enemies;
  const e = pool.active[i]!;
  const pay = purgePayout(e.kind, e.elite);
  if (pay > 0) dropShards(w, e.x, e.z, pay);
  emitExplosionEvent(w, e.x, e.z, e.radius * 1.5, 0.25);
  if (e.latched === 1 && w.link.latchedCount > 0) w.link.latchedCount--;
  pool.despawn(e);
}

/**
 * Starts PURGE: pending spawns and the remaining budget are dropped, and every surviving enemy gets a
 * staggered de-rez time within PURGE_TIME (stored in aiTimer; enemies are frozen outside combat).
 * A boss kill is a won wave (clear beats wipe), so its purge drops the wipe grace; a wave-timer purge keeps
 * it running because the wave is not won until the purge ends with someone standing.
 */
function startPurge(w: WorldState, won: boolean): void {
  const run = w.run;
  run.phase = 'purge';
  run.phaseTimer = WAVES.PURGE_TIME;
  if (won) run.wipeGrace = -1;
  w.director.pending.clear();
  w.director.budgetLeft = 0;
  const pool = w.enemies;
  const n = pool.count;
  for (let i = 0; i < n; i++) {
    const e = pool.active[i]!;
    e.aiTimer = (WAVES.PURGE_TIME * (i + 1)) / n;
    e.vx = 0;
    e.vz = 0;
  }
  emitWaveEvent(w, 'purge', n, -1);
}

/** De-rezzes enemies at their staggered times; everything left goes when the purge ends. */
function purgeTick(w: WorldState, dt: number): void {
  const run = w.run;
  run.phaseTimer -= dt;
  const pool = w.enemies;
  const all = run.phaseTimer <= 0;
  for (let i = pool.count - 1; i >= 0; i--) {
    const e = pool.active[i]!;
    e.aiTimer -= dt;
    if (all || e.aiTimer <= 0) purgeAt(w, i);
  }
}

function startOutro(w: WorldState): void {
  const run = w.run;
  run.phase = 'clearOutro';
  run.phaseTimer = WAVES.CLEAR_OUTRO;
  run.wipeGrace = -1;
  run.timeScaleRequest = WAVES.SLOWMO_SCALE;
  w.enemyShots.clear();
  w.lasers.clear();
  w.director.pending.clear();
  w.director.budgetLeft = 0;
  protectPlayers(w, WAVES.CLEAR_OUTRO);
  vacuumPickups(w);
  emitWaveEvent(w, 'cleared', run.wave, -1);
}

function finishWave(w: WorldState): void {
  const run = w.run;
  const bonus = clearBonus(run.wave);
  for (let i = 0; i < 2; i++) {
    const idx: PlayerIndex = i === 0 ? 0 : 1;
    const p = w.players[idx];
    if (p.life === 'absent') continue;
    const amount = p.life === 'offline' ? Math.floor(bonus * WAVES.OFFLINE_CLEAR_BONUS_MUL) : bonus;
    grantShards(w, idx, amount);
  }
  rebootAtWaveEnd(w);
  vacuumPickups(w);
  run.wavesCleared++;
  if (run.wave === WAVES.TOTAL) {
    run.victoryAchieved = true;
    w.flags.finalVisit = true;
  }
  run.timeScaleRequest = 1;
  run.phase = 'done';
  run.phaseTimer = 0;
  w.flags.waveClearReady = true;
}

function outroTick(w: WorldState, dt: number): void {
  const run = w.run;
  run.phaseTimer -= dt;
  w.enemyShots.clear();
  const elapsed = WAVES.CLEAR_OUTRO - run.phaseTimer;
  run.timeScaleRequest = elapsed < SLOWMO_SIM_TIME ? WAVES.SLOWMO_SCALE : 1;
  if (run.phaseTimer <= 0) finishWave(w);
}

/** Team wipe: no living player for COOP.WIPE_GRACE seconds -> defeat. Returns true when defeat was flagged. */
function checkWipe(w: WorldState, dt: number): boolean {
  const run = w.run;
  if (livingPlayerCount(w) > 0) {
    run.wipeGrace = -1;
    return false;
  }
  if (run.wipeGrace < 0) run.wipeGrace = COOP.WIPE_GRACE;
  run.wipeGrace -= dt;
  if (run.wipeGrace > 0) return false;
  run.wipeGrace = 0;
  run.phase = 'done';
  run.phaseTimer = 0;
  run.timeScaleRequest = 1;
  w.flags.defeat = true;
  return true;
}

function stepRulesImpl(w: WorldState, _intents: Intents, dt: number): void {
  if (w.mode === 'versus') return;
  const run = w.run;
  switch (run.phase) {
    case 'countdown':
      if (tickCountdown(w, dt)) {
        run.phaseTimer = 0;
        run.phase = bossForWave(run.wave) !== null ? 'boss' : 'combat';
        emitWaveEvent(w, 'start', run.wave, -1);
      }
      return;
    case 'combat':
      run.waveTimer = run.waveTimer > dt ? run.waveTimer - dt : 0;
      if (directorDone(w) && w.enemies.count === 0) {
        startOutro(w);
        return;
      }
      if (run.waveTimer <= 0) {
        startPurge(w, false);
        return;
      }
      checkWipe(w, dt);
      return;
    case 'boss':
      run.waveTimer = run.waveTimer > dt ? run.waveTimer - dt : 0;
      if (w.director.bossSpawned && !bossAlive(w)) {
        if (w.enemies.count > 0) startPurge(w, true);
        else startOutro(w);
        return;
      }
      checkWipe(w, dt);
      return;
    case 'purge':
      // Only a wave-timer purge can still be lost (boss waves purge after the kill, and their timer never purges).
      if (bossForWave(run.wave) === null && checkWipe(w, dt)) return;
      purgeTick(w, dt);
      if (w.enemies.count === 0 && run.wipeGrace < 0) startOutro(w);
      return;
    case 'clearOutro':
      outroTick(w, dt);
      return;
    case 'idle':
    case 'roundOutro':
    case 'done':
      return;
  }
}

/** countdown, wave timer + purge, clear outro (bullet wipe, invuln, slow-mo via timeScaleRequest, vacuum, reboot, clear bonus), waveClearReady, finalVisit, victory flags, wipe grace -> defeat; clear beats wipe */
export const stepRules: SimSystem = stepRulesImpl;

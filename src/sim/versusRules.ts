/**
 * VERSUS rules (docs/ARCHITECTURE.md "Versus addendum"): round start/reset, elimination, 90 s round timer,
 * HP-fraction timeout, sudden death, draws, round shards, 2 s round outro, then roundOver or matchOver.
 */
import type { PlayerIndex } from '../contracts/ids';
import type { Intents } from '../contracts/input';
import type { PlayerEntity } from '../contracts/sim';
import type { SimSystem, WorldState } from '../contracts/world';
import { VERSUS, versusWaveForRound } from '../config/versus';
import { sectorOf } from '../config/waves';
import { emitWaveEvent } from '../entities/contentShared';
import { clearEnemies } from '../entities/enemies';
import { grantShards, vacuumPickups } from '../entities/pickups';
import { resetPlayersForRound } from '../entities/players';
import { tickCountdown } from './rules';
import { generateWavePlan, startWave } from './WaveDirector';

/** Pure timeout decision: 0/1 winner by hp fraction, -1 exact tie. */
export function decideTimeout(p0HpFrac: number, p1HpFrac: number): 0 | 1 | -1 {
  if (p0HpFrac > p1HpFrac) return 0;
  if (p1HpFrac > p0HpFrac) return 1;
  return -1;
}

/**
 * Pure match decision after `round` rounds: 0/1 match winner, -1 drawn match, -2 match continues.
 * First to ROUNDS_TO_WIN; after MAX_ROUNDS the leader wins; a level score plays up to TIEBREAK_ROUNDS more.
 */
export function decideMatch(roundWins: readonly [number, number], round: number): PlayerIndex | -1 | -2 {
  const a = roundWins[0];
  const b = roundWins[1];
  if (a >= VERSUS.ROUNDS_TO_WIN) return 0;
  if (b >= VERSUS.ROUNDS_TO_WIN) return 1;
  if (round < VERSUS.MAX_ROUNDS) return -2;
  if (a !== b) return a > b ? 0 : 1;
  if (round < VERSUS.MAX_ROUNDS + VERSUS.TIEBREAK_ROUNDS) return -2;
  return -1;
}

function hpFrac(p: Readonly<PlayerEntity>): number {
  const max = p.stats.maxHp;
  return max > 0 ? Math.max(0, p.hp) / max : 0;
}

function protectPlayers(w: WorldState, seconds: number): void {
  const until = w.time + seconds;
  for (let i = 0; i < 2; i++) {
    const p = w.players[i === 0 ? 0 : 1];
    if (p.invulnUntil < until) p.invulnUntil = until;
  }
}

/** Starts round `round`: resetPlayersForRound, clear pools, hazards plan (versusWaveForRound), 3 s countdown. */
export function beginVersusRound(w: WorldState, round: number): void {
  const run = w.run;
  vacuumPickups(w);
  clearEnemies(w);
  w.enemyShots.clear();
  w.playerShots.clear();
  w.lasers.clear();
  w.deathQueue.clear();
  resetPlayersForRound(w);
  const wave = versusWaveForRound(round);
  const plan = generateWavePlan(wave, 2, 'versus', w.config.difficulty);
  run.round = round;
  run.wave = wave;
  run.sector = sectorOf(wave);
  run.overflow = false;
  run.enemyHpMul = plan.hpMul;
  run.threatMul = plan.threatMul;
  run.waveDuration = VERSUS.ROUND_TIME;
  run.waveTimer = VERSUS.ROUND_TIME;
  run.phase = 'countdown';
  run.phaseTimer = VERSUS.COUNTDOWN;
  run.suddenDeath = false;
  run.roundWinner = -2;
  run.spareKernels = 0;
  run.wipeGrace = -1;
  run.timeScaleRequest = 1;
  w.flags.roundOver = false;
  w.flags.matchOver = false;
  startWave(w, plan);
  protectPlayers(w, VERSUS.COUNTDOWN);
  emitWaveEvent(w, 'roundStart', round, -1);
  emitWaveEvent(w, 'countdown', VERSUS.COUNTDOWN, -1);
}

function startSuddenDeath(w: WorldState): void {
  const run = w.run;
  run.suddenDeath = true;
  run.phaseTimer = VERSUS.SUDDEN_DEATH_TIME;
  for (let i = 0; i < 2; i++) {
    const p = w.players[i === 0 ? 0 : 1];
    if (p.life === 'alive' && p.hp > VERSUS.SUDDEN_DEATH_HP) p.hp = VERSUS.SUDDEN_DEATH_HP;
  }
  emitWaveEvent(w, 'suddenDeath', VERSUS.SUDDEN_DEATH_TIME, -1);
}

function endRound(w: WorldState, winner: PlayerIndex | -1): void {
  const run = w.run;
  run.roundWinner = winner;
  if (winner === -1) {
    grantShards(w, 0, VERSUS.ROUND_DRAW_SHARDS);
    grantShards(w, 1, VERSUS.ROUND_DRAW_SHARDS);
  } else {
    run.roundWins[winner]++;
    grantShards(w, winner, VERSUS.ROUND_WIN_SHARDS);
    grantShards(w, winner === 0 ? 1 : 0, VERSUS.ROUND_LOSS_SHARDS);
  }
  emitWaveEvent(w, 'roundEnd', winner, winner);
  const match = decideMatch(run.roundWins, run.round);
  if (match !== -2) {
    run.matchWinner = match;
    emitWaveEvent(w, 'matchEnd', match, match);
  }
  run.phase = 'roundOutro';
  run.phaseTimer = VERSUS.ROUND_OUTRO;
  w.enemyShots.clear();
  w.playerShots.clear();
  w.lasers.clear();
  protectPlayers(w, VERSUS.ROUND_OUTRO);
}

function finishRound(w: WorldState): void {
  const run = w.run;
  vacuumPickups(w);
  run.phase = 'done';
  run.phaseTimer = 0;
  if (decideMatch(run.roundWins, run.round) === -2) w.flags.roundOver = true;
  else w.flags.matchOver = true;
}

function stepCombat(w: WorldState, dt: number): void {
  const run = w.run;
  const out0 = w.players[0].life !== 'alive';
  const out1 = w.players[1].life !== 'alive';
  if (out0 || out1) {
    endRound(w, out0 && out1 ? -1 : out0 ? 1 : 0);
    return;
  }
  if (run.suddenDeath) {
    run.phaseTimer -= dt;
    if (run.phaseTimer <= 0) endRound(w, -1);
    return;
  }
  run.waveTimer = run.waveTimer > dt ? run.waveTimer - dt : 0;
  if (run.waveTimer > 0) return;
  const decision = decideTimeout(hpFrac(w.players[0]), hpFrac(w.players[1]));
  if (decision === -1) startSuddenDeath(w);
  else endRound(w, decision);
}

function stepVersusRulesImpl(w: WorldState, _intents: Intents, dt: number): void {
  if (w.mode !== 'versus') return;
  const run = w.run;
  switch (run.phase) {
    case 'countdown':
      if (tickCountdown(w, dt)) {
        run.phaseTimer = 0;
        run.phase = 'combat';
        emitWaveEvent(w, 'start', run.round, -1);
      }
      return;
    case 'combat':
      stepCombat(w, dt);
      return;
    case 'roundOutro':
      run.phaseTimer -= dt;
      w.enemyShots.clear();
      w.playerShots.clear();
      if (run.phaseTimer <= 0) finishRound(w);
      return;
    case 'idle':
    case 'boss':
    case 'purge':
    case 'clearOutro':
    case 'done':
      return;
  }
}

/** elimination, 90 s timer, HP-fraction timeout, sudden death, draws, round shards, roundOutro -> roundOver | matchOver */
export const stepVersusRules: SimSystem = stepVersusRulesImpl;

/** RunSummary builder (GameOver screen, rewards, records). Pure over the world view. */
import type { PlayerIndex, RunOutcome } from '../contracts/ids';
import type { PlayerRunSummary, RunConfig, RunSummary } from '../contracts/run';
import type { WorldView } from '../contracts/world';

/** Versus rounds whose result is decided (the current round counts once it has a winner or a draw). */
export function roundsPlayed(w: WorldView): number {
  const run = w.run;
  if (run.mode !== 'versus' || run.round <= 0) return 0;
  return run.roundWinner === -2 ? run.round - 1 : run.round;
}

/** Versus match winner; null for co-op/solo, drawn or undecided matches and abandoned matches. */
export function matchWinnerOf(w: WorldView, outcome: RunOutcome): PlayerIndex | null {
  if (w.run.mode !== 'versus' || outcome === 'abandoned') return null;
  const m = w.run.matchWinner;
  return m === -1 ? null : m;
}

function playerSummary(w: WorldView, config: RunConfig, p: PlayerIndex): PlayerRunSummary {
  const pl = w.players[p];
  let vehicle = pl.vehicle;
  for (const pick of config.players) if (pick.player === p) vehicle = pick.vehicle;
  return {
    player: p,
    vehicle,
    score: Math.round(pl.score),
    kills: pl.kills,
    damage: Math.round(pl.damageDealt),
    shards: w.run.shardsEarned[p],
    revives: pl.revives,
    bestCombo: pl.bestCombo,
    roundWins: w.run.mode === 'versus' ? w.run.roundWins[p] : 0,
  };
}

/**
 * MVP: none in solo; the match winner in versus; otherwise the higher score, then damage, then kills
 * (P1 on a full tie).
 */
function mvpOf(players: readonly PlayerRunSummary[], winner: PlayerIndex | null): PlayerIndex | null {
  if (players.length < 2) return null;
  if (winner !== null) return winner;
  const a = players[0]!;
  const b = players[1]!;
  if (a.score !== b.score) return a.score > b.score ? a.player : b.player;
  if (a.damage !== b.damage) return a.damage > b.damage ? a.player : b.player;
  if (a.kills !== b.kills) return a.kills > b.kills ? a.player : b.player;
  return a.player;
}

export function buildRunSummary(w: WorldView, config: RunConfig, outcome: RunOutcome): RunSummary {
  const run = w.run;
  const players: PlayerRunSummary[] = [];
  for (let i = 0; i < 2; i++) {
    const p: PlayerIndex = i === 0 ? 0 : 1;
    if (w.players[p].life !== 'absent') players.push(playerSummary(w, config, p));
  }
  const winner = matchWinnerOf(w, outcome);
  let totalScore = 0;
  for (const p of players) totalScore += p.score;
  const versus = run.mode === 'versus';
  return {
    runId: config.runId,
    mode: config.mode,
    outcome,
    winner,
    waveReached: versus ? 0 : run.wave,
    wavesCleared: versus ? 0 : run.wavesCleared,
    bossesKilled: versus ? 0 : run.bossesKilled,
    victoryAchieved: versus ? false : run.victoryAchieved,
    shardsEarnedTotal: run.shardsEarned[0] + run.shardsEarned[1],
    roundsPlayed: roundsPlayed(w),
    roundWins: versus ? [run.roundWins[0], run.roundWins[1]] : [0, 0],
    durationS: run.elapsed,
    totalScore,
    players,
    mvp: mvpOf(players, winner),
  };
}

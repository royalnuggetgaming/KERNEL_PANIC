/**
 * Cores awarded once at GameOver (plan section 1 "CORES" and the versus addendum).
 * co-op/solo: floor(shards / 10) + 3 x waves + 15 x bosses + 40 on victory, capped at 400; abandoning pays the
 * same progress formula. versus: 5 per round won (both players) + 10 when the match has a winner, cap 60;
 * abandoned matches pay the round part only.
 */
import type { RunSummary } from '../contracts/run';
import { ECONOMY } from '../config/tuning';
import { VERSUS } from '../config/versus';

export type RewardLineId = 'shards' | 'waves' | 'bosses' | 'victory' | 'rounds' | 'matchWin';

export interface RewardLine {
  readonly id: RewardLineId;
  readonly amount: number;
}

export interface RewardBreakdown {
  readonly lines: readonly RewardLine[];
  readonly uncapped: number;
  readonly total: number;
  readonly capped: boolean;
}

/** Non-negative safe integer view of an untrusted count (NaN, negatives, fractions and huge values). */
function count(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(ECONOMY.CORES_MAX, Math.floor(n));
}

function breakdown(lines: RewardLine[], cap: number): RewardBreakdown {
  let uncapped = 0;
  for (const l of lines) uncapped += l.amount;
  const total = Math.min(uncapped, cap);
  return { lines, uncapped, total, capped: uncapped > cap };
}

export function computeRunRewards(summary: RunSummary): RewardBreakdown {
  if (summary.mode === 'versus') {
    const wins = count(summary.roundWins[0]) + count(summary.roundWins[1]);
    const lines: RewardLine[] = [{ id: 'rounds', amount: VERSUS.CORES_PER_ROUND_WIN * wins }];
    if (summary.winner !== null && summary.outcome !== 'abandoned')
      lines.push({ id: 'matchWin', amount: VERSUS.CORES_MATCH_WIN });
    return breakdown(lines, VERSUS.CORES_CAP);
  }
  const lines: RewardLine[] = [
    { id: 'shards', amount: Math.floor(count(summary.shardsEarnedTotal) / ECONOMY.CORES_PER_SHARDS) },
    { id: 'waves', amount: ECONOMY.CORES_PER_WAVE * count(summary.wavesCleared) },
    { id: 'bosses', amount: ECONOMY.CORES_PER_BOSS * count(summary.bossesKilled) },
  ];
  if (summary.victoryAchieved) lines.push({ id: 'victory', amount: ECONOMY.CORES_VICTORY_BONUS });
  return breakdown(lines, ECONOMY.CORES_CAP);
}

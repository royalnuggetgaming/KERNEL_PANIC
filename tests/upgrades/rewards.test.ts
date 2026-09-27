import { describe, expect, it } from 'vitest';
import type { RunSummary } from '../../src/contracts/run';
import { computeRunRewards } from '../../src/upgrades/rewards';

function summary(patch: Partial<RunSummary> = {}): RunSummary {
  return {
    runId: 'r1',
    mode: 'coop',
    outcome: 'defeat',
    winner: null,
    waveReached: 7,
    wavesCleared: 6,
    bossesKilled: 1,
    victoryAchieved: false,
    shardsEarnedTotal: 1234,
    roundsPlayed: 0,
    roundWins: [0, 0],
    durationS: 500,
    totalScore: 10000,
    players: [],
    mvp: null,
    ...patch,
  };
}

describe('computeRunRewards (co-op/solo)', () => {
  it('floor(shards/10) + 3 x waves + 15 x bosses', () => {
    const r = computeRunRewards(summary());
    expect(r.lines).toEqual([
      { id: 'shards', amount: 123 },
      { id: 'waves', amount: 18 },
      { id: 'bosses', amount: 15 },
    ]);
    expect(r.total).toBe(156);
    expect(r.capped).toBe(false);
  });

  it('adds 40 once victory was achieved (including after PUSH DEEPER)', () => {
    const r = computeRunRewards(summary({ victoryAchieved: true, outcome: 'defeat', shardsEarnedTotal: 0 }));
    expect(r.lines.find((l) => l.id === 'victory')?.amount).toBe(40);
    expect(r.total).toBe(18 + 15 + 40);
  });

  it('caps at 400 per run', () => {
    const r = computeRunRewards(
      summary({ shardsEarnedTotal: 5000, wavesCleared: 15, bossesKilled: 3, victoryAchieved: true }),
    );
    expect(r.uncapped).toBe(500 + 45 + 45 + 40);
    expect(r.total).toBe(400);
    expect(r.capped).toBe(true);
  });

  it('abandoning pays the same progress formula', () => {
    const died = computeRunRewards(summary({ outcome: 'defeat' }));
    const quit = computeRunRewards(summary({ outcome: 'abandoned' }));
    expect(quit).toEqual(died);
  });

  it('treats garbage counts as zero and stays integral', () => {
    const r = computeRunRewards(
      summary({ shardsEarnedTotal: Number.NaN, wavesCleared: -3, bossesKilled: 1.9 }),
    );
    expect(r.total).toBe(15);
    expect(Number.isSafeInteger(r.total)).toBe(true);
  });
});

describe('computeRunRewards (versus)', () => {
  it('5 per round won by either player + 10 for a match winner', () => {
    const r = computeRunRewards(
      summary({ mode: 'versus', outcome: 'victory', roundWins: [3, 2], winner: 0, shardsEarnedTotal: 9999 }),
    );
    expect(r.lines).toEqual([
      { id: 'rounds', amount: 25 },
      { id: 'matchWin', amount: 10 },
    ]);
    expect(r.total).toBe(35);
  });

  it('a drawn match pays rounds only', () => {
    const r = computeRunRewards(
      summary({ mode: 'versus', outcome: 'victory', roundWins: [2, 2], winner: null }),
    );
    expect(r.total).toBe(20);
  });

  it('an abandoned match pays the round part only', () => {
    const r = computeRunRewards(
      summary({ mode: 'versus', outcome: 'abandoned', roundWins: [2, 1], winner: 0 }),
    );
    expect(r.lines.map((l) => l.id)).toEqual(['rounds']);
    expect(r.total).toBe(15);
  });

  it('caps at 60 per match', () => {
    const r = computeRunRewards(
      summary({ mode: 'versus', outcome: 'victory', roundWins: [9, 9], winner: 1 }),
    );
    expect(r.uncapped).toBe(100);
    expect(r.total).toBe(60);
    expect(r.capped).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import type { RunSummary } from '../../src/contracts/run';
import type { SaveDelta } from '../../src/contracts/save';
import { createDefaultSave } from '../../src/save/defaults';
import { applySaveDelta, mergeSaveDelta } from '../../src/save/saveDelta';

function summary(patch: Partial<RunSummary>): RunSummary {
  return {
    runId: 'x',
    mode: 'coop',
    outcome: 'victory',
    winner: null,
    waveReached: 15,
    wavesCleared: 15,
    bossesKilled: 3,
    victoryAchieved: true,
    shardsEarnedTotal: 1,
    roundsPlayed: 0,
    roundWins: [0, 0],
    durationS: 1,
    totalScore: 777,
    players: [
      {
        player: 0,
        vehicle: 'lancer',
        score: 777,
        kills: 0,
        damage: 0,
        shards: 0,
        revives: 0,
        bestCombo: 0,
        roundWins: 0,
      },
    ],
    mvp: 0,
    ...patch,
  };
}

describe('applySaveDelta', () => {
  it('co-op victory updates runs, victories, bests and the leaderboard', () => {
    const s = applySaveDelta(createDefaultSave(), { run: summary({}) }, 123, 'x');
    expect(s.records).toMatchObject({
      runs: 1,
      victories: 1,
      bestWave: 15,
      bestScore: 777,
      versusMatches: 0,
    });
    expect(s.records.leaderboard).toEqual([
      { score: 777, wave: 15, date: 123, players: 1, mode: 'coop', vehicles: ['lancer'] },
    ]);
    expect(s.lastCommittedRunId).toBe('x');
  });

  it('versus results only bump versusMatches and runs', () => {
    const s = applySaveDelta(
      createDefaultSave(),
      { run: summary({ mode: 'versus', outcome: 'victory', winner: 1 }) },
      0,
    );
    expect(s.records).toMatchObject({ runs: 1, victories: 0, bestWave: 0, bestScore: 0, versusMatches: 1 });
    expect(s.records.leaderboard).toEqual([]);
  });

  it('clamps cores at 0 and ignores non-finite deltas', () => {
    const base = { ...createDefaultSave(), cores: 10 };
    expect(applySaveDelta(base, { coresDelta: -50 }, 0).cores).toBe(0);
    expect(applySaveDelta(base, { coresDelta: Number.NaN }, 0).cores).toBe(10);
    expect(applySaveDelta(base, { unlock: 'lancer' }, 0).unlocks).toBe(base.unlocks);
  });
});

describe('mergeSaveDelta', () => {
  it('merging then applying equals applying in sequence', () => {
    const base = { ...createDefaultSave(), cores: 500 };
    const deltas: SaveDelta[] = [
      { coresDelta: -20, meta: { hullFw: 1 }, spentDelta: { hullFw: 20 }, settings: { music: 0.1 } },
      {
        coresDelta: -35,
        meta: { hullFw: 2 },
        spentDelta: { hullFw: 35 },
        lastMode: 'coop',
        unlock: 'specter',
      },
      { settings: { sfx: 0.2 }, lastLoadout: [{ player: 0, vehicle: 'specter' }] },
    ];
    let seq = base;
    let merged: SaveDelta | null = null;
    for (const d of deltas) {
      seq = applySaveDelta(seq, d, 0);
      merged = mergeSaveDelta(merged, d);
    }
    expect(applySaveDelta(base, merged!, 0)).toEqual(seq);
  });

  it('a respec in the later delta wipes earlier levels', () => {
    const m = mergeSaveDelta(
      { meta: { hullFw: 1 }, spentDelta: { hullFw: 20 }, coresDelta: -20 },
      { respec: true, coresDelta: 20 },
    );
    expect(m).toEqual({ coresDelta: 0, respec: true });
    const withBindings = mergeSaveDelta({ run: summary({}) }, { bindings: createDefaultSave().bindings });
    expect(withBindings.run?.runId).toBe('x');
    expect(withBindings.bindings).toBeDefined();
  });
});

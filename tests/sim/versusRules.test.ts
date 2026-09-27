import { describe, expect, it } from 'vitest';
import type { WorldState } from '../../src/contracts/world';
import { SIM } from '../../src/config/tuning';
import { VERSUS } from '../../src/config/versus';
import { spawnEnemy } from '../../src/entities/enemies';
import { beginVersusRound, decideMatch, decideTimeout, stepVersusRules } from '../../src/sim/versusRules';
import { addTestEnemyShot, addTestPickup, createTestWorld, stepSystem } from '../helpers/worldFixture';

function secs(s: number): number {
  return Math.round(s / SIM.DT);
}

function roundInCombat(round = 1): WorldState {
  const w = createTestWorld({ mode: 'versus' });
  beginVersusRound(w, round);
  stepSystem(w, stepVersusRules, secs(VERSUS.COUNTDOWN) + 1);
  return w;
}

function waveEvent(w: WorldState, what: string): { value: number; player: number } | null {
  for (let i = 0; i < w.events.wave.count; i++) {
    const e = w.events.wave.get(i);
    if (e.what === what) return { value: e.value, player: e.player };
  }
  return null;
}

describe('pure decisions', () => {
  it('decideTimeout: higher hp fraction wins, exact tie -> -1', () => {
    expect(decideTimeout(0.5, 0.4)).toBe(0);
    expect(decideTimeout(0.2, 0.9)).toBe(1);
    expect(decideTimeout(0.5, 0.5)).toBe(-1);
  });

  it('decideMatch: first to 3, leader after 5, tiebreaks, then draw', () => {
    expect(decideMatch([3, 1], 4)).toBe(0);
    expect(decideMatch([0, 3], 3)).toBe(1);
    expect(decideMatch([2, 2], 4)).toBe(-2);
    expect(decideMatch([2, 1], 5)).toBe(0);
    expect(decideMatch([1, 1], 5)).toBe(-2);
    expect(decideMatch([1, 1], 6)).toBe(-2);
    expect(decideMatch([2, 1], 6)).toBe(0);
    expect(decideMatch([1, 1], 7)).toBe(-1);
  });
});

describe('beginVersusRound', () => {
  it('resets players and pools, picks the hazard row and starts a 3 s countdown', () => {
    const w = createTestWorld({ mode: 'versus' });
    spawnEnemy(w, 'shard', 0, 0, false, 0);
    addTestEnemyShot(w, 0, 0, 1, 0);
    addTestPickup(w, 9, 0, 5);
    w.players[0].hp = 10;
    beginVersusRound(w, 2);
    expect(w.enemies.count).toBe(0);
    expect(w.enemyShots.count).toBe(0);
    expect(w.pickups.count).toBe(0);
    expect(w.run.wallets[1]).toBe(5);
    expect(w.players[0].hp).toBe(w.players[0].stats.maxHp);
    expect(w.players[0].x).toBe(-VERSUS.SPAWN_OFFSET);
    expect(w.run.round).toBe(2);
    expect(w.run.wave).toBe(4);
    expect(w.run.threatMul).toBe(VERSUS.THREAT_MUL);
    expect(w.run.enemyHpMul).toBeCloseTo(Math.pow(1.07, 3) * 1.2, 12);
    expect(w.run.waveTimer).toBe(VERSUS.ROUND_TIME);
    expect(w.run.phase).toBe('countdown');
    expect(w.run.spareKernels).toBe(0);
    expect(w.director.budgetTotal).toBe(Math.round((30 + 56 + 1.8 * 16) * 0.6));
    expect(waveEvent(w, 'roundStart')?.value).toBe(2);
    const rows = [1, 2, 3, 4, 5].map((r) => {
      beginVersusRound(w, r);
      return w.run.wave;
    });
    expect(rows).toEqual([1, 4, 7, 9, 13]);
  });
});

describe('round flow', () => {
  it('elimination ends the round: +40 winner, +60 loser, outro, then roundOver', () => {
    const w = roundInCombat();
    expect(w.run.phase).toBe('combat');
    w.players[1].life = 'downed';
    stepSystem(w, stepVersusRules, 1);
    expect(w.run.phase).toBe('roundOutro');
    expect(w.run.roundWinner).toBe(0);
    expect(w.run.roundWins).toEqual([1, 0]);
    expect(w.run.wallets).toEqual([VERSUS.ROUND_WIN_SHARDS, VERSUS.ROUND_LOSS_SHARDS]);
    expect(waveEvent(w, 'roundEnd')).toEqual({ value: 0, player: 0 });
    expect(w.players[0].invulnUntil).toBeGreaterThan(w.time + 1.9);
    stepSystem(w, stepVersusRules, secs(VERSUS.ROUND_OUTRO) - 2);
    expect(w.flags.roundOver).toBe(false);
    stepSystem(w, stepVersusRules, 3);
    expect(w.flags.roundOver).toBe(true);
    expect(w.flags.matchOver).toBe(false);
    expect(w.run.phase).toBe('done');
  });

  it('both eliminated on the same tick is a draw (+40 each, no point)', () => {
    const w = roundInCombat();
    w.players[0].life = 'downed';
    w.players[1].life = 'downed';
    stepSystem(w, stepVersusRules, 1);
    expect(w.run.roundWinner).toBe(-1);
    expect(w.run.roundWins).toEqual([0, 0]);
    expect(w.run.wallets).toEqual([VERSUS.ROUND_DRAW_SHARDS, VERSUS.ROUND_DRAW_SHARDS]);
  });

  it('timeout: the higher hp fraction wins', () => {
    const w = roundInCombat();
    w.players[0].hp = w.players[0].stats.maxHp * 0.5;
    w.players[1].hp = w.players[1].stats.maxHp * 0.25;
    stepSystem(w, stepVersusRules, secs(VERSUS.ROUND_TIME) + 2);
    expect(w.run.roundWinner).toBe(0);
    expect(w.run.suddenDeath).toBe(false);
  });

  it('exact tie starts sudden death (hp <= 1), then a draw after 20 s', () => {
    const w = roundInCombat();
    stepSystem(w, stepVersusRules, secs(VERSUS.ROUND_TIME) + 2);
    expect(w.run.suddenDeath).toBe(true);
    expect(w.players[0].hp).toBe(1);
    expect(w.players[1].hp).toBe(1);
    expect(waveEvent(w, 'suddenDeath')).not.toBeNull();
    stepSystem(w, stepVersusRules, secs(VERSUS.SUDDEN_DEATH_TIME) - 2);
    expect(w.run.phase).toBe('combat');
    stepSystem(w, stepVersusRules, 3);
    expect(w.run.phase).toBe('roundOutro');
    expect(w.run.roundWinner).toBe(-1);
  });

  it('sudden death kill decides the round', () => {
    const w = roundInCombat();
    stepSystem(w, stepVersusRules, secs(VERSUS.ROUND_TIME) + 2);
    w.players[0].life = 'downed';
    stepSystem(w, stepVersusRules, 1);
    expect(w.run.roundWinner).toBe(1);
  });

  it('the third round win ends the match with a winner', () => {
    const w = createTestWorld({ mode: 'versus' });
    for (let r = 1; r <= 3; r++) {
      beginVersusRound(w, r);
      stepSystem(w, stepVersusRules, secs(VERSUS.COUNTDOWN) + 1);
      w.players[0].life = 'downed';
      stepSystem(w, stepVersusRules, secs(VERSUS.ROUND_OUTRO) + 2);
      if (r < 3) expect(w.flags.roundOver).toBe(true);
    }
    expect(w.run.roundWins).toEqual([0, 3]);
    expect(w.run.matchWinner).toBe(1);
    expect(w.flags.matchOver).toBe(true);
    expect(w.flags.roundOver).toBe(false);
  });

  it('is a no-op outside versus', () => {
    const w = createTestWorld();
    w.run.phase = 'combat';
    w.run.waveTimer = 5;
    stepSystem(w, stepVersusRules, 10);
    expect(w.run.waveTimer).toBe(5);
  });
});

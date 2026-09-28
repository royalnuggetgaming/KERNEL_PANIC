/**
 * Critic v2 B1 (fixed): a run that beat wave 15 and chose PUSH DEEPER can only end by dying or abandoning in
 * OVERFLOW. It used to show SYSTEM FAILURE, play the gameover mood and never count records.victories, although
 * the Cores victory bonus was paid. A won run is now a victory however OVERFLOW ended it.
 */
import { describe, expect, it } from 'vitest';
import type { RunOutcome } from '../../src/contracts/ids';
import { applySaveDelta } from '../../src/save/saveDelta';
import { createGameOverState } from '../../src/states/GameOverState';
import { FakeRunSession, testRunConfig } from '../helpers/fakeRun';
import { createTestSaveData } from '../helpers/fakeSave';
import { createFakeServices } from '../helpers/fakeServices';

function overflowRun(): FakeRunSession {
  const run = new FakeRunSession(testRunConfig({ runId: 'run-overflow' }));
  run.world.run.wave = 17;
  run.world.run.wavesCleared = 16;
  run.world.run.bossesKilled = 3;
  run.world.run.victoryAchieved = true;
  run.world.run.overflow = true;
  return run;
}

function enterGameOver(outcome: RunOutcome): ReturnType<typeof createFakeServices> {
  const set = createFakeServices({});
  set.fsm.stack = ['GameOver'];
  set.services.session.current = overflowRun();
  createGameOverState(set.services).enter({ outcome }, 'Playing');
  return set;
}

describe('OVERFLOW after a victory', () => {
  it.each<RunOutcome>(['defeat', 'abandoned'])('ending by %s is still reported as a victory', (outcome) => {
    const set = enterGameOver(outcome);
    const vm = set.ui.vm('gameOver');
    expect(vm?.cores.some((l) => l.label === 'Victory bonus')).toBe(true);
    expect(set.save.data.records.victories).toBe(1);
    expect(vm?.title).toBe('VICTORY');
    expect(vm?.subtitle).toBe('OVERFLOW survived to CYCLE 17');
    expect(vm?.outcome).toBe('victory');
  });

  it('a plain defeat before the final boss stays SYSTEM FAILURE', () => {
    const set = createFakeServices({});
    set.fsm.stack = ['GameOver'];
    const run = new FakeRunSession(testRunConfig({ runId: 'run-lost' }));
    run.world.run.wave = 7;
    set.services.session.current = run;
    createGameOverState(set.services).enter({ outcome: 'defeat' }, 'Playing');
    expect(set.ui.vm('gameOver')?.title).toBe('SYSTEM FAILURE');
    expect(set.save.data.records.victories).toBe(0);
  });

  it('saveDelta counts victoryAchieved as a win whatever the outcome', () => {
    const run = overflowRun();
    const summary = { ...run.summary('defeat'), victoryAchieved: true };
    const next = applySaveDelta(createTestSaveData(), { run: summary }, 1000, 'run-overflow');
    expect(next.records.victories).toBe(1);
    const lost = applySaveDelta(createTestSaveData(), { run: { ...summary, victoryAchieved: false } }, 1000);
    expect(lost.records.victories).toBe(0);
  });
});

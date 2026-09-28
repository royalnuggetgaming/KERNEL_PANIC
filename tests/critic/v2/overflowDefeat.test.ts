/**
 * Critic v2: a run that beat wave 15 and chose PUSH DEEPER can only end by dying (defeat) or abandoning in
 * OVERFLOW. The GameOver screen then says SYSTEM FAILURE, plays the gameover mood and records.victories never
 * counts the win, although the Cores victory bonus is paid and viewModels even has an unreachable
 * "OVERFLOW survived to ..." victory subtitle.
 */
import { expect, it } from 'vitest';
import { createGameOverState } from '../../../src/states/GameOverState';
import { FakeRunSession, testRunConfig } from '../../helpers/fakeRun';
import { createFakeServices } from '../../helpers/fakeServices';

it('dying in OVERFLOW after beating wave 15 is still reported as a victory', () => {
  const set = createFakeServices({});
  set.fsm.stack = ['GameOver'];
  const run = new FakeRunSession(testRunConfig({ runId: 'run-overflow' }));
  run.world.run.wave = 17;
  run.world.run.wavesCleared = 16;
  run.world.run.bossesKilled = 3;
  run.world.run.victoryAchieved = true;
  run.world.run.overflow = true;
  set.services.session.current = run;
  const state = createGameOverState(set.services);
  // PlayingState.checkFlags only ever requests outcome 'defeat' when the team wipes, OVERFLOW included.
  state.enter({ outcome: 'defeat' }, 'Playing');
  const vm = set.ui.vm('gameOver');
  expect(vm?.cores.some((l) => l.label === 'Victory bonus')).toBe(true); // bonus paid...
  expect(set.save.data.records.victories).toBe(1); // ...but the win is not recorded
  expect(vm?.title).not.toBe('SYSTEM FAILURE');
});

import { describe, expect, it } from 'vitest';
import { createGameOverState } from '../../src/states/GameOverState';
import { FakeRunSession, testRunConfig } from '../helpers/fakeRun';
import { FakeSaveStore, createTestSaveData } from '../helpers/fakeSave';
import { createFakeServices } from '../helpers/fakeServices';

function rig(save?: FakeSaveStore) {
  const set = createFakeServices(save === undefined ? {} : { save });
  set.fsm.stack = ['GameOver'];
  const run = new FakeRunSession(testRunConfig({ runId: 'run-77' }));
  run.world.run.wavesCleared = 4;
  run.world.run.bossesKilled = 1;
  run.world.run.shardsEarned[0] = 120;
  run.world.run.shardsEarned[1] = 80;
  run.world.players[0].score = 5000;
  set.services.session.current = run;
  const state = createGameOverState(set.services);
  return { set, run, state };
}

describe('gameOverCommit', () => {
  it('commits the rewards exactly once even if GameOver is entered twice', () => {
    const { set, state } = rig();
    state.enter({ outcome: 'defeat' }, 'Playing');
    state.enter({ outcome: 'defeat' }, 'Playing');
    expect(set.save.rec.count('commitRun')).toBe(1);
    // floor(200 / 10) + 3 x 4 + 15 x 1 = 47
    expect(set.save.data.cores).toBe(47);
    expect(set.save.data.lastCommittedRunId).toBe('run-77');
    expect(set.save.data.records.runs).toBe(1);
    const vm = set.ui.vm('gameOver');
    expect(vm?.coresTotal).toBe(47);
    expect(vm?.cores.map((l) => l.amount)).toEqual([20, 12, 15]);
    expect(vm?.newBest).toBe(true);
  });

  it('a fresh GameOver instance never re-commits a run the save already recorded', () => {
    const first = rig();
    first.state.enter({ outcome: 'defeat' }, 'Playing');
    const second = createGameOverState(first.set.services);
    second.enter({ outcome: 'defeat' }, 'Playing');
    expect(first.set.save.rec.count('commitRun')).toBe(1);
    expect(first.set.save.data.cores).toBe(47);
  });

  it('the store rejects a duplicate runId (idempotent) without changing anything', () => {
    const save = new FakeSaveStore(createTestSaveData({ cores: 5 }));
    const { set, state } = rig(save);
    save.data = { ...save.data, lastCommittedRunId: 'other' };
    state.enter({ outcome: 'abandoned' }, 'Paused');
    const again = save.commitRun('run-77', { coresDelta: 99 });
    expect(again.ok).toBe(false);
    expect(set.save.data.cores).toBe(52);
  });

  it('a failing write toasts and keeps going', () => {
    const save = new FakeSaveStore();
    save.failWith = 'quota';
    const { set, state } = rig(save);
    state.enter({ outcome: 'defeat' }, 'Playing');
    expect(set.ui.toasts.at(-1)?.kind).toBe('error');
    save.failWith = 'readOnly';
    const other = createGameOverState(set.services);
    set.services.session.current = new FakeRunSession(testRunConfig({ runId: 'run-78' }));
    other.enter({ outcome: 'defeat' }, 'Playing');
    expect(set.ui.toasts.at(-1)?.kind).toBe('warn');
  });

  it('exit disposes the run, detaches the world and clears the session', () => {
    const { set, run, state } = rig();
    state.enter({ outcome: 'defeat' }, 'Playing');
    state.render?.(0.5, 1 / 60);
    expect(set.render.frames).toBe(1);
    state.exit('MainMenu');
    expect(run.disposed).toBe(true);
    expect(set.render.rec.count('detachWorld')).toBe(1);
    expect(set.services.session.current).toBeNull();
    expect(set.ui.visible.has('gameOver')).toBe(false);
  });

  it('Retry prefills the picks and mode; Menu goes home', () => {
    const { set, state } = rig();
    state.enter({ outcome: 'defeat' }, 'Playing');
    set.input.queueMenu({ player: 'any', kind: 'confirm' });
    state.update(1 / 60);
    expect(set.fsm.lastRequest()).toEqual({
      to: 'CharacterSelect',
      payload: {
        prefill: [
          { player: 0, vehicle: 'lancer' },
          { player: 1, vehicle: 'bulwark' },
        ],
        mode: 'coop',
      },
    });
    const other = rig();
    other.state.enter({ outcome: 'defeat' }, 'Playing');
    other.set.ui.click({ screen: 'gameOver', kind: 'confirm', player: 'any', itemId: 'menu' });
    other.state.update(1 / 60);
    expect(other.set.fsm.lastRequest()?.to).toBe('MainMenu');
  });

  it('entering without a run shows an empty summary and commits nothing', () => {
    const set = createFakeServices();
    const state = createGameOverState(set.services);
    state.enter({ outcome: 'abandoned' }, 'Paused');
    expect(set.save.rec.count('commitRun')).toBe(0);
    expect(set.ui.vm('gameOver')?.coresTotal).toBe(0);
    expect(set.log.entries.some((e) => e.level === 'error')).toBe(true);
    state.exit('MainMenu');
  });
});

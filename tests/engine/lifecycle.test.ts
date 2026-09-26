import { describe, expect, it } from 'vitest';
import type { StateId } from '../../src/contracts/states';
import { createMemoryLogger } from '../../src/core/logger';
import { installLifecycle, type LifecycleDeps } from '../../src/engine/lifecycle';
import { FakeFsm } from '../helpers/fakeStates';
import { FakeEventTarget, FakeWindow } from '../helpers/fakeWindow';
import { createRig, walk } from './fsmFixture';

interface Counters {
  releaseAll: number;
  suspend: number;
  resume: number;
  flush: number;
}

function setup(
  stack: StateId[],
  opts: { canvas?: boolean; audioFails?: boolean; flushThrows?: boolean } = {},
) {
  const win = new FakeWindow();
  const canvas = opts.canvas === false ? null : new FakeEventTarget();
  const fsm = new FakeFsm();
  fsm.stack = stack;
  const log = createMemoryLogger();
  const c: Counters = { releaseAll: 0, suspend: 0, resume: 0, flush: 0 };
  const deps: LifecycleDeps = {
    input: {
      releaseAll: () => {
        c.releaseAll++;
      },
    },
    fsm,
    audio: {
      suspend: () => {
        c.suspend++;
        return opts.audioFails === true ? Promise.reject(new Error('nope')) : Promise.resolve();
      },
      resume: () => {
        c.resume++;
        return Promise.resolve();
      },
    },
    save: {
      flush: () => {
        c.flush++;
        if (opts.flushThrows === true) throw new Error('quota');
      },
    },
    canvas,
    log,
  };
  const uninstall = installLifecycle(win, deps);
  return { win, canvas, fsm, log, c, uninstall };
}

describe('installLifecycle', () => {
  it('blur releases input and requests Paused{blur} only when Playing is on top', () => {
    const s = setup(['Playing']);
    s.win.emit('blur');
    expect(s.c.releaseAll).toBe(1);
    expect(s.fsm.requests).toEqual([{ to: 'Paused', payload: { reason: 'blur' } }]);

    for (const stack of [
      ['Boot'],
      ['MainMenu'],
      ['Playing', 'Paused'],
      ['Playing', 'UpgradesShop'],
      ['GameOver'],
    ]) {
      const o = setup(stack as StateId[]);
      o.win.emit('blur');
      expect(o.c.releaseAll).toBe(1);
      expect(o.fsm.requests).toEqual([]);
    }
  });

  it('hidden releases, pauses, suspends audio and flushes the save; visible resumes audio', () => {
    const s = setup(['Playing']);
    s.win.document.setHidden(true);
    expect(s.c).toEqual({ releaseAll: 1, suspend: 1, resume: 0, flush: 1 });
    expect(s.fsm.requests).toEqual([{ to: 'Paused', payload: { reason: 'hidden' } }]);
    s.fsm.stack = ['Playing', 'Paused'];
    s.win.document.setHidden(false);
    expect(s.c).toEqual({ releaseAll: 2, suspend: 1, resume: 1, flush: 1 });
    expect(s.fsm.requests).toHaveLength(1);
  });

  it('hidden in a menu only releases input and suspends audio (no pause)', () => {
    const s = setup(['MainMenu']);
    s.win.document.setHidden(true);
    expect(s.c.suspend).toBe(1);
    expect(s.fsm.requests).toEqual([]);
  });

  it('pagehide releases, pauses and flushes the save', () => {
    const s = setup(['Playing']);
    s.win.emit('pagehide');
    expect(s.c.releaseAll).toBe(1);
    expect(s.c.flush).toBe(1);
    expect(s.fsm.requests).toEqual([{ to: 'Paused', payload: { reason: 'hidden' } }]);
  });

  it('fullscreenchange pauses on exit only, and always releases input', () => {
    const s = setup(['Playing']);
    s.win.document.fullscreenElement = {};
    s.win.document.emit('fullscreenchange');
    expect(s.fsm.requests).toEqual([]);
    s.win.document.fullscreenElement = null;
    s.win.document.emit('fullscreenchange');
    expect(s.c.releaseAll).toBe(2);
    expect(s.fsm.requests).toEqual([{ to: 'Paused', payload: { reason: 'fullscreen' } }]);
  });

  it('webglcontextlost prevents default, releases and pauses; restored releases', () => {
    const s = setup(['Playing']);
    const e = s.canvas!.emit('webglcontextlost');
    expect(e.defaultPrevented).toBe(true);
    expect(s.fsm.requests).toEqual([{ to: 'Paused', payload: { reason: 'contextlost' } }]);
    expect(s.log.count('warn')).toBe(1);
    s.canvas!.emit('webglcontextrestored');
    expect(s.c.releaseAll).toBe(2);
    expect(s.log.count('info')).toBe(1);
  });

  it('works without a canvas', () => {
    const s = setup(['Playing'], { canvas: false });
    expect(s.win.listenerCount()).toBe(2);
    expect(s.win.document.listenerCount()).toBe(2);
  });

  it('logs failed audio suspends and save flushes instead of throwing', async () => {
    const s = setup(['MainMenu'], { audioFails: true, flushThrows: true });
    s.win.document.setHidden(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(s.log.count('warn')).toBe(1);
    expect(s.log.count('error')).toBe(1);
  });

  it('uninstall removes every listener and is idempotent', () => {
    const s = setup(['Playing']);
    expect(s.win.listenerCount() + s.win.document.listenerCount() + s.canvas!.listenerCount()).toBe(6);
    s.uninstall();
    s.uninstall();
    expect(s.win.listenerCount() + s.win.document.listenerCount() + s.canvas!.listenerCount()).toBe(0);
    s.win.emit('blur');
    expect(s.c.releaseAll).toBe(0);
  });

  it('with the real FSM, blur then hidden queue two pauses; the second is dropped as stale', () => {
    const rig = createRig();
    rig.fsm.start();
    walk(rig.fsm, ['MainMenu', 'CharacterSelect', 'Playing']);
    const win = new FakeWindow();
    let released = 0;
    installLifecycle(win, {
      input: {
        releaseAll: () => {
          released++;
        },
      },
      fsm: rig.fsm,
      audio: { suspend: () => Promise.resolve(), resume: () => Promise.resolve() },
      save: { flush: () => undefined },
      canvas: null,
      log: createMemoryLogger(),
    });
    win.emit('blur');
    win.document.setHidden(true);
    expect(rig.fsm.pendingCount).toBe(2);
    expect(rig.fsm.applyPending()).toBe(1);
    expect(rig.fsm.stack).toEqual(['Playing', 'Paused']);
    expect(rig.spies.Paused.payloads).toEqual([{ reason: 'blur' }]);
    expect(released).toBe(2);
    win.emit('blur');
    expect(rig.fsm.pendingCount).toBe(0);
  });
});

/**
 * Plan 5 STUCK-KEY: "window blur, visibilitychange hidden, pagehide, contextmenu and fullscreenchange also call
 * releaseAll()". A native context menu (right-click, Ctrl-click on a trackpad) swallows the keyup of held keys.
 */
import { describe, expect, it } from 'vitest';
import { createMemoryLogger } from '../../src/core/logger';
import { installLifecycle } from '../../src/engine/lifecycle';
import { FakeFsm } from '../helpers/fakeStates';
import { FakeEventTarget, FakeWindow } from '../helpers/fakeWindow';

describe('installLifecycle: contextmenu', () => {
  it('contextmenu calls input.releaseAll() and never pauses on its own', () => {
    const win = new FakeWindow();
    const fsm = new FakeFsm();
    fsm.stack = ['Playing'];
    let released = 0;
    const uninstall = installLifecycle(win, {
      input: {
        releaseAll: () => {
          released++;
        },
      },
      fsm,
      audio: { suspend: () => Promise.resolve(), resume: () => Promise.resolve() },
      save: { flush: () => undefined },
      canvas: new FakeEventTarget(),
      log: createMemoryLogger(),
    });
    win.emit('contextmenu');
    expect(released).toBe(1);
    expect(fsm.stack).toEqual(['Playing']);
    uninstall();
    win.emit('contextmenu');
    expect(released).toBe(1);
  });
});

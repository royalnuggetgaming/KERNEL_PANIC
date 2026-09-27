/**
 * INPUT critic reproductions (should FAIL on the current code).
 * - INPUT-3: plan 5 STUCK-KEY: "window blur, visibilitychange hidden, pagehide, contextmenu and fullscreenchange
 *   also call releaseAll()". No contextmenu listener exists anywhere in src/.
 * - INPUT-4: a player action can be bound to a shared menu key (Backspace / Enter), which then fires two
 *   MenuIntents per press (e.g. shop: undo AND Pause in the same frame).
 */
import { describe, expect, it } from 'vitest';
import { createMemoryLogger } from '../../../src/core/logger';
import { installLifecycle } from '../../../src/engine/lifecycle';
import { proposeSwap } from '../../../src/config/bindings';
import { DEFAULT_BINDINGS } from '../../../src/config/keys';
import { FakeFsm } from '../../helpers/fakeStates';
import { FakeEventTarget, FakeWindow } from '../../helpers/fakeWindow';

describe('critic/input: stuck keys and binding validation', () => {
  it('INPUT-3: contextmenu calls input.releaseAll()', () => {
    const win = new FakeWindow();
    const fsm = new FakeFsm();
    fsm.stack = ['Playing'];
    let released = 0;
    installLifecycle(win, {
      input: { releaseAll: () => void released++ },
      fsm,
      audio: { suspend: () => Promise.resolve(), resume: () => Promise.resolve() },
      save: { flush: () => undefined },
      canvas: new FakeEventTarget(),
      log: createMemoryLogger(),
    });
    win.emit('contextmenu');
    expect(released).toBe(1);
  });

  it('INPUT-4: shared menu keys cannot be bound to a player action', () => {
    expect(proposeSwap(DEFAULT_BINDINGS, 0, 'dash', 'Backspace').ok).toBe(false);
    expect(proposeSwap(DEFAULT_BINDINGS, 0, 'fire', 'Enter').ok).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import type { PauseReason } from '../../src/contracts/states';
import { ABANDON_CLICK_WINDOW_MS, createPausedState } from '../../src/states/PausedState';
import { createFakeServices } from '../helpers/fakeServices';

function rig(reason: PauseReason = 'user') {
  const set = createFakeServices();
  set.fsm.stack = ['Playing', 'Paused'];
  const state = createPausedState(set.services);
  state.enter({ reason }, 'Playing');
  const frame = (): void => {
    state.update(1 / 60);
    set.clock.advance(1000 / 60);
  };
  return { set, state, frame };
}

describe('PausedState', () => {
  it('releases every key on enter and shows the auto-pause reason', () => {
    const { set } = rig('blur');
    expect(set.input.rec.count('releaseAll')).toBe(1);
    expect(set.input.context).toBe('menu');
    expect(set.ui.vm('pause')?.reason).toContain('focus');
    expect(set.ui.vm('pause')?.items.map((i) => i.id)).toEqual(['resume', 'settings', 'controls', 'abandon']);
  });

  it('resume (confirm or back) pops', () => {
    const { set, frame } = rig();
    set.input.queueMenu({ player: 'any', kind: 'back' });
    frame();
    expect(set.fsm.requests).toEqual([{ to: 'pop', payload: undefined }]);
  });

  it('keyboard abandon needs 600 ms of held confirm; releasing early cancels', () => {
    const { set, frame } = rig();
    set.input.queueMenu({ player: 'any', kind: 'up' });
    frame();
    // A tap (key already released) does nothing.
    set.input.queueMenu({ player: 0, kind: 'confirm' });
    frame();
    expect(set.ui.vm('pause')?.abandonHold).toBe(0);
    set.input.held.add('Space');
    set.input.queueMenu({ player: 0, kind: 'confirm' });
    for (let i = 0; i < 20; i++) frame();
    expect(set.ui.vm('pause')?.abandonHold).toBeGreaterThan(0.5);
    set.input.held.clear();
    frame();
    expect(set.ui.vm('pause')?.abandonHold).toBe(0);
    expect(set.fsm.requests).toHaveLength(0);
    set.input.held.add('Period');
    set.input.queueMenu({ player: 1, kind: 'confirm' });
    for (let i = 0; i < 40; i++) frame();
    expect(set.fsm.requests).toEqual([{ to: 'GameOver', payload: { outcome: 'abandoned' } }]);
  });

  it('moving the cursor cancels a hold', () => {
    const { set, frame } = rig();
    set.input.queueMenu({ player: 'any', kind: 'up' });
    frame();
    set.input.held.add('Enter');
    set.input.queueMenu({ player: 'any', kind: 'confirm' });
    frame();
    set.input.queueMenu({ player: 'any', kind: 'down' });
    for (let i = 0; i < 60; i++) frame();
    expect(set.fsm.requests).toHaveLength(0);
  });

  it('mouse abandon: first click arms, a second click within 2 s confirms', () => {
    const { set, frame } = rig();
    const click = (): void => {
      set.ui.click({ screen: 'pause', kind: 'confirm', player: 'any', itemId: 'abandon' });
      frame();
    };
    click();
    expect(set.fsm.requests).toHaveLength(0);
    expect(set.ui.vm('pause')?.items[3]?.hint).toBe('Click again to abandon');
    set.clock.advance(ABANDON_CLICK_WINDOW_MS + 100);
    frame();
    expect(set.ui.vm('pause')?.abandonHold).toBe(0);
    click();
    expect(set.fsm.requests).toHaveLength(0);
    set.clock.advance(500);
    click();
    expect(set.fsm.lastRequest()).toEqual({ to: 'GameOver', payload: { outcome: 'abandoned' } });
  });

  it('settings and controls sub-panels open from the pause menu', () => {
    const { set, frame, state } = rig();
    set.ui.click({ screen: 'pause', kind: 'confirm', player: 'any', itemId: 'settings' });
    frame();
    expect(set.ui.vm('pause')?.panel).toBe('settings');
    expect(set.ui.vm('pause')?.settings?.rows.length).toBeGreaterThan(0);
    set.input.queueMenu({ player: 'any', kind: 'back' });
    frame();
    expect(set.ui.vm('pause')?.panel).toBe('none');
    expect(set.fsm.requests).toHaveLength(0);
    set.input.queueMenu({ player: 'any', kind: 'down' }, { player: 'any', kind: 'confirm' });
    frame();
    expect(set.ui.vm('pause')?.panel).toBe('controls');
    state.exit('Playing');
    expect(set.ui.visible.has('pause')).toBe(false);
  });
});

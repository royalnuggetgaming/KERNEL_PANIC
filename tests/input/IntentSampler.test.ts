import { describe, expect, it } from 'vitest';
import type { PlayerIntent } from '../../src/contracts/input';
import { DEFAULT_BINDINGS } from '../../src/config/keys';
import { createIntentSampler } from '../../src/input/IntentSampler';
import { createKeyboardDevice } from '../../src/input/KeyboardDevice';
import { createIntent } from '../helpers/scriptedIntents';
import { FakeKeyTarget } from '../helpers/fakeKeyboard';

function setup() {
  const target = new FakeKeyTarget();
  const device = createKeyboardDevice(target);
  const sampler = createIntentSampler(device, DEFAULT_BINDINGS);
  sampler.setFireModes([false, false], [false, false]);
  const i0: PlayerIntent = createIntent();
  const i1: PlayerIntent = createIntent();
  const tick = (): void => {
    sampler.sample(0, i0);
    sampler.sample(1, i1);
  };
  return { target, device, sampler, i0, i1, tick };
}

describe('IntentSampler', () => {
  it('a tap within one tick latches exactly one dash', () => {
    const { target, i0, tick } = setup();
    target.tap('ShiftLeft');
    tick();
    expect(i0.dashPressed).toBe(true);
    tick();
    expect(i0.dashPressed).toBe(false);
    target.down('KeyQ');
    tick();
    expect(i0.dashPressed).toBe(true);
    tick();
    expect(i0.dashPressed).toBe(false);
  });

  it('a tap within one tick gives exactly one tick of fire (autofire off)', () => {
    const { target, i0, tick } = setup();
    tick();
    expect(i0.fireHeld).toBe(false);
    target.tap('Space');
    tick();
    expect(i0.fireHeld).toBe(true);
    expect(i0.focusHeld).toBe(true);
    tick();
    expect(i0.fireHeld).toBe(false);
    target.down('KeyF');
    tick();
    tick();
    expect(i0.fireHeld).toBe(true);
  });

  it('special latches like dash', () => {
    const { target, i1, tick } = setup();
    target.tap('Comma');
    tick();
    expect(i1.specialPressed).toBe(true);
    tick();
    expect(i1.specialPressed).toBe(false);
  });

  it('SOCD: last pressed wins per axis, falling back to the still-held key', () => {
    const { target, i0, tick } = setup();
    target.down('KeyA');
    tick();
    expect(i0.moveX).toBe(-1);
    target.down('KeyD');
    tick();
    expect(i0.moveX).toBe(1);
    target.up('KeyD');
    tick();
    expect(i0.moveX).toBe(-1);
    target.up('KeyA');
    target.down('KeyS');
    target.down('KeyW');
    tick();
    expect(i0.moveX).toBe(0);
    expect(i0.moveZ).toBe(-1);
    target.up('KeyW');
    tick();
    expect(i0.moveZ).toBe(1);
  });

  it('diagonals have length 1', () => {
    const { target, i0, i1, tick } = setup();
    target.down('KeyW');
    target.down('KeyD');
    target.down('ArrowDown');
    target.down('ArrowLeft');
    tick();
    expect(Math.hypot(i0.moveX, i0.moveZ)).toBeCloseTo(1, 12);
    expect(i0.moveX).toBeGreaterThan(0);
    expect(i0.moveZ).toBeLessThan(0);
    expect(Math.hypot(i1.moveX, i1.moveZ)).toBeCloseTo(1, 12);
    expect(i1.moveX).toBeLessThan(0);
    expect(i1.moveZ).toBeGreaterThan(0);
  });

  it('P1 and P2 are isolated in co-op', () => {
    const { target, i0, i1, tick } = setup();
    target.down('ArrowRight');
    target.tap('Slash');
    target.down('Period');
    tick();
    expect(i0).toEqual(createIntent());
    expect(i1.moveX).toBe(1);
    expect(i1.dashPressed).toBe(true);
    expect(i1.fireHeld).toBe(true);
  });

  it('solo merges both binding sets into P1 and leaves P2 neutral', () => {
    const { target, sampler, i0, i1, tick } = setup();
    sampler.setSolo(true);
    sampler.setSolo(true);
    target.down('ArrowUp');
    target.tap('NumpadDecimal');
    target.down('Numpad0');
    tick();
    expect(i0.moveZ).toBe(-1);
    expect(i0.dashPressed).toBe(true);
    expect(i0.fireHeld).toBe(true);
    expect(i1).toEqual(createIntent());
    // SOCD across both sets.
    target.down('KeyS');
    tick();
    expect(i0.moveZ).toBe(1);
    sampler.setSolo(false);
    tick();
    expect(i0.moveZ).toBe(1);
    expect(i1.moveZ).toBe(-1);
  });

  it('autofire fires without holding; hold-mode focus follows the key', () => {
    const { target, sampler, i0, i1, tick } = setup();
    sampler.setFireModes([true, false], [false, false]);
    tick();
    expect(i0.fireHeld).toBe(true);
    expect(i0.focusHeld).toBe(false);
    expect(i1.fireHeld).toBe(false);
    target.down('Space');
    tick();
    expect(i0.focusHeld).toBe(true);
    target.up('Space');
    tick();
    expect(i0.focusHeld).toBe(false);
  });

  it('toggle-mode focus flips on each fresh press and shoots while on', () => {
    const { target, sampler, i0, tick } = setup();
    sampler.setFireModes([false, false], [true, false]);
    target.tap('Space');
    tick();
    expect(i0.focusHeld).toBe(true);
    tick();
    expect(i0.focusHeld).toBe(true);
    expect(i0.fireHeld).toBe(true);
    target.tap('KeyF');
    tick();
    expect(i0.focusHeld).toBe(false);
    tick();
    expect(i0.fireHeld).toBe(false);
    target.tap('Space');
    tick();
    sampler.setFireModes([false, false], [true, false]);
    tick();
    expect(i0.focusHeld).toBe(false);
  });

  it('clearEdges drops latched presses and suppressed keys do not count', () => {
    const { target, device, sampler, i0, tick } = setup();
    target.tap('ShiftLeft');
    target.down('KeyD');
    sampler.clearEdges();
    device.suppressHeldUntilRelease();
    tick();
    expect(i0.dashPressed).toBe(false);
    expect(i0.moveX).toBe(0);
    target.up('KeyD');
    target.down('KeyD');
    tick();
    expect(i0.moveX).toBe(1);
  });

  it('setBindings rebuilds the slot tables', () => {
    const { target, sampler, i0, tick } = setup();
    sampler.setBindings({
      players: [{ ...DEFAULT_BINDINGS.players[0], dash: ['KeyG', 'NotAKey'] }, DEFAULT_BINDINGS.players[1]],
      pause: DEFAULT_BINDINGS.pause,
    });
    target.tap('ShiftLeft');
    tick();
    expect(i0.dashPressed).toBe(false);
    target.tap('KeyG');
    tick();
    expect(i0.dashPressed).toBe(true);
  });
});

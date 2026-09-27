import { describe, expect, it } from 'vitest';
import type { KeyCode, MenuIntent } from '../../src/contracts/input';
import { DEFAULT_BINDINGS } from '../../src/config/keys';
import { boundCodesOf, createInputService } from '../../src/input/InputService';
import { createIntent } from '../helpers/scriptedIntents';
import { FakeKeyTarget } from '../helpers/fakeKeyboard';

function setup() {
  const target = new FakeKeyTarget();
  const input = createInputService({ target, bindings: DEFAULT_BINDINGS });
  const buf: MenuIntent[] = new Array<MenuIntent>(8);
  const kinds = (dt = 16): string[] => {
    const n = input.pollMenu(dt, buf);
    const out: string[] = [];
    for (let i = 0; i < n; i++) out.push(`${String(buf[i]!.player)}:${buf[i]!.kind}`);
    return out;
  };
  return { target, input, kinds };
}

describe('InputService', () => {
  it('prevents default for bound codes, menu keys and Slash; passes shortcuts through', () => {
    const { target } = setup();
    for (const code of ['KeyW', 'Period', 'Slash', 'Numpad8', 'Escape', 'KeyP', 'Enter', 'Space', 'Quote']) {
      expect(target.down(code)).toBe(true);
    }
    expect(target.down('KeyZ')).toBe(false);
    expect(target.down('KeyW', { metaKey: true })).toBe(false);
    expect(target.down('KeyA', { ctrlKey: true })).toBe(false);
    expect(boundCodesOf(DEFAULT_BINDINGS).has('Backspace')).toBe(true);
  });

  it('samples gameplay intents and honours solo and fire modes', () => {
    const { target, input } = setup();
    const i0 = createIntent();
    const i1 = createIntent();
    input.setFireModes([true, true], [false, false]);
    target.down('ArrowLeft');
    input.sample(0, i0);
    input.sample(1, i1);
    expect(i0.moveX).toBe(0);
    expect(i0.fireHeld).toBe(true);
    expect(i1.moveX).toBe(-1);
    input.setSolo(true);
    input.sample(0, i0);
    input.sample(1, i1);
    expect(i0.moveX).toBe(-1);
    expect(i1.moveX).toBe(0);
  });

  it('pause intents only in gameplay; FSM transition hooks stop edges leaking', () => {
    const { target, input, kinds } = setup();
    input.setContext('gameplay');
    target.tap('Space');
    target.tap('Escape');
    expect(kinds()).toEqual(['any:pause']);
    // Confirm press in a menu must not become a shot or dash in the next state.
    input.setContext('menu');
    target.down('Space');
    target.tap('ShiftLeft');
    input.clearEdges();
    input.suppressHeldUntilRelease();
    input.setContext('gameplay');
    input.setFireModes([false, false], [false, false]);
    const i0 = createIntent();
    input.sample(0, i0);
    expect(i0.fireHeld).toBe(false);
    expect(i0.dashPressed).toBe(false);
    expect(input.heldCodes.has('Space')).toBe(true);
  });

  it('blur and visibility release everything', () => {
    const { target, input } = setup();
    target.down('KeyD');
    input.releaseAll();
    expect(input.heldCodes.size).toBe(0);
    const i0 = createIntent();
    input.sample(0, i0);
    expect(i0.moveX).toBe(0);
  });

  it('consumeAnyKey is true once per fresh press', () => {
    const { target, input } = setup();
    expect(input.consumeAnyKey()).toBe(false);
    target.down('KeyZ');
    target.repeat('KeyZ');
    expect(input.consumeAnyKey()).toBe(true);
    expect(input.consumeAnyKey()).toBe(false);
    target.down('KeyX');
    input.clearEdges();
    expect(input.consumeAnyKey()).toBe(false);
  });

  it('captureNextKey delivers the next key once, null on Escape, and does not leak', () => {
    const { target, input, kinds } = setup();
    const got: (KeyCode | null)[] = [];
    input.setContext('rebind');
    input.captureNextKey((c) => got.push(c));
    target.down('Space');
    target.tap('KeyG');
    expect(got).toEqual(['Space']);
    input.setContext('menu');
    expect(kinds()).toEqual([]);
    input.captureNextKey((c) => got.push(c));
    target.tap('Escape');
    expect(got).toEqual(['Space', null]);
  });

  it('a new capture cancels the previous one; dispose cancels and unhooks', () => {
    const { target, input } = setup();
    const got: (KeyCode | null)[] = [];
    input.captureNextKey((c) => got.push(`a:${String(c)}`));
    input.captureNextKey((c) => got.push(`b:${String(c)}`));
    expect(got).toEqual(['a:null']);
    input.dispose();
    input.dispose();
    expect(got).toEqual(['a:null', 'b:null']);
    expect(target.listenerCount('keydown')).toBe(0);
    expect(input.device.heldCodes.size).toBe(0);
  });

  it('setBindings updates sampling, menus and preventDefault', () => {
    const { target, input, kinds } = setup();
    const next = {
      players: [{ ...DEFAULT_BINDINGS.players[0], fire: ['KeyH'] }, DEFAULT_BINDINGS.players[1]] as const,
      pause: DEFAULT_BINDINGS.pause,
    };
    input.setBindings(next);
    expect(target.down('KeyH')).toBe(true);
    expect(target.down('KeyF')).toBe(false);
    expect(kinds()).toEqual(['0:confirm']);
  });
});

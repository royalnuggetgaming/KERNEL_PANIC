import { describe, expect, it } from 'vitest';
import type { MenuIntent } from '../../src/contracts/input';
import { DEFAULT_BINDINGS, MENU_REPEAT } from '../../src/config/keys';
import { createKeyboardDevice } from '../../src/input/KeyboardDevice';
import { createMenuNavigator } from '../../src/input/MenuNavigator';
import { FakeKeyTarget } from '../helpers/fakeKeyboard';

function setup() {
  const target = new FakeKeyTarget();
  const device = createKeyboardDevice(target);
  const nav = createMenuNavigator(device, DEFAULT_BINDINGS);
  const buf: MenuIntent[] = new Array<MenuIntent>(16);
  const poll = (dt = 10): string[] => {
    const n = nav.poll(dt, buf);
    const out: string[] = [];
    for (let i = 0; i < n; i++) out.push(`${String(buf[i]!.player)}:${buf[i]!.kind}`);
    return out;
  };
  return { target, device, nav, poll, buf };
}

/** Times (ms after the press) at which `label` was emitted over `totalMs` of 10 ms frames. */
function emitTimes(poll: (dt?: number) => string[], label: string, totalMs: number): number[] {
  const times: number[] = [];
  for (let t = 10; t <= totalMs; t += 10) if (poll(10).includes(label)) times.push(t);
  return times;
}

describe('MenuNavigator', () => {
  it('maps player keys and shared keys in menu context', () => {
    const { target, poll } = setup();
    target.tap('KeyW');
    target.tap('Space');
    target.tap('ShiftLeft');
    target.tap('KeyE');
    target.tap('ArrowRight');
    target.tap('Period');
    target.tap('Enter');
    target.tap('Backspace');
    target.tap('Escape');
    target.tap('KeyP');
    expect(poll()).toEqual([
      '0:up',
      '0:confirm',
      '0:back',
      '0:ready',
      '1:right',
      '1:confirm',
      'any:confirm',
      'any:back',
      'any:pause',
    ]);
    expect(poll()).toEqual([]);
  });

  it('NumpadEnter is both a shared confirm and P2 ready', () => {
    const { target, poll } = setup();
    target.tap('NumpadEnter');
    expect(poll()).toEqual(['1:ready', 'any:confirm']);
  });

  it('repeats after 350 ms then every 90 ms, OS repeat ignored', () => {
    const { target, poll } = setup();
    target.down('KeyS');
    expect(poll(10)).toEqual(['0:down']);
    target.repeat('KeyS');
    target.repeat('KeyS');
    const times = emitTimes(poll, '0:down', 700);
    expect(times).toEqual([
      MENU_REPEAT.delayMs,
      MENU_REPEAT.delayMs + 90,
      MENU_REPEAT.delayMs + 180,
      MENU_REPEAT.delayMs + 270,
    ]);
    target.up('KeyS');
    expect(emitTimes(poll, '0:down', 500)).toEqual([]);
  });

  it('repeats per player independently', () => {
    const { target, poll } = setup();
    target.down('KeyS');
    poll(10);
    for (let t = 0; t < 200; t += 10) poll(10);
    target.down('ArrowUp');
    const p0: number[] = [];
    const p1: number[] = [];
    for (let t = 0; t <= 600; t += 10) {
      const got = poll(10);
      if (got.includes('0:down')) p0.push(t);
      if (got.includes('1:up')) p1.push(t);
    }
    expect(p1[0]).toBe(0);
    expect(p1[1]).toBe(350);
    expect(p0[0]).toBe(140);
    expect(p0[1]).toBe(230);
    expect(p1[2]! - p1[1]!).toBe(90);
  });

  it('confirm and back never repeat', () => {
    const { target, poll } = setup();
    target.down('Enter');
    expect(poll()).toEqual(['any:confirm']);
    expect(emitTimes(poll, 'any:confirm', 1000)).toEqual([]);
  });

  it('a long frame repeats once, not in a burst', () => {
    const { target, poll } = setup();
    target.down('KeyA');
    poll(10);
    expect(poll(2000)).toEqual(['0:left']);
    expect(poll(10)).toEqual([]);
    expect(emitTimes(poll, '0:left', 90)).toEqual([80]);
  });

  it('gameplay context produces only pause, rebind produces nothing', () => {
    const { target, nav, poll } = setup();
    nav.setContext('gameplay');
    target.tap('KeyW');
    target.tap('Enter');
    target.tap('Escape');
    target.tap('KeyP');
    expect(poll()).toEqual(['any:pause']);
    nav.setContext('rebind');
    target.tap('Escape');
    expect(poll()).toEqual([]);
    nav.setContext('menu');
    expect(poll()).toEqual([]);
  });

  it('context switches and clearEdges drop pending edges and stop repeats', () => {
    const { target, nav, poll } = setup();
    target.tap('Space');
    nav.setContext('gameplay');
    nav.setContext('menu');
    expect(poll()).toEqual([]);
    target.down('KeyW');
    poll();
    nav.clearEdges();
    expect(emitTimes(poll, '0:up', 600)).toEqual([]);
  });

  it('suppressed held keys do not repeat', () => {
    const { target, device, poll } = setup();
    target.down('KeyD');
    poll();
    device.suppressHeldUntilRelease();
    expect(emitTimes(poll, '0:right', 600)).toEqual([]);
  });

  it('writes at most out.length intents and tolerates bad dt', () => {
    const { target, nav } = setup();
    target.tap('KeyW');
    target.tap('KeyS');
    target.tap('KeyA');
    const small: MenuIntent[] = new Array<MenuIntent>(2);
    expect(nav.poll(Number.NaN, small)).toBe(2);
    expect(small[0]!.kind).toBe('up');
    expect(nav.poll(-5, small)).toBe(0);
  });

  it('setBindings rebuilds the mapping', () => {
    const { target, nav, poll } = setup();
    nav.setBindings({
      players: [{ ...DEFAULT_BINDINGS.players[0], up: ['KeyI'] }, DEFAULT_BINDINGS.players[1]],
      pause: ['KeyP'],
    });
    target.tap('KeyW');
    target.tap('KeyI');
    expect(poll()).toEqual(['0:up']);
  });
});

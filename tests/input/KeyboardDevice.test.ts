import { describe, expect, it } from 'vitest';
import { createKeyboardDevice, SLOT_COUNT } from '../../src/input/KeyboardDevice';
import { KNOWN_CODES } from '../../src/config/keys';
import { FakeKeyTarget } from '../helpers/fakeKeyboard';

function setup(bound: readonly string[] = ['KeyW', 'KeyD', 'Space']) {
  const target = new FakeKeyTarget();
  const device = createKeyboardDevice(target);
  device.setBoundCodes(new Set(bound));
  const slot = (code: string): number => device.slotOf(code);
  return { target, device, slot };
}

describe('KeyboardDevice', () => {
  it('registers capture listeners and removes them on dispose', () => {
    const { target, device } = setup();
    expect(target.listenerCount('keydown')).toBe(1);
    expect(target.listenerCount('keyup')).toBe(1);
    device.dispose();
    device.dispose();
    expect(target.listenerCount('keydown')).toBe(0);
    expect(target.listenerCount('keyup')).toBe(0);
  });

  it('maps every known code to a slot and ignores unknown codes', () => {
    const { target, device } = setup();
    expect(SLOT_COUNT).toBe(KNOWN_CODES.length);
    for (const code of KNOWN_CODES) expect(device.slotOf(code)).toBeGreaterThanOrEqual(0);
    expect(device.slotOf('F13')).toBe(-1);
    expect(target.down('F13')).toBe(false);
    expect(device.heldCodes.size).toBe(0);
    expect(device.isDown(-1)).toBe(false);
    expect(device.pressCount(-1)).toBe(0);
    expect(device.lastPressSeq(SLOT_COUNT)).toBe(0);
    target.up('F13');
  });

  it('records presses, sequence numbers and releases', () => {
    const { target, device, slot } = setup();
    target.down('KeyW');
    target.down('KeyD');
    expect(device.isDown(slot('KeyW'))).toBe(true);
    expect(device.pressCount(slot('KeyW'))).toBe(1);
    expect(device.lastPressSeq(slot('KeyD'))).toBeGreaterThan(device.lastPressSeq(slot('KeyW')));
    expect([...device.heldCodes].sort()).toEqual(['KeyD', 'KeyW']);
    target.up('KeyW');
    expect(device.isDown(slot('KeyW'))).toBe(false);
    expect(device.heldCodes.has('KeyW')).toBe(false);
    target.tap('KeyW');
    expect(device.pressCount(slot('KeyW'))).toBe(2);
    expect(device.isDown(slot('KeyW'))).toBe(false);
  });

  it('e.repeat creates no edge and isComposing is ignored', () => {
    const { target, device, slot } = setup();
    target.down('KeyW');
    target.repeat('KeyW');
    target.repeat('KeyW');
    expect(device.pressCount(slot('KeyW'))).toBe(1);
    target.down('KeyD', { isComposing: true });
    expect(device.isDown(slot('KeyD'))).toBe(false);
    expect(device.pressCount(slot('KeyD'))).toBe(0);
  });

  it('metaKey and ctrlKey events are neither recorded nor prevented', () => {
    const { target, device, slot } = setup();
    expect(target.down('KeyW', { metaKey: true })).toBe(false);
    expect(target.down('Space', { ctrlKey: true })).toBe(false);
    expect(device.pressCount(slot('KeyW'))).toBe(0);
    expect(device.isDown(slot('Space'))).toBe(false);
    // Keyups under Ctrl still release (never stuck) but are not prevented.
    target.down('KeyD');
    expect(target.up('KeyD', { ctrlKey: true })).toBe(false);
    expect(device.isDown(slot('KeyD'))).toBe(false);
  });

  it('prevents default for bound codes and the extra set (Slash, Space, arrows, Tab, Backspace, Quote)', () => {
    const { target } = setup(['KeyW']);
    expect(target.down('KeyW')).toBe(true);
    expect(target.up('KeyW')).toBe(true);
    for (const code of ['Slash', 'Space', 'ArrowUp', 'Tab', 'Backspace', 'Quote']) {
      expect(target.down(code)).toBe(true);
    }
    expect(target.down('KeyZ')).toBe(false);
    expect(target.repeat('Space')).toBe(true);
  });

  it('setBoundCodes replaces the previous bound set', () => {
    const { target, device } = setup(['KeyZ']);
    expect(target.down('KeyZ')).toBe(true);
    device.setBoundCodes(new Set(['KeyX']));
    target.up('KeyZ');
    expect(target.down('KeyZ')).toBe(false);
    expect(target.down('KeyX')).toBe(true);
  });

  it('Meta held, key released, Meta released: everything released and a re-press is required', () => {
    const { target, device, slot } = setup();
    target.down('KeyW');
    target.down('MetaLeft', { metaKey: true });
    expect(device.metaHeld).toBe(true);
    expect(device.isDown(slot('KeyW'))).toBe(false);
    expect(device.heldCodes.size).toBe(0);
    // Non-modifier keydowns are ignored while Meta is held (even without the metaKey flag).
    target.down('KeyD');
    expect(device.isDown(slot('KeyD'))).toBe(false);
    // Modifiers still register.
    target.down('ShiftLeft');
    expect(device.isDown(slot('ShiftLeft'))).toBe(true);
    target.up('KeyW', { metaKey: true });
    target.up('MetaLeft');
    expect(device.metaHeld).toBe(false);
    expect(device.isDown(slot('ShiftLeft'))).toBe(false);
    // A held key's OS repeat does not revive it: it must be pressed again.
    target.repeat('KeyD');
    expect(device.isDown(slot('KeyD'))).toBe(false);
    const before = device.pressCount(slot('KeyD'));
    target.down('KeyD');
    expect(device.isDown(slot('KeyD'))).toBe(true);
    expect(device.pressCount(slot('KeyD'))).toBe(before + 1);
  });

  it('tracks both Meta keys independently', () => {
    const { target, device } = setup();
    target.down('MetaLeft', { metaKey: true });
    target.down('MetaRight', { metaKey: true });
    target.up('MetaLeft', { metaKey: true });
    expect(device.metaHeld).toBe(true);
    target.up('MetaRight');
    expect(device.metaHeld).toBe(false);
  });

  it('releaseAll (blur, visibility) releases everything and clears a stale Meta', () => {
    const { target, device, slot } = setup();
    target.down('KeyW');
    target.down('Space');
    device.releaseAll();
    expect(device.isDown(slot('KeyW'))).toBe(false);
    expect(device.heldCodes.size).toBe(0);
    target.down('MetaLeft', { metaKey: true });
    device.releaseAll();
    expect(device.metaHeld).toBe(false);
    target.down('KeyD');
    expect(device.isDown(slot('KeyD'))).toBe(true);
  });

  it('a repeat keydown re-asserts a key believed up without an edge', () => {
    const { target, device, slot } = setup();
    target.down('KeyW');
    device.releaseAll();
    target.repeat('KeyW');
    expect(device.isDown(slot('KeyW'))).toBe(true);
    expect(device.pressCount(slot('KeyW'))).toBe(1);
    expect(device.heldCodes.has('KeyW')).toBe(true);
  });

  it('suppressHeldUntilRelease hides held keys until released and pressed again', () => {
    const { target, device, slot } = setup();
    target.down('KeyW');
    device.suppressHeldUntilRelease();
    expect(device.isDown(slot('KeyW'))).toBe(false);
    target.repeat('KeyW');
    expect(device.isDown(slot('KeyW'))).toBe(false);
    expect(device.heldCodes.has('KeyW')).toBe(true);
    target.up('KeyW');
    target.down('KeyW');
    expect(device.isDown(slot('KeyW'))).toBe(true);
    // A key pressed after the suppression is unaffected.
    device.suppressHeldUntilRelease();
    target.down('KeyD');
    expect(device.isDown(slot('KeyD'))).toBe(true);
  });

  it('notifies fresh keydowns except repeats, Ctrl/Meta/Alt; unsubscribe works', () => {
    const { target, device } = setup();
    const got: string[] = [];
    const off = device.onKeyDown((c) => got.push(c));
    target.down('KeyW');
    target.repeat('KeyW');
    target.down('ShiftLeft');
    target.down('AltLeft');
    target.down('F13');
    expect(got).toEqual(['KeyW', 'ShiftLeft']);
    off();
    off();
    target.down('KeyD');
    expect(got).toEqual(['KeyW', 'ShiftLeft']);
  });

  it('pressCount wraps at 16 bits', () => {
    const { target, device, slot } = setup();
    for (let i = 0; i < 65537; i++) target.tap('KeyW');
    expect(device.pressCount(slot('KeyW'))).toBe(1);
  });
});

/**
 * Chromebook keyboards (Lenovo 500e Gen 3): no numpad, a Search key (KeyboardEvent.code 'MetaLeft') where Caps
 * Lock usually is, and a browser-key top row (F1-F10 codes). Defaults must not need a numpad, Search must never
 * leave keys stuck, and Search+key OS shortcuts must pass through (never preventDefault).
 */
import { describe, expect, it } from 'vitest';
import type { PlayerBindings } from '../../src/contracts/input';
import { ACTIONS } from '../../src/contracts/input';
import { P1_DEFAULT_BINDINGS, P2_DEFAULT_BINDINGS } from '../../src/config/keys';
import { createKeyboardDevice } from '../../src/input/KeyboardDevice';
import { FakeKeyTarget } from '../helpers/fakeKeyboard';

function setup() {
  const target = new FakeKeyTarget();
  const device = createKeyboardDevice(target);
  device.setBoundCodes(new Set(['KeyW', 'KeyD', 'Space', 'ArrowLeft']));
  return { target, device };
}

describe('ChromeOS keyboard', () => {
  it.each([
    ['P1', P1_DEFAULT_BINDINGS],
    ['P2', P2_DEFAULT_BINDINGS],
  ] as const)('%s defaults need no numpad, Search, Alt or top-row key', (_p, b: PlayerBindings) => {
    for (const a of ACTIONS) {
      const usable = b[a].filter((c) => !/^Numpad|^Meta|^Alt|^F\d+$|^CapsLock$/.test(c));
      expect(usable.length, a).toBeGreaterThan(0);
    }
  });

  it('a lone Search tap (Launcher) leaves nothing held and the next press works', () => {
    const { target, device } = setup();
    target.down('MetaLeft', { metaKey: true });
    target.up('MetaLeft');
    expect(device.metaHeld).toBe(false);
    expect(device.heldCodes.size).toBe(0);
    target.down('KeyW');
    expect(device.isDown(device.slotOf('KeyW'))).toBe(true);
    target.up('KeyW');
    expect(device.heldCodes.size).toBe(0);
  });

  it('Search while moving releases movement (no stuck key) and requires a fresh press after', () => {
    const { target, device } = setup();
    target.down('KeyW');
    target.down('MetaLeft', { metaKey: true });
    expect(device.isDown(device.slotOf('KeyW'))).toBe(false);
    target.up('MetaLeft');
    // W is still physically held: it only counts after a fresh press, and its keyup is harmless.
    target.down('KeyW', { repeat: true });
    expect(device.isDown(device.slotOf('KeyW'))).toBe(false);
    target.up('KeyW');
    target.down('KeyW');
    expect(device.isDown(device.slotOf('KeyW'))).toBe(true);
  });

  it('Search+key combos pass through to ChromeOS (not prevented, not recorded)', () => {
    const { target, device } = setup();
    target.down('MetaLeft', { metaKey: true });
    // Search+Left is Home on ChromeOS; Search+Space etc. are OS shortcuts.
    expect(target.down('ArrowLeft', { metaKey: true })).toBe(false);
    expect(target.down('Space', { metaKey: true })).toBe(false);
    expect(device.heldCodes.size).toBe(0);
    target.up('Space', { metaKey: true });
    target.up('ArrowLeft', { metaKey: true });
    target.up('MetaLeft');
    expect(device.heldCodes.size).toBe(0);
  });
});

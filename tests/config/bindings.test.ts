import { describe, expect, it } from 'vitest';
import type { Bindings } from '../../src/contracts/input';
import { findBinding, proposeSwap, resetInvalidActions, validateBindings } from '../../src/config/bindings';
import { DEFAULT_BINDINGS, keyLabel } from '../../src/config/keys';

function withP1(patch: Partial<Bindings['players'][0]>): Bindings {
  return {
    players: [{ ...DEFAULT_BINDINGS.players[0], ...patch }, DEFAULT_BINDINGS.players[1]],
    pause: DEFAULT_BINDINGS.pause,
  };
}

describe('binding validation', () => {
  it('defaults are valid and numpad-free for primaries', () => {
    expect(validateBindings(DEFAULT_BINDINGS)).toEqual([]);
    for (const pb of DEFAULT_BINDINGS.players) {
      for (const codes of Object.values(pb)) expect(codes[0]!.startsWith('Numpad')).toBe(false);
    }
  });

  it('rejects forbidden, reserved, duplicate, empty and unknown codes', () => {
    const kinds = (b: Bindings): string[] => validateBindings(b).map((e) => e.kind);
    expect(kinds(withP1({ fire: ['MetaLeft'] }))).toEqual(['forbidden']);
    expect(kinds(withP1({ fire: ['ControlRight'] }))).toEqual(['forbidden']);
    expect(kinds(withP1({ fire: ['Escape'] }))).toEqual(['reserved']);
    expect(kinds(withP1({ fire: ['KeyP'] }))).toEqual(['reserved']);
    expect(kinds(withP1({ fire: ['ArrowUp'] }))).toEqual(['duplicate']);
    expect(kinds(withP1({ fire: [] }))).toEqual(['empty']);
    expect(kinds(withP1({ fire: ['Bogus'] }))).toEqual(['unknown']);
  });

  it('proposeSwap moves a code and swaps the previous primary', () => {
    const r = proposeSwap(DEFAULT_BINDINGS, 0, 'fire', 'Period');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.swappedWith).toEqual({ player: 1, action: 'fire' });
    expect(r.bindings.players[0].fire[0]).toBe('Period');
    expect(r.bindings.players[1].fire).toContain('Space');
    expect(validateBindings(r.bindings)).toEqual([]);
    const plain = proposeSwap(DEFAULT_BINDINGS, 0, 'fire', 'KeyG');
    expect(plain.ok && plain.swappedWith === null && plain.bindings.players[0].fire[0] === 'KeyG').toBe(true);
    expect(proposeSwap(DEFAULT_BINDINGS, 0, 'fire', 'AltLeft')).toEqual({ ok: false, reason: 'forbidden' });
    expect(proposeSwap(DEFAULT_BINDINGS, 0, 'fire', 'Escape')).toEqual({ ok: false, reason: 'reserved' });
    expect(proposeSwap(DEFAULT_BINDINGS, 0, 'fire', 'Nope')).toEqual({ ok: false, reason: 'unknown' });
    expect(findBinding(DEFAULT_BINDINGS, 'Comma')).toEqual({ player: 1, action: 'special' });
    expect(findBinding(DEFAULT_BINDINGS, 'KeyZ')).toBeNull();
  });

  it('resetInvalidActions repairs only the broken actions', () => {
    const broken = withP1({ fire: ['MetaLeft'], dash: ['KeyG'] });
    const fixed = resetInvalidActions(broken);
    expect(validateBindings(fixed)).toEqual([]);
    expect(fixed.players[0].fire).toEqual(DEFAULT_BINDINGS.players[0].fire);
    expect(fixed.players[0].dash).toEqual(['KeyG']);
  });

  it('labels keycaps', () => {
    expect(keyLabel('KeyW')).toBe('W');
    expect(keyLabel('Digit3')).toBe('3');
    expect(keyLabel('Numpad8')).toBe('NUM 8');
    expect(keyLabel('Space')).toBe('SPACE');
    expect(keyLabel('ArrowUp')).toBe('↑');
  });
});

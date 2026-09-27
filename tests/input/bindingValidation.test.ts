import { describe, expect, it } from 'vitest';
import type { Bindings, PlayerBindings } from '../../src/contracts/input';
import { proposeSwap, resetInvalidActions, validateBindings } from '../../src/config/bindings';
import { DEFAULT_BINDINGS, FORBIDDEN_CODES } from '../../src/config/keys';

function withPlayer(p: 0 | 1, patch: Partial<PlayerBindings>): Bindings {
  const players: [PlayerBindings, PlayerBindings] = [
    DEFAULT_BINDINGS.players[0],
    DEFAULT_BINDINGS.players[1],
  ];
  players[p] = { ...players[p], ...patch };
  return { players, pause: DEFAULT_BINDINGS.pause };
}

describe('bindingValidation (config/bindings.ts)', () => {
  it('accepts the defaults', () => {
    expect(validateBindings(DEFAULT_BINDINGS)).toEqual([]);
  });

  it('rejects every Control, Meta and Alt code', () => {
    for (const code of FORBIDDEN_CODES) {
      const errors = validateBindings(withPlayer(1, { dash: [code] }));
      expect(errors).toEqual([{ kind: 'forbidden', player: 1, action: 'dash', code }]);
    }
  });

  it('rejects reserved, duplicate, empty and unknown codes and allows Shift', () => {
    expect(validateBindings(withPlayer(0, { special: ['KeyP'] }))[0]?.kind).toBe('reserved');
    expect(validateBindings(withPlayer(1, { special: ['KeyW'] }))[0]).toEqual({
      kind: 'duplicate',
      player: 1,
      action: 'special',
      code: 'KeyW',
    });
    expect(validateBindings(withPlayer(0, { up: [] }))[0]?.kind).toBe('empty');
    expect(validateBindings(withPlayer(0, { up: ['KeyW', 'F13'] }))[0]?.kind).toBe('unknown');
    expect(validateBindings(withPlayer(0, { special: ['ShiftRight'] }))[0]?.kind).toBe('duplicate');
    expect(validateBindings(withPlayer(0, { special: ['KeyE', 'KeyE'] }))[0]?.kind).toBe('duplicate');
  });

  it('swap keeps every action non-empty and the set valid', () => {
    const r = proposeSwap(DEFAULT_BINDINGS, 1, 'up', 'KeyW');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.swappedWith).toEqual({ player: 0, action: 'up' });
    expect(r.bindings.players[1].up[0]).toBe('KeyW');
    expect(r.bindings.players[0].up).toEqual(['ArrowUp']);
    expect(validateBindings(r.bindings)).toEqual([]);
    const same = proposeSwap(DEFAULT_BINDINGS, 0, 'fire', 'KeyF');
    expect(same.ok && same.swappedWith === null && same.bindings.players[0].fire[0] === 'KeyF').toBe(true);
    expect(proposeSwap(DEFAULT_BINDINGS, 0, 'fire', 'MetaRight')).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('resetInvalidActions repairs a save with broken bindings', () => {
    const broken = withPlayer(1, { fire: [], dash: ['ControlLeft'], up: ['KeyW'] });
    const fixed = resetInvalidActions(broken);
    expect(validateBindings(fixed)).toEqual([]);
    expect(fixed.players[1].fire).toEqual(DEFAULT_BINDINGS.players[1].fire);
    expect(fixed.players[1].dash).toEqual(DEFAULT_BINDINGS.players[1].dash);
  });
});

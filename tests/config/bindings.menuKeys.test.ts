/**
 * Shared menu keys (Enter, Backspace) cannot be bound to a player action: the navigator also emits them as
 * 'any' confirm/back intents, so one press would do two things (for example undo AND Pause in the shop).
 * NumpadEnter stays bindable (it is the default P2 SPECIAL). Saved bindings using them are reset on load.
 */
import { describe, expect, it } from 'vitest';
import type { Bindings } from '../../src/contracts/input';
import { proposeSwap, resetInvalidActions, validateBindings } from '../../src/config/bindings';
import { DEFAULT_BINDINGS } from '../../src/config/keys';
import { sanitizeSave } from '../../src/save/sanitize';
import { createTestSaveData } from '../helpers/fakeSave';

function withP1(patch: Partial<Bindings['players'][0]>): Bindings {
  return {
    players: [{ ...DEFAULT_BINDINGS.players[0], ...patch }, DEFAULT_BINDINGS.players[1]],
    pause: DEFAULT_BINDINGS.pause,
  };
}

describe('binding validation: shared menu keys', () => {
  it('proposeSwap refuses Backspace and Enter with reason menu', () => {
    expect(proposeSwap(DEFAULT_BINDINGS, 0, 'dash', 'Backspace')).toEqual({ ok: false, reason: 'menu' });
    expect(proposeSwap(DEFAULT_BINDINGS, 0, 'fire', 'Enter')).toEqual({ ok: false, reason: 'menu' });
    expect(proposeSwap(DEFAULT_BINDINGS, 1, 'special', 'NumpadEnter').ok).toBe(true);
  });

  it('validateBindings reports them and the defaults stay valid', () => {
    expect(validateBindings(DEFAULT_BINDINGS)).toEqual([]);
    expect(validateBindings(withP1({ dash: ['Backspace'] })).map((e) => e.kind)).toEqual(['menu']);
    expect(validateBindings(withP1({ fire: ['KeyJ', 'Enter'] })).map((e) => e.kind)).toEqual(['menu']);
  });

  it('a saved binding set using them is reset to the defaults for that action on load', () => {
    const bad = withP1({ dash: ['Backspace'] });
    expect(resetInvalidActions(bad).players[0].dash).toEqual(DEFAULT_BINDINGS.players[0].dash);
    const loaded = sanitizeSave(createTestSaveData({ bindings: bad })).data;
    expect(loaded.bindings.players[0].dash).toEqual(DEFAULT_BINDINGS.players[0].dash);
    expect(validateBindings(loaded.bindings)).toEqual([]);
  });
});

/**
 * Binding validation shared by input/ (rebinding UI) and save/ (sanitize on load). Pure functions over
 * the frozen Bindings contract.
 */
import { PLAYER_INDICES, type PlayerIndex } from '../contracts/ids';
import { ACTIONS, type Action, type Bindings, type KeyCode, type PlayerBindings } from '../contracts/input';
import { DEFAULT_BINDINGS, FORBIDDEN_CODES, KNOWN_CODES, RESERVED_CODES } from './keys';

export type BindingErrorKind = 'forbidden' | 'reserved' | 'duplicate' | 'empty' | 'unknown';

export interface BindingError {
  readonly kind: BindingErrorKind;
  readonly player: PlayerIndex;
  readonly action: Action;
  readonly code: KeyCode | null;
}

const KNOWN = new Set<KeyCode>(KNOWN_CODES);
const FORBIDDEN = new Set<KeyCode>(FORBIDDEN_CODES);
const RESERVED = new Set<KeyCode>(RESERVED_CODES);

/** Every problem in a binding set (empty array = valid). Duplicates are reported on the second occurrence. */
export function validateBindings(b: Bindings): BindingError[] {
  const errors: BindingError[] = [];
  const seen = new Map<KeyCode, string>();
  for (const player of PLAYER_INDICES) {
    const pb = b.players[player];
    for (const action of ACTIONS) {
      const codes = pb[action];
      if (codes.length === 0) {
        errors.push({ kind: 'empty', player, action, code: null });
        continue;
      }
      for (const code of codes) {
        if (!KNOWN.has(code)) errors.push({ kind: 'unknown', player, action, code });
        else if (FORBIDDEN.has(code)) errors.push({ kind: 'forbidden', player, action, code });
        else if (RESERVED.has(code)) errors.push({ kind: 'reserved', player, action, code });
        else if (seen.has(code)) errors.push({ kind: 'duplicate', player, action, code });
        else seen.set(code, `${String(player)}:${action}`);
      }
    }
  }
  return errors;
}

/** Where a code is currently bound, or null. */
export function findBinding(b: Bindings, code: KeyCode): { player: PlayerIndex; action: Action } | null {
  for (const player of PLAYER_INDICES) {
    for (const action of ACTIONS) {
      if (b.players[player][action].includes(code)) return { player, action };
    }
  }
  return null;
}

function withAction(pb: PlayerBindings, action: Action, codes: readonly KeyCode[]): PlayerBindings {
  return { ...pb, [action]: codes };
}

function withPlayer(b: Bindings, player: PlayerIndex, pb: PlayerBindings): Bindings {
  const players: [PlayerBindings, PlayerBindings] = [b.players[0], b.players[1]];
  players[player] = pb;
  return { players, pause: b.pause };
}

export type RebindResult =
  | {
      readonly ok: true;
      readonly bindings: Bindings;
      readonly swappedWith: { player: PlayerIndex; action: Action } | null;
    }
  | { readonly ok: false; readonly reason: 'forbidden' | 'reserved' | 'unknown' };

/**
 * Makes `code` the primary key of (player, action). If the code is bound elsewhere, it is removed there and
 * that action receives this action's previous primary (a swap) so no action is left empty.
 */
export function proposeSwap(b: Bindings, player: PlayerIndex, action: Action, code: KeyCode): RebindResult {
  if (!KNOWN.has(code)) return { ok: false, reason: 'unknown' };
  if (FORBIDDEN.has(code)) return { ok: false, reason: 'forbidden' };
  if (RESERVED.has(code)) return { ok: false, reason: 'reserved' };
  const current = b.players[player][action];
  const previousPrimary = current[0] ?? null;
  const other = findBinding(b, code);
  let next = b;
  let swappedWith: { player: PlayerIndex; action: Action } | null = null;
  if (other !== null && !(other.player === player && other.action === action)) {
    const otherCodes = next.players[other.player][other.action].filter((c) => c !== code);
    if (previousPrimary !== null && !otherCodes.includes(previousPrimary))
      otherCodes.unshift(previousPrimary);
    next = withPlayer(next, other.player, withAction(next.players[other.player], other.action, otherCodes));
    swappedWith = other;
  }
  const rest = next.players[player][action].filter(
    (c) => c !== code && c !== (swappedWith ? previousPrimary : null),
  );
  next = withPlayer(next, player, withAction(next.players[player], action, [code, ...rest]));
  return { ok: true, bindings: next, swappedWith };
}

/** Resets every action that has an error to its default codes, repeating until the set is valid. */
export function resetInvalidActions(b: Bindings, defaults: Bindings = DEFAULT_BINDINGS): Bindings {
  let next: Bindings = { players: [b.players[0], b.players[1]], pause: defaults.pause };
  for (let pass = 0; pass < 16; pass++) {
    const errors = validateBindings(next);
    if (errors.length === 0) return next;
    for (const e of errors) {
      next = withPlayer(
        next,
        e.player,
        withAction(next.players[e.player], e.action, defaults.players[e.player][e.action]),
      );
    }
  }
  return defaults;
}

/**
 * The frozen transition table (plan section 3). Every (from, to) pair not listed is invalid.
 * 16 numbered edges; edge 13 (Paused pops back to Playing | UpgradesShop) is two entries, so EDGES has 17.
 * Versus change: edge 9 (Playing -> GameOver) accepts outcome 'victory' as well as 'defeat', for the
 * versus match end. Pops carry no payload (StateMachineApi.requestPop()).
 */
import type { RunOutcome } from '../contracts/ids';
import type { Edge, StateId, StateLayer } from '../contracts/states';

export const MAX_STACK_DEPTH = 3;
export const MAX_APPLIES_PER_FRAME = 4;

function field(payload: unknown, key: string): unknown {
  if (typeof payload !== 'object' || payload === null) return undefined;
  return (payload as Record<string, unknown>)[key];
}

function outcomeIs(payload: unknown, ...allowed: readonly RunOutcome[]): boolean {
  const o = field(payload, 'outcome');
  return typeof o === 'string' && (allowed as readonly string[]).includes(o);
}

function below(stack: readonly StateId[]): StateId | undefined {
  return stack[stack.length - 2];
}

export const EDGES = [
  /* 1 */ { from: 'Boot', to: 'MainMenu', op: 'replace' },
  /* 2 */ { from: 'MainMenu', to: 'CharacterSelect', op: 'replace' },
  /* 3 */ {
    from: 'MainMenu',
    to: 'UpgradesShop',
    op: 'replace',
    guard: (payload: unknown): boolean => field(payload, 'mode') === 'meta',
  },
  /* 4 */ {
    from: 'UpgradesShop',
    to: 'MainMenu',
    op: 'replace',
    // Meta Hangar is a base state (stack depth 1); a midrun shop always sits on Playing.
    guard: (_payload: unknown, stack: readonly StateId[]): boolean => stack.length === 1,
  },
  /* 5 */ { from: 'CharacterSelect', to: 'MainMenu', op: 'replace' },
  /* 6 */ {
    from: 'CharacterSelect',
    to: 'Playing',
    op: 'replace',
    guard: (payload: unknown): boolean => typeof field(payload, 'config') === 'object',
  },
  /* 7 */ { from: 'Playing', to: 'Paused', op: 'push' },
  /* 8 */ {
    from: 'Playing',
    to: 'UpgradesShop',
    op: 'push',
    guard: (payload: unknown): boolean => field(payload, 'mode') === 'midrun',
  },
  /* 9 */ {
    from: 'Playing',
    to: 'GameOver',
    op: 'replace',
    guard: (payload: unknown): boolean => outcomeIs(payload, 'defeat', 'victory'),
  },
  /* 10 */ {
    from: 'UpgradesShop',
    to: 'Playing',
    op: 'pop',
    guard: (_payload: unknown, stack: readonly StateId[]): boolean => below(stack) === 'Playing',
  },
  /* 11 */ {
    from: 'UpgradesShop',
    to: 'Paused',
    op: 'push',
    guard: (_payload: unknown, stack: readonly StateId[]): boolean => below(stack) === 'Playing',
  },
  /* 12 */ {
    from: 'UpgradesShop',
    to: 'GameOver',
    op: 'replace',
    guard: (payload: unknown, stack: readonly StateId[]): boolean =>
      below(stack) === 'Playing' && outcomeIs(payload, 'victory'),
  },
  /* 13a */ {
    from: 'Paused',
    to: 'Playing',
    op: 'pop',
    guard: (_payload: unknown, stack: readonly StateId[]): boolean => below(stack) === 'Playing',
  },
  /* 13b */ {
    from: 'Paused',
    to: 'UpgradesShop',
    op: 'pop',
    guard: (_payload: unknown, stack: readonly StateId[]): boolean => below(stack) === 'UpgradesShop',
  },
  /* 14 */ {
    from: 'Paused',
    to: 'GameOver',
    op: 'replace',
    guard: (payload: unknown): boolean => outcomeIs(payload, 'abandoned'),
  },
  /* 15 */ { from: 'GameOver', to: 'CharacterSelect', op: 'replace' },
  /* 16 */ { from: 'GameOver', to: 'MainMenu', op: 'replace' },
] as const satisfies readonly Edge[];

/** Informational layer per state (the FSM stacks by edge op). UpgradesShop{meta} enters by replace. */
export const STATE_LAYERS = {
  Boot: 'base',
  MainMenu: 'base',
  CharacterSelect: 'base',
  Playing: 'base',
  UpgradesShop: 'overlay',
  Paused: 'overlay',
  GameOver: 'base',
} as const satisfies Readonly<Record<StateId, StateLayer>>;

export const WORLD_BELOW = {
  Boot: 'none',
  MainMenu: 'none',
  CharacterSelect: 'none',
  Playing: 'none',
  UpgradesShop: 'frozen',
  Paused: 'frozen',
  GameOver: 'none',
} as const satisfies Readonly<Record<StateId, 'frozen' | 'none'>>;

/** The edge from -> to, or null when the pair is not in the table. */
export function findEdge(from: StateId, to: StateId): Edge | null {
  for (const e of EDGES as readonly Edge[]) if (e.from === from && e.to === to) return e;
  return null;
}

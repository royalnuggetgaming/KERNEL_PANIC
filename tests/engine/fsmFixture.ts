/** Shared setup for the StateMachine tests: spy states, an input-hook recorder and stack builders. */
import type { Edge, StateId, StatePayloads } from '../../src/contracts/states';
import { createMemoryLogger, type MemoryLogger } from '../../src/core/logger';
import { createStateMachine, type StateMachine } from '../../src/engine/StateMachine';
import { testRunConfig } from '../helpers/fakeRun';
import { createSpyStates, type SpyStateSet } from '../helpers/fakeStates';

export interface InputHookSpy {
  clearEdges: number;
  suppress: number;
  order: string[];
  clearEdgesFn(): void;
  suppressHeldUntilRelease(): void;
}

export function createInputSpy(): InputHookSpy {
  const spy: InputHookSpy = {
    clearEdges: 0,
    suppress: 0,
    order: [],
    clearEdgesFn() {
      spy.clearEdges++;
      spy.order.push('clearEdges');
    },
    suppressHeldUntilRelease() {
      spy.suppress++;
      spy.order.push('suppress');
    },
  };
  return spy;
}

export interface Rig {
  readonly fsm: StateMachine;
  readonly spies: SpyStateSet;
  readonly log: string[];
  readonly input: InputHookSpy;
  readonly logger: MemoryLogger;
}

export function createRig(opts: { strict?: boolean; edges?: readonly Edge[] } = {}): Rig {
  const log: string[] = [];
  const spies = createSpyStates(log);
  const input = createInputSpy();
  const logger = createMemoryLogger();
  const fsm = createStateMachine({
    states: spies,
    input: {
      clearEdges: () => {
        input.clearEdgesFn();
      },
      suppressHeldUntilRelease: () => {
        input.suppressHeldUntilRelease();
      },
    },
    log: logger,
    strict: opts.strict ?? true,
    ...(opts.edges !== undefined ? { edges: opts.edges } : {}),
  });
  return { fsm, spies, log, input, logger };
}

/** Untyped request helper for table-driven tests. */
export function req(fsm: StateMachine, to: StateId, payload: unknown): boolean {
  return fsm.request(to, payload as StatePayloads[StateId]);
}

/** A payload that satisfies the edge guard for (from, to) when one exists. */
export function validPayload(from: StateId, to: StateId): unknown {
  switch (to) {
    case 'Boot':
    case 'MainMenu':
      return undefined;
    case 'CharacterSelect':
      return { prefill: null, mode: null };
    case 'Playing':
      return { config: testRunConfig() };
    case 'UpgradesShop':
      return { mode: from === 'MainMenu' ? 'meta' : 'midrun' };
    case 'Paused':
      return { reason: 'user' };
    case 'GameOver':
      return { outcome: from === 'Paused' ? 'abandoned' : from === 'UpgradesShop' ? 'victory' : 'defeat' };
  }
}

/** One step of a scripted walk: a replace/push request, or 'pop'. */
export type Step = StateId | 'pop';

/** Requests and applies each step (one per frame), asserting nothing; returns the rig's fsm stack. */
export function walk(fsm: StateMachine, steps: readonly Step[]): readonly StateId[] {
  for (const s of steps) {
    const from = fsm.top;
    if (s === 'pop') fsm.requestPop();
    else req(fsm, s, validPayload(from, s));
    fsm.applyPending();
  }
  return fsm.stack;
}

/** Walks that build every distinct stack shape, keyed by a label. Each starts from a fresh started rig. */
export const STACK_WALKS: Readonly<Record<string, readonly Step[]>> = {
  Boot: [],
  MainMenu: ['MainMenu'],
  CharacterSelect: ['MainMenu', 'CharacterSelect'],
  Playing: ['MainMenu', 'CharacterSelect', 'Playing'],
  'UpgradesShop{meta}': ['MainMenu', 'UpgradesShop'],
  'UpgradesShop{midrun}': ['MainMenu', 'CharacterSelect', 'Playing', 'UpgradesShop'],
  'Paused/Playing': ['MainMenu', 'CharacterSelect', 'Playing', 'Paused'],
  'Paused/Shop': ['MainMenu', 'CharacterSelect', 'Playing', 'UpgradesShop', 'Paused'],
  GameOver: ['MainMenu', 'CharacterSelect', 'Playing', 'GameOver'],
};

export function rigAt(label: string, opts: { strict?: boolean } = {}): Rig {
  const rig = createRig(opts);
  rig.fsm.start();
  walk(rig.fsm, STACK_WALKS[label] ?? []);
  rig.log.length = 0;
  rig.input.clearEdges = 0;
  rig.input.suppress = 0;
  rig.input.order.length = 0;
  rig.logger.clear();
  return rig;
}

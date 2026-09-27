/** SpyState (records lifecycle calls into a shared log) and FakeFsm (records requests) for engine/states tests. */
import type {
  GameState,
  PayloadArg,
  StateId,
  StateLayer,
  StateMachineApi,
  StatePayloads,
} from '../../src/contracts/states';
import { STATE_IDS } from '../../src/contracts/states';
import { STATE_LAYERS, WORLD_BELOW, findEdge } from '../../src/engine/transitions';

export type Hook = () => void;

export interface SpyHooks {
  onEnter?: Hook;
  onExit?: Hook;
  onUpdate?: Hook;
  onFixedUpdate?: Hook;
}

/**
 * Records "<Id>.enter(<from>)", "<Id>.exit(<to>)", "<Id>.onCovered(<by>)", "<Id>.onUncovered(<from>)",
 * "<Id>.fixedUpdate", "<Id>.update", "<Id>.render" into `log`.
 */
export class SpyState<S extends StateId> implements GameState<S> {
  readonly layer: StateLayer;
  readonly worldBelow: 'frozen' | 'none';
  readonly payloads: StatePayloads[S][] = [];
  hooks: SpyHooks = {};

  readonly id: S;
  readonly log: string[];

  constructor(id: S, log: string[]) {
    this.id = id;
    this.log = log;
    this.layer = STATE_LAYERS[id];
    this.worldBelow = WORLD_BELOW[id];
  }

  enter(payload: StatePayloads[S], from: StateId | null): void {
    this.payloads.push(payload);
    this.log.push(`${this.id}.enter(${from ?? 'null'})`);
    this.hooks.onEnter?.();
  }
  exit(to: StateId): void {
    this.log.push(`${this.id}.exit(${to})`);
    this.hooks.onExit?.();
  }
  onCovered(by: StateId): void {
    this.log.push(`${this.id}.onCovered(${by})`);
  }
  onUncovered(from: StateId): void {
    this.log.push(`${this.id}.onUncovered(${from})`);
  }
  fixedUpdate(_dt: number): void {
    this.log.push(`${this.id}.fixedUpdate`);
    this.hooks.onFixedUpdate?.();
  }
  update(_frameDt: number): void {
    this.log.push(`${this.id}.update`);
    this.hooks.onUpdate?.();
  }
  render(_alpha: number, _frameDt: number): void {
    this.log.push(`${this.id}.render`);
  }
}

export type SpyStateSet = { readonly [S in StateId]: SpyState<S> };

/** One SpyState per StateId sharing one log. */
export function createSpyStates(log: string[] = []): SpyStateSet {
  const out: Partial<Record<StateId, SpyState<StateId>>> = {};
  for (const id of STATE_IDS) out[id] = new SpyState(id, log);
  return out as SpyStateSet;
}

export interface FsmRequest {
  readonly to: StateId | 'pop';
  readonly payload: unknown;
}

/**
 * Records requests without applying them. `stack` is set by the test. request() validates statically against
 * EDGES (like the real FSM) and returns false for invalid pairs.
 */
export class FakeFsm implements StateMachineApi {
  stack: StateId[] = ['Boot'];
  readonly requests: FsmRequest[] = [];

  get top(): StateId {
    return this.stack[this.stack.length - 1] ?? 'Boot';
  }

  request<S extends StateId>(to: S, ...payload: PayloadArg<S>): boolean {
    const p: unknown = payload[0];
    const e = findEdge(this.top, to);
    if (e === null || e.op === 'pop' || (e.guard !== undefined && !e.guard(p, this.stack))) return false;
    this.requests.push({ to, payload: p });
    return true;
  }

  requestPop(): boolean {
    const below = this.stack[this.stack.length - 2];
    if (below === undefined) return false;
    const e = findEdge(this.top, below);
    if (e?.op !== 'pop' || (e.guard !== undefined && !e.guard(undefined, this.stack))) return false;
    this.requests.push({ to: 'pop', payload: undefined });
    return true;
  }

  lastRequest(): FsmRequest | undefined {
    return this.requests[this.requests.length - 1];
  }
}

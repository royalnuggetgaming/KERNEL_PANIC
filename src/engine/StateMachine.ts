/**
 * Strict pushdown FSM (plan section 3). Requests are validated statically against the live top when made,
 * queued FIFO, and applied at the start of the next frame (GameLoop -> applyPending) after re-validation
 * against the stack as it stands at apply time. At most MAX_APPLIES_PER_FRAME transitions per frame; requests
 * made inside enter/exit/onCovered/onUncovered are deferred to the next frame.
 */
import type { Logger } from '../contracts/ids';
import type {
  Edge,
  GameState,
  PayloadArg,
  StateId,
  StateMachineApi,
  StatePayloads,
} from '../contracts/states';
import { EDGES, MAX_APPLIES_PER_FRAME, MAX_STACK_DEPTH } from './transitions';

export class InvalidTransitionError extends Error {
  readonly from: StateId;
  readonly to: StateId | 'pop';

  constructor(from: StateId, to: StateId | 'pop', reason: string) {
    super(`Invalid transition ${from} -> ${to}: ${reason}`);
    this.name = 'InvalidTransitionError';
    this.from = from;
    this.to = to;
  }
}

export type StateRegistry = { readonly [S in StateId]: GameState<S> };

export interface InputEdgeHooks {
  clearEdges(): void;
  suppressHeldUntilRelease(): void;
}

export interface StateMachineDeps {
  readonly states: StateRegistry;
  readonly input: InputEdgeHooks;
  readonly log: Logger;
  /** Throw InvalidTransitionError instead of log-and-drop. */
  readonly strict: boolean;
  /** Defaults to EDGES from engine/transitions.ts. */
  readonly edges?: readonly Edge[];
}

export interface StateMachine extends StateMachineApi {
  /** Enters Boot (from = null). Call once. */
  start(): void;
  /** Applies up to MAX_APPLIES_PER_FRAME queued requests, re-validated against the live stack; returns count. */
  applyPending(): number;
  fixedUpdate(dt: number): void; // top state only
  update(frameDt: number): void; // top state only
  render(alpha: number, frameDt: number): void; // top state if it is not an overlay with worldBelow 'frozen'
  readonly pendingCount: number;
}

/** One queued request. `to === null` marks a pop. Slots are reused (no per-request allocation). */
interface PendingSlot {
  to: StateId | null;
  payload: unknown;
}

const R_NO_EDGE = 'no edge in the transition table';
const R_WRONG_OP_POP = 'edge is a pop: use requestPop()';
const R_NOT_POP = 'edge is not a pop';
const R_GUARD = 'guard rejected the payload/stack';
const R_DEPTH = 'stack depth limit reached';
const R_NOTHING_BELOW = 'nothing below the top state to pop to';

function findIn(edges: readonly Edge[], from: StateId, to: StateId): Edge | null {
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]!;
    if (e.from === from && e.to === to) return e;
  }
  return null;
}

class PushdownStateMachine implements StateMachine {
  private readonly states: StateRegistry;
  private readonly input: InputEdgeHooks;
  private readonly log: Logger;
  private readonly strict: boolean;
  private readonly edges: readonly Edge[];

  private readonly ids: StateId[] = [];
  private readonly slots: PendingSlot[] = [];
  private queued = 0;
  private started = false;
  private applying = false;

  constructor(deps: StateMachineDeps) {
    this.states = deps.states;
    this.input = deps.input;
    this.log = deps.log;
    this.strict = deps.strict;
    this.edges = deps.edges ?? EDGES;
  }

  get top(): StateId {
    return this.ids[this.ids.length - 1] ?? 'Boot';
  }

  get stack(): readonly StateId[] {
    return this.ids;
  }

  get pendingCount(): number {
    return this.queued;
  }

  start(): void {
    if (this.started) throw new Error('StateMachine.start() called twice');
    this.started = true;
    this.applying = true;
    try {
      this.ids.push('Boot');
      this.stateOf('Boot').enter(undefined, null);
    } finally {
      this.applying = false;
    }
  }

  request<S extends StateId>(to: S, ...payload: PayloadArg<S>): boolean {
    const p: unknown = payload[0];
    const reason = this.checkForward(to, p);
    if (reason !== null) return this.reject(to, reason);
    this.enqueue(to, p);
    return true;
  }

  requestPop(): boolean {
    const reason = this.checkPop();
    if (reason !== null) return this.reject('pop', reason);
    this.enqueue(null, undefined);
    return true;
  }

  applyPending(): number {
    if (this.applying) throw new Error('StateMachine.applyPending() re-entered from a lifecycle hook');
    if (!this.started || this.queued === 0) return 0;
    // Only requests queued before this call are considered; those made inside hooks wait for the next frame.
    const snapshot = this.queued;
    let processed = 0;
    let applied = 0;
    this.applying = true;
    try {
      while (processed < snapshot && applied < MAX_APPLIES_PER_FRAME) {
        const slot = this.slots[processed]!;
        processed++;
        const to = slot.to;
        const payload = slot.payload;
        slot.payload = undefined;
        if (this.applyOne(to, payload)) applied++;
      }
    } finally {
      this.applying = false;
      this.compact(processed);
    }
    return applied;
  }

  fixedUpdate(dt: number): void {
    const top = this.topState();
    if (top?.fixedUpdate !== undefined) top.fixedUpdate(dt);
  }

  update(frameDt: number): void {
    const top = this.topState();
    if (top !== null) top.update(frameDt);
  }

  render(alpha: number, frameDt: number): void {
    const top = this.topState();
    if (top === null) return;
    // An overlay stacked on a live base freezes the world below (the base rendered one frozen frame on
    // onCovered). A depth-1 state (e.g. the meta Hangar entered by replace) always renders itself.
    if (this.ids.length > 1 && top.worldBelow === 'frozen') return;
    if (top.render !== undefined) top.render(alpha, frameDt);
  }

  // ---- internals -------------------------------------------------------------------------------------

  private stateOf(id: StateId): GameState {
    return this.states[id];
  }

  private topState(): GameState | null {
    const id = this.ids[this.ids.length - 1];
    return id === undefined ? null : this.stateOf(id);
  }

  /** Validates a replace/push request against the live stack; returns a reason or null. */
  private checkForward(to: StateId, payload: unknown): string | null {
    const e = findIn(this.edges, this.top, to);
    if (e === null) return R_NO_EDGE;
    if (e.op === 'pop') return R_WRONG_OP_POP;
    if (e.op === 'push' && this.ids.length >= MAX_STACK_DEPTH) return R_DEPTH;
    if (e.guard !== undefined && !e.guard(payload, this.ids)) return R_GUARD;
    return null;
  }

  /** Validates a pop against the live stack; returns a reason or null. */
  private checkPop(): string | null {
    const below = this.ids[this.ids.length - 2];
    if (below === undefined) return R_NOTHING_BELOW;
    const e = findIn(this.edges, this.top, below);
    if (e === null) return R_NO_EDGE;
    if (e.op !== 'pop') return R_NOT_POP;
    if (e.guard !== undefined && !e.guard(undefined, this.ids)) return R_GUARD;
    return null;
  }

  private reject(to: StateId | 'pop', reason: string): false {
    if (this.strict) throw new InvalidTransitionError(this.top, to, reason);
    this.log.error('fsm: invalid transition dropped', { from: this.top, to, reason });
    return false;
  }

  private enqueue(to: StateId | null, payload: unknown): void {
    let slot = this.slots[this.queued];
    if (slot === undefined) {
      slot = { to: null, payload: undefined };
      this.slots.push(slot);
    }
    slot.to = to;
    slot.payload = payload;
    this.queued++;
  }

  /** Drops the first `n` slots, moving the rest to the front (slot objects are recycled). */
  private compact(n: number): void {
    if (n === 0) return;
    const remaining = this.queued - n;
    for (let i = 0; i < remaining; i++) {
      const dst = this.slots[i]!;
      const src = this.slots[i + n]!;
      dst.to = src.to;
      dst.payload = src.payload;
      src.payload = undefined;
    }
    this.queued = remaining;
  }

  /** Re-validates and applies one queued request. Returns true when a transition was applied. */
  private applyOne(to: StateId | null, payload: unknown): boolean {
    const from = this.top;
    const reason = to === null ? this.checkPop() : this.checkForward(to, payload);
    if (reason !== null) {
      // Stale requests (e.g. a blur Pause queued before GameOver was applied) are dropped, never thrown.
      const msg = 'fsm: stale transition dropped';
      const data = { from, to: to ?? 'pop', reason };
      if (this.strict) this.log.warn(msg, data);
      else this.log.debug(msg, data);
      return false;
    }
    if (to === null) {
      this.applyPop(from);
    } else {
      const edge = findIn(this.edges, from, to)!;
      if (edge.op === 'push') this.applyPush(from, to, payload);
      else this.applyReplace(from, to, payload);
    }
    this.input.clearEdges();
    this.input.suppressHeldUntilRelease();
    return true;
  }

  private applyReplace(from: StateId, to: StateId, payload: unknown): void {
    for (let i = this.ids.length - 1; i >= 0; i--) this.stateOf(this.ids[i]!).exit(to);
    this.ids.length = 0;
    this.ids.push(to);
    this.stateOf(to).enter(payload as StatePayloads[StateId], from);
  }

  private applyPush(from: StateId, to: StateId, payload: unknown): void {
    const below = this.stateOf(from);
    if (below.onCovered !== undefined) below.onCovered(to);
    this.ids.push(to);
    this.stateOf(to).enter(payload as StatePayloads[StateId], from);
  }

  private applyPop(from: StateId): void {
    const to = this.ids[this.ids.length - 2]!;
    this.stateOf(from).exit(to);
    this.ids.pop();
    const below = this.stateOf(to);
    if (below.onUncovered !== undefined) below.onUncovered(from);
  }
}

export function createStateMachine(deps: StateMachineDeps): StateMachine {
  return new PushdownStateMachine(deps);
}

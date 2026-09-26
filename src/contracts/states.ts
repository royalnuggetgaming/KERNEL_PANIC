/**
 * Global pushdown state machine contracts. FROZEN after Wave 0.
 */
import type { LoadoutPick, RunMode, RunOutcome } from './ids';
import type { RunConfig } from './run';

export const STATE_IDS = [
  'Boot',
  'MainMenu',
  'CharacterSelect',
  'Playing',
  'UpgradesShop',
  'Paused',
  'GameOver',
] as const;
export type StateId = (typeof STATE_IDS)[number];

export type PauseReason = 'user' | 'blur' | 'hidden' | 'fullscreen' | 'contextlost';

export interface StatePayloads {
  Boot: undefined;
  MainMenu: undefined;
  CharacterSelect: { readonly prefill: readonly LoadoutPick[] | null; readonly mode: RunMode | null };
  Playing: { readonly config: RunConfig };
  UpgradesShop: { readonly mode: 'midrun' } | { readonly mode: 'meta' };
  Paused: { readonly reason: PauseReason };
  GameOver: { readonly outcome: RunOutcome };
}

export type PayloadArg<S extends StateId> = StatePayloads[S] extends undefined ? [] : [StatePayloads[S]];

export type StackOp = 'replace' | 'push' | 'pop';

export interface Edge {
  readonly from: StateId;
  readonly to: StateId;
  readonly op: StackOp;
  /** payload: the request payload (undefined for pops/no-payload states); stack: bottom..top BEFORE applying. */
  readonly guard?: (payload: unknown, stack: readonly StateId[]) => boolean;
}

export type StateLayer = 'base' | 'overlay';

export interface GameState<S extends StateId = StateId> {
  readonly id: S;
  readonly layer: StateLayer;
  /** Overlays declare 'frozen': the base renders one frozen frame on onCovered, then stops rendering. */
  readonly worldBelow: 'frozen' | 'none';
  /** Sync; async work is started here and polled in update(). */
  enter(payload: StatePayloads[S], from: StateId | null): void;
  exit(to: StateId): void;
  onCovered?(by: StateId): void;
  onUncovered?(from: StateId): void;
  /** Top of stack only, fixed 1/120 s. */
  fixedUpdate?(dt: number): void;
  /** Top of stack only. */
  update(frameDt: number): void;
  /** Topmost state whose world is live. */
  render?(alpha: number, frameDt: number): void;
}

/** What states see of the FSM (engine/StateMachine.ts implements a superset). */
export interface StateMachineApi {
  /**
   * Replace/push request. Enqueues; returns false (and enqueues nothing) when no replace/push edge
   * (top -> to) exists or its guard rejects the payload against the current stack.
   */
  request<S extends StateId>(to: S, ...payload: PayloadArg<S>): boolean;
  /**
   * Pop request: pops the top overlay back to the state directly below it (no payload; the state below gets
   * onUncovered). Returns false when no pop edge (top -> below) exists.
   */
  requestPop(): boolean;
  readonly top: StateId;
  readonly stack: readonly StateId[];
}

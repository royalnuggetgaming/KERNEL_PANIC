/**
 * Dependency-injection root seen by states. Built by app/createServices.ts (Wave 3); faked in
 * tests/helpers/fakePorts.ts. FROZEN after Wave 0.
 */
import type { LoadoutPick, Logger, RunMode } from './ids';
import type { InputPort } from './input';
import type { AudioPort } from './audio';
import type { AssetLoaderPort, RenderPort } from './render';
import type { RunConfig, RunSessionApi } from './run';
import type { SaveStorePort } from './save';
import type { StateMachineApi } from './states';
import type { ThemeDef } from './theme';
import type { UiPort } from './ui';

export interface LoopControl {
  /** Drops the accumulated fixed-step backlog (called on resume so no catch-up burst follows). */
  resetAccumulator(): void;
  /** Multiplies the accumulator input (never dt): 0.35 slow-mo, 0.25 GameOver push-in. */
  setTimeScale(s: number): void;
  readonly timeScale: number;
  readonly simTick: number;
}

/** rAF-like scheduler injected into engine/GameLoop.ts (fake in tests/helpers/fakeClock.ts). */
export interface FrameScheduler {
  request(cb: (timestampMs: number) => void): number;
  cancel(id: number): void;
}

export interface ClockPort {
  /** Monotonic milliseconds. */
  now(): number;
}

export interface SessionStore {
  current: RunSessionApi | null;
  /** Last picks and mode, used by GameOver Retry to prefill CharacterSelect. */
  lastPicks: readonly LoadoutPick[] | null;
  lastMode: RunMode | null;
}

export interface PerfSnapshot {
  readonly avgFps: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly longFrames: number;
  readonly cpuP95: number;
  readonly droppedSteps: number;
}

export interface PerfPort {
  snapshot(): PerfSnapshot;
  /** Governor only evaluates while Playing. */
  setPlaying(on: boolean): void;
}

export interface AppEnv {
  /** ?debug=1 or DEV. */
  readonly debug: boolean;
  /** ?seed=N overrides crypto seeds. */
  readonly seedOverride: number | null;
  /** Throw InvalidTransitionError (DEV/tests) instead of logging and dropping (PROD). */
  readonly strict: boolean;
  readonly version: string;
  /**
   * v4 (additive): whether the running build compiled the LOW_FX (Chromebook) shader variant at Boot. Absent in
   * fixtures; Settings shows RESTART TO APPLY when the saved quality wants the other variant.
   */
  readonly lowFx?: boolean;
}

export interface Services {
  readonly fsm: StateMachineApi;
  readonly input: InputPort;
  readonly audio: AudioPort;
  readonly render: RenderPort;
  readonly ui: UiPort;
  readonly save: SaveStorePort;
  readonly assets: AssetLoaderPort;
  readonly session: SessionStore;
  readonly createRun: (c: RunConfig) => RunSessionApi;
  readonly loop: LoopControl;
  readonly perf: PerfPort;
  readonly theme: () => ThemeDef;
  readonly clock: ClockPort;
  readonly log: Logger;
  readonly env: AppEnv;
  readonly newSeed: () => number;
  readonly newRunId: () => string;
  /**
   * v4 (additive): flushes the save and reloads the page, so a new theme's compile-time shader modes apply
   * (Settings > THEME > RESTART). Only app/createServices touches the browser to do it.
   */
  readonly reloadApp: () => void;
}

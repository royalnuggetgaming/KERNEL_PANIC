/**
 * window.__game (plan section 8), installed only in DEV or with ?debug=1. The app implements DebugHost
 * (debug/ may import only contracts, core, engine/PerfMonitor and three); this module adds the async
 * helpers: frame waits, perf sampling, goto routing, run cycling and the input probe.
 */
import type { AudioStats } from '../contracts/audio';
import type { PlayerIndex, RunMode } from '../contracts/ids';
import type { RenderStats } from '../contracts/render';
import type { StateId } from '../contracts/states';
import type { WorldView } from '../contracts/world';
import type { PerfMonitor } from '../engine/PerfMonitor';
import type { Autopilot } from './Autopilot';

export interface FrameStat {
  readonly frameMs: number;
  readonly cpuMs: number;
  readonly simMs: number;
}

export interface StressSpec {
  readonly enemies?: number;
  readonly shots?: number;
  readonly particles?: number;
}

export interface GotoOptions {
  /** Run mode when the route passes CharacterSelect -> Playing (default solo). */
  readonly mode?: RunMode;
}

/** What the composition root exposes to the dev API. */
export interface DebugHost {
  readonly perf: PerfMonitor;
  readonly autopilot: Autopilot;
  stack(): readonly StateId[];
  pending(): number;
  /** Requests the next hop of the shortest valid FSM route to `target`; false when none exists. */
  stepToward(target: StateId, opts: GotoOptions): boolean;
  onFrame(cb: (s: FrameStat) => void): () => void;
  renderStats(): RenderStats;
  audioStats(): AudioStats;
  audioUnlocked(): boolean;
  governorStep(): number;
  shaderErrors(): readonly string[];
  world(): WorldView | null;
  /** Sustained per-frame top-up of enemies/shots/particles while in Playing; null stops it. */
  stress(spec: StressSpec | null): void;
  setWave(wave: number): boolean;
  /** Forces the current wave (or versus round) to end. */
  clearWave(): boolean;
  giveShards(p: PlayerIndex, n: number): boolean;
  godMode(on: boolean): void;
  /** Forces (true) or restores (false) MYTHIC card offers in the Patch Bay. Optional for test doubles. */
  forceMythic?(on: boolean): void;
  setSeed(n: number | null): void;
  /** Synthetic P1 keydown; resolves with the ms until the sim sampled it (-1 when not Playing). */
  probeInput(): Promise<number>;
  heldCodes(): readonly string[];
}

export interface PerfSample {
  readonly frames: number;
  readonly avgFps: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly longFrames: number;
  readonly cpuP95: number;
  readonly simP95: number;
  readonly drawCalls: number;
  readonly drawCallsAvg: number;
  readonly triangles: number;
  readonly programs: number;
  readonly governorStep: number;
}

export interface CycleResult {
  readonly runs: number;
  readonly baseline: { readonly geometries: number; readonly textures: number; readonly programs: number };
  readonly after: { readonly geometries: number; readonly textures: number; readonly programs: number };
  readonly equal: boolean;
}

export interface DevApi {
  state(): { readonly top: StateId; readonly stack: readonly StateId[] };
  goto(target: StateId, opts?: GotoOptions): Promise<boolean>;
  waitFrames(n: number): Promise<void>;
  perf: { sample(ms: number): Promise<PerfSample> };
  stress(spec: StressSpec | null): void;
  autopilot(on: boolean): void;
  cycleRuns(n: number): Promise<CycleResult>;
  inputProbe(): Promise<number>;
  giveShards(p: PlayerIndex, n: number): boolean;
  setWave(w: number): boolean;
  clearWave(): boolean;
  godMode(on: boolean): void;
  /** Every fresh Patch Bay card slot offers the MYTHIC card while on (screenshots/tests). */
  forceMythic(on: boolean): void;
  setSeed(n: number | null): void;
  rendererInfo(): RenderStats;
  audioStats(): AudioStats & { readonly unlocked: boolean };
  shaderErrors(): readonly string[];
  heldKeys(): readonly string[];
  world(): WorldView | null;
}

const LONG_FRAME_MS = 33;
const GOTO_MAX_HOPS = 8;
const HOP_TIMEOUT_FRAMES = 240;

function percentile(sorted: readonly number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const pos = (p / 100) * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(n - 1, lo + 1);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

export function installDevApi(host: DebugHost): DevApi {
  const waitFrames = (n: number): Promise<void> =>
    new Promise((resolve) => {
      let left = Math.max(1, Math.floor(n));
      const off = host.onFrame(() => {
        if (--left > 0) return;
        off();
        resolve();
      });
    });

  const top = (): StateId => {
    const s = host.stack();
    return s[s.length - 1]!;
  };

  const settle = async (): Promise<void> => {
    let guard = HOP_TIMEOUT_FRAMES;
    while (host.pending() > 0 && guard-- > 0) await waitFrames(1);
    await waitFrames(2);
  };

  const goto = async (target: StateId, opts: GotoOptions = {}): Promise<boolean> => {
    await settle();
    for (let hop = 0; hop < GOTO_MAX_HOPS; hop++) {
      if (top() === target) return true;
      const before = host.stack().join('>');
      if (!host.stepToward(target, opts)) return false;
      let guard = HOP_TIMEOUT_FRAMES;
      while (host.stack().join('>') === before && guard-- > 0) await waitFrames(1);
      if (guard <= 0) return false;
      await waitFrames(2);
    }
    return top() === target;
  };

  const sample = (ms: number): Promise<PerfSample> =>
    new Promise((resolve) => {
      const frame: number[] = [];
      const cpu: number[] = [];
      const sim: number[] = [];
      let calls = 0;
      let callsSum = 0;
      let tris = 0;
      let elapsed = 0;
      const off = host.onFrame((s) => {
        const st = host.renderStats();
        if (st.calls > calls) calls = st.calls;
        callsSum += st.calls;
        if (st.triangles > tris) tris = st.triangles;
        if (s.frameMs > 0) {
          frame.push(s.frameMs);
          cpu.push(s.cpuMs);
          sim.push(s.simMs);
          elapsed += s.frameMs;
        }
        if (elapsed < ms) return;
        off();
        const f = frame.slice().sort((a, b) => a - b);
        const c = cpu.slice().sort((a, b) => a - b);
        const m = sim.slice().sort((a, b) => a - b);
        let long = 0;
        for (const x of frame) if (x > LONG_FRAME_MS) long++;
        resolve({
          frames: frame.length,
          avgFps: round2(elapsed > 0 ? (frame.length * 1000) / elapsed : 0),
          p50: round2(percentile(f, 50)),
          p95: round2(percentile(f, 95)),
          p99: round2(percentile(f, 99)),
          longFrames: long,
          cpuP95: round2(percentile(c, 95)),
          simP95: round2(percentile(m, 95)),
          drawCalls: calls,
          drawCallsAvg: round2(frame.length > 0 ? callsSum / frame.length : 0),
          triangles: tris,
          programs: host.renderStats().programs,
          governorStep: host.governorStep(),
        });
      });
    });

  const memory = (): CycleResult['baseline'] => {
    const s = host.renderStats();
    return { geometries: s.geometries, textures: s.textures, programs: s.programs };
  };

  const cycleRuns = async (n: number): Promise<CycleResult> => {
    await goto('MainMenu');
    const baseline = memory();
    const wasOn = host.autopilot.enabled;
    host.autopilot.enabled = true;
    let runs = 0;
    for (let i = 0; i < n; i++) {
      if (!(await goto('Playing', { mode: i % 2 === 0 ? 'solo' : 'coop' }))) break;
      await waitFrames(90);
      if (!(await goto('Paused'))) break;
      if (!(await goto('GameOver'))) break;
      await waitFrames(30);
      if (!(await goto('MainMenu'))) break;
      runs++;
    }
    host.autopilot.enabled = wasOn;
    await waitFrames(10);
    const after = memory();
    return {
      runs,
      baseline,
      after,
      equal:
        runs === n &&
        after.geometries === baseline.geometries &&
        after.textures === baseline.textures &&
        after.programs === baseline.programs,
    };
  };

  return {
    state: () => ({ top: top(), stack: host.stack().slice() }),
    goto,
    waitFrames,
    perf: { sample },
    stress: (spec) => {
      host.stress(spec);
    },
    autopilot: (on) => {
      host.autopilot.enabled = on;
      if (on) host.autopilot.reset();
    },
    cycleRuns,
    inputProbe: () => host.probeInput(),
    giveShards: (p, n) => host.giveShards(p, n),
    setWave: (w) => host.setWave(w),
    clearWave: () => host.clearWave(),
    godMode: (on) => {
      host.godMode(on);
    },
    forceMythic: (on) => {
      host.forceMythic?.(on);
    },
    setSeed: (n) => {
      host.setSeed(n);
    },
    rendererInfo: () => host.renderStats(),
    audioStats: () => ({ ...host.audioStats(), unlocked: host.audioUnlocked() }),
    shaderErrors: () => host.shaderErrors().slice(),
    heldKeys: () => host.heldCodes().slice(),
    world: () => host.world(),
  };
}

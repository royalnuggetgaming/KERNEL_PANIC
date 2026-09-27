/**
 * DebugHost implementation (debug/devApi.ts talks only to this): FSM routing with real payloads, world access
 * through the concrete RunSession, stress/god-mode/autopilot applied through the input tap and the frame
 * hooks, and the keydown-to-sim input probe.
 */
import type { PlayerIndex, RunMode } from '../contracts/ids';
import type { PlayerIntent } from '../contracts/input';
import type { RunConfig } from '../contracts/run';
import type { StateId } from '../contracts/states';
import type { WorldState, WorldView } from '../contracts/world';
import { Autopilot } from '../debug/Autopilot';
import type { DebugHost, FrameStat, GotoOptions, StressSpec } from '../debug/devApi';
import type { AppServices } from './createServices';
import { firstHopToward, type Hop } from './debugRoutes';
import {
  type StressTargets,
  applyGodMode,
  applyStress,
  clearWorldWave,
  giveWorldShards,
  setWorldWave,
} from './debugStress';

const PROBE_TIMEOUT_MS = 1000;
const PROBE_CODE = 'KeyD';

export interface GameDebugHost extends DebugHost {
  /** Game loop: once per frame before the FSM update (stress top-up). */
  beforeUpdate(frameDt: number): void;
  /** Game loop: after each recorded frame. */
  frameDone(s: FrameStat): void;
}

interface Probe {
  t0: number;
  resolve: (ms: number) => void;
  timer: number;
}

export function createDebugHost(
  app: AppServices,
  governorStep: () => number,
  pendingCount: () => number,
): GameDebugHost {
  const s = app.services;
  const autopilot = new Autopilot();
  const frameListeners = new Set<(f: FrameStat) => void>();
  let stress: StressTargets | null = null;
  let god = false;
  let probe: Probe | null = null;

  const liveWorld = (): WorldState | null => {
    const run = app.runs.current;
    if (run === null || s.session.current !== run || run.disposed) return null;
    return run.state;
  };

  const playing = (): boolean => s.fsm.top === 'Playing';

  const configFor = (mode: RunMode): RunConfig => {
    const save = s.save.data;
    const picks =
      mode === 'solo'
        ? [{ player: 0 as const, vehicle: save.unlocks[0] ?? 'lancer' }]
        : [
            { player: 0 as const, vehicle: save.unlocks[0] ?? 'lancer' },
            { player: 1 as const, vehicle: save.unlocks[1] ?? save.unlocks[0] ?? 'lancer' },
          ];
    s.session.lastPicks = picks;
    s.session.lastMode = mode;
    return {
      runId: s.newRunId(),
      seed: s.env.seedOverride ?? s.newSeed(),
      mode,
      players: picks,
      meta: { ...save.meta },
      autofire: [save.settings.autofire[0], save.settings.autofire[1]],
      focusToggle: [save.settings.focusToggle[0], save.settings.focusToggle[1]],
      themeId: s.theme().id,
    };
  };

  const request = (hop: Hop, opts: GotoOptions): boolean => {
    const fsm = s.fsm;
    if (hop.op === 'pop') return fsm.requestPop();
    const p = hop.payload;
    switch (p.kind) {
      case 'none':
        return hop.to === 'MainMenu' ? fsm.request('MainMenu') : false;
      case 'select':
        return fsm.request('CharacterSelect', { prefill: null, mode: null });
      case 'config':
        return fsm.request('Playing', { config: configFor(opts.mode ?? 'solo') });
      case 'shop':
        return fsm.request('UpgradesShop', { mode: p.mode });
      case 'pause':
        return fsm.request('Paused', { reason: 'user' });
      case 'gameOver':
        return fsm.request('GameOver', { outcome: p.outcome });
    }
  };

  const onSample = (p: PlayerIndex, out: PlayerIntent): void => {
    const pr = probe;
    if (pr !== null && p === 0 && out.moveX > 0) {
      probe = null;
      app.platform.window.clearTimeout(pr.timer);
      pr.resolve(s.clock.now() - pr.t0);
      dispatchKey('keyup');
    }
    if (!autopilot.enabled && !god) return;
    const w = liveWorld();
    if (w === null) return;
    if (god && p === 0) applyGodMode(w);
    if (autopilot.enabled && w.players[p].life !== 'absent') autopilot.write(p, w, out);
  };
  app.input.tap = onSample;

  const dispatchKey = (type: 'keydown' | 'keyup'): void => {
    const win = app.platform.window;
    win.dispatchEvent(new KeyboardEvent(type, { code: PROBE_CODE, key: 'd', bubbles: true }));
  };

  return {
    perf: app.perf,
    autopilot,
    stack: () => s.fsm.stack,
    pending: pendingCount,
    stepToward(target: StateId, opts: GotoOptions): boolean {
      const hop = firstHopToward(s.fsm.stack, target);
      if (hop === null) return false;
      return request(hop, opts);
    },
    onFrame(cb) {
      frameListeners.add(cb);
      return () => {
        frameListeners.delete(cb);
      };
    },
    renderStats: () => app.bridge.stats(),
    audioStats: () => app.audio.stats(),
    audioUnlocked: () => app.audio.unlocked,
    governorStep,
    shaderErrors: () => app.shaderLog.errors,
    world: (): WorldView | null => liveWorld(),
    stress(spec: StressSpec | null): void {
      stress =
        spec === null
          ? null
          : { enemies: spec.enemies ?? 0, shots: spec.shots ?? 0, particles: spec.particles ?? 0 };
    },
    setWave(wave: number): boolean {
      const w = liveWorld();
      return w !== null && playing() && setWorldWave(w, wave);
    },
    clearWave(): boolean {
      const w = liveWorld();
      return w !== null && playing() && clearWorldWave(w);
    },
    giveShards(p: PlayerIndex, n: number): boolean {
      const w = liveWorld();
      return w !== null && giveWorldShards(w, p, n);
    },
    godMode(on: boolean): void {
      god = on;
    },
    setSeed(n: number | null): void {
      app.parsed.seed.value = n === null ? null : Math.trunc(Math.abs(n)) >>> 0;
    },
    probeInput(): Promise<number> {
      if (!playing() || probe !== null) return Promise.resolve(-1);
      return new Promise((resolve) => {
        const win = app.platform.window;
        const timer = win.setTimeout(() => {
          if (probe === null) return;
          probe = null;
          dispatchKey('keyup');
          resolve(-1);
        }, PROBE_TIMEOUT_MS);
        probe = { t0: s.clock.now(), resolve, timer };
        dispatchKey('keydown');
      });
    },
    heldCodes: () => [...s.input.heldCodes],
    beforeUpdate(frameDt: number): void {
      if (stress === null || !playing()) return;
      const w = liveWorld();
      if (w !== null) applyStress(w, stress, frameDt);
    },
    frameDone(f: FrameStat): void {
      for (const cb of [...frameListeners]) cb(f);
    },
  };
}

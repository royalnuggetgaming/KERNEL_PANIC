/**
 * The only module that touches browser globals (window, document, localStorage, AudioContext, crypto,
 * performance, requestAnimationFrame, console). createBrowserPlatform() captures them once; createServices()
 * builds every concrete port behind the Services DI root (docs/ARCHITECTURE.md "app/").
 */
import { setConsoleFunction } from 'three';
import type { Logger } from '../contracts/ids';
import type { RunConfig } from '../contracts/run';
import type { Settings, StorageLike } from '../contracts/save';
import type { ClockPort, FrameScheduler, Services, SessionStore } from '../contracts/services';
import { createConsoleLogger } from '../core/logger';
import { DEFAULT_BINDINGS } from '../config/keys';
import {
  CHROMEBOOK_TOAST,
  QUALITY_PRESETS,
  chooseBootQuality,
  effectiveFrameCap,
  type PlatformHints,
} from '../config/quality';
import { getTheme } from '../themes/registry';
import { createAssetLibrary } from '../assets/AssetLibrary';
import { type AudioEngine, createAudioEngine } from '../audio/AudioEngine';
import { type FramePacer, createFramePacer } from '../engine/FramePacer';
import { type PerfMonitor, createPerfMonitor } from '../engine/PerfMonitor';
import { type ResolutionGovernor, createResolutionGovernor } from '../engine/ResolutionGovernor';
import { type InputService, createInputService } from '../input/InputService';
import type { ThreeAssetLibrary } from '../render/assetTypes';
import { type RenderBridge, createRenderBridge } from '../render/RenderBridge';
import { DEFAULT_SETTINGS } from '../save/defaults';
import { type SaveStore, createSaveStore } from '../save/SaveStore';
import { createKeyValueStorage } from '../save/storage';
import { type RunSession, createRunSession } from '../sim/RunSession';
import { type UiRoot, createUiRoot } from '../ui/UIRoot';
import { type ParsedEnv, parseEnv } from './env';
import { FsmSlot, LoopSlot, MirroredPerf, SettingsAwareRender, TappedInput } from './ports';

/** Everything global the game needs, captured once in main.ts. */
export interface BrowserPlatform {
  readonly window: Window;
  readonly document: Document;
  readonly stageHost: HTMLElement;
  readonly uiHost: HTMLElement;
  readonly scheduler: FrameScheduler;
  /** performance.now (monotonic). */
  readonly clock: ClockPort;
  /** Date.now (wall clock: save envelope timestamps, leaderboard dates, the save debounce). */
  readonly wallClock: ClockPort;
  readonly search: string;
  readonly dev: boolean;
  readonly console: Console;
  /** Publishes a value on window (the dev API's window.__game). */
  expose(name: string, value: unknown): void;
  /** navigator facts for the Chromebook auto-detect (config/quality isLowPowerChromebook). */
  readonly hints: PlatformHints;
  /** window 'storage' events (other tabs). Returns an unsubscribe function. */
  onStorage(cb: (key: string | null) => void): () => void;
  reload(): void;
}

function hostElement(doc: Document, id: string): HTMLElement {
  const found = doc.getElementById(id);
  if (found !== null) return found;
  const el = doc.createElement('div');
  el.id = id;
  doc.body.appendChild(el);
  return el;
}

/** UA, UA-CH platform ('Chrome OS' where navigator.userAgentData exists) and logical core count. */
function platformHints(nav: Navigator): PlatformHints {
  const uaData: unknown = Reflect.get(nav, 'userAgentData');
  const platform: unknown =
    typeof uaData === 'object' && uaData !== null ? Reflect.get(uaData, 'platform') : undefined;
  const cores = nav.hardwareConcurrency;
  return {
    userAgent: nav.userAgent,
    uaPlatform: typeof platform === 'string' ? platform : null,
    hardwareConcurrency: Number.isFinite(cores) && cores > 0 ? cores : 0,
  };
}

export function createBrowserPlatform(): BrowserPlatform {
  const win = window;
  const doc = document;
  const perf = win.performance;
  return {
    hints: platformHints(win.navigator),
    window: win,
    document: doc,
    stageHost: hostElement(doc, 'stage'),
    uiHost: hostElement(doc, 'ui'),
    scheduler: {
      request: (cb) => win.requestAnimationFrame(cb),
      cancel: (id) => {
        win.cancelAnimationFrame(id);
      },
    },
    clock: { now: () => perf.now() },
    wallClock: { now: () => Date.now() },
    search: win.location.search,
    dev: import.meta.env.DEV,
    console: win.console,
    expose(name, value) {
      Reflect.set(win, name, value);
    },
    onStorage(cb) {
      const fn = (e: StorageEvent): void => {
        cb(e.key);
      };
      win.addEventListener('storage', fn);
      return () => {
        win.removeEventListener('storage', fn);
      };
    },
    reload() {
      win.location.reload();
    },
  };
}

/** Shader compile/link errors reported by three (debug builds route three's console output through here). */
export interface ShaderLog {
  readonly errors: string[];
}

export interface AppServices {
  readonly services: Services;
  readonly platform: BrowserPlatform;
  readonly parsed: ParsedEnv;
  readonly log: Logger;
  readonly bridge: RenderBridge;
  readonly library: ThreeAssetLibrary;
  readonly uiRoot: UiRoot;
  readonly inputService: InputService;
  readonly input: TappedInput;
  readonly audio: AudioEngine;
  readonly save: SaveStore;
  readonly perf: PerfMonitor;
  readonly pacer: FramePacer;
  readonly governor: ResolutionGovernor;
  readonly fsmSlot: FsmSlot;
  readonly loopSlot: LoopSlot;
  /** Info toasts shown once Boot hands over to the menu (e.g. the Chromebook auto-detect notice). */
  readonly bootNotices: string[];
  /** The concrete RunSession behind services.session.current (debug API access to the mutable world). */
  readonly runs: { current: RunSession | null };
  readonly shaderLog: ShaderLog;
}

function openLocalStorage(win: Window): StorageLike | null {
  try {
    const s = win.localStorage;
    return s;
  } catch {
    return null;
  }
}

function cryptoSeed(win: Window): number {
  try {
    const buf = new Uint32Array(1);
    win.crypto.getRandomValues(buf);
    return buf[0]!;
  } catch {
    return (Math.random() * 0x100000000) >>> 0;
  }
}

function cryptoRunId(win: Window): string {
  try {
    return win.crypto.randomUUID();
  } catch {
    return `run-${Date.now().toString(36)}-${cryptoSeed(win).toString(36)}`;
  }
}

/** Routes three's log/warn/error output to the logger and records shader errors. */
function captureThreeConsole(log: Logger, shaderLog: ShaderLog): void {
  setConsoleFunction((type, message, ...params) => {
    const text = typeof message === 'string' ? message : String(message);
    if (type === 'error') {
      if (/shader|program/i.test(text)) shaderLog.errors.push(text);
      log.error(`three: ${text}`, params.length > 0 ? params : undefined);
    } else if (type === 'warn') log.warn(`three: ${text}`, params.length > 0 ? params : undefined);
    else log.debug(`three: ${text}`);
  });
}

export function createServices(platform: BrowserPlatform): AppServices {
  const win = platform.window;
  const parsed = parseEnv(platform.search, platform.dev);
  const env = parsed.env;
  const log = createConsoleLogger(platform.console, env.debug ? 'debug' : 'info');
  const shaderLog: ShaderLog = { errors: [] };
  captureThreeConsole(log, shaderLog);

  const session: SessionStore = { current: null, lastPicks: null, lastMode: null };
  const runs: { current: RunSession | null } = { current: null };

  const { kv, memoryOnly } = createKeyValueStorage(openLocalStorage(win));
  const bootNotices: string[] = [];
  // Set below from the peeked save; read when Boot creates a brand-new profile.
  let autoChromebook = false;
  const save = createSaveStore({
    storage: kv,
    memoryOnly,
    // Wall clock so envelope timestamps and leaderboard dates are real dates.
    clock: platform.wallClock,
    log,
    inRun: () => session.current !== null,
    // First boot only: a detected low-power Chromebook starts on the Chromebook preset (saved, so it sticks
    // until the player changes it). An existing save is never overridden.
    freshSettings: () => {
      if (!autoChromebook) return null;
      bootNotices.push(CHROMEBOOK_TOAST);
      return { quality: 'chromebook' };
    },
  });

  // Settings and bindings start at their defaults; Boot loads the save and applies them live. The theme is the
  // one exception: its shader modes are compile-time defines, so the saved theme is peeked before anything is built
  // (a theme change applies on reload).
  const theme = getTheme(save.peekThemeId());
  // The quality is peeked the same way: its LOW_FX shader variant is a compile-time define too.
  const boot = chooseBootQuality(save.peekQuality(), parsed.quality, platform.hints);
  autoChromebook = boot.autoChromebook;
  if (parsed.quality !== null) log.info('quality: URL override (not saved)', parsed.quality);
  const settings: Settings = { ...DEFAULT_SETTINGS, quality: boot.quality };
  const bootPreset = QUALITY_PRESETS[boot.quality];
  parsed.variant.lowFx = bootPreset.lowFx;
  const library = createAssetLibrary({
    theme,
    quality: bootPreset,
    log,
    seed: 0x4b50,
  });
  const bridge = createRenderBridge({
    canvasHost: platform.stageHost,
    assets: library,
    theme,
    settings,
    log,
  });
  const uiRoot = createUiRoot({ root: platform.uiHost, theme, doc: platform.document });
  uiRoot.applySettings(settings);
  const inputService = createInputService({ target: win, bindings: DEFAULT_BINDINGS });
  const input = new TappedInput(inputService);
  input.pasteTarget = win;
  const audio = createAudioEngine({
    theme,
    createContext: () => new AudioContext({ latencyHint: 'interactive' }),
    createOfflineContext: (channels, length, sampleRate) =>
      new OfflineAudioContext(channels, length, sampleRate),
    log,
    seed: cryptoSeed(win),
  });

  const perf = createPerfMonitor({ log });
  const pacer = createFramePacer();
  pacer.setCap(effectiveFrameCap(settings.frameCap, bootPreset));
  const governor = createResolutionGovernor(bootPreset);
  const override = parsed.quality;
  const render = new SettingsAwareRender(
    bridge,
    [
      (s) => {
        uiRoot.applySettings(s);
      },
      (s) => {
        // bridge.applySettings resets the render scale, so the governor ladder restarts from its top step.
        const preset = QUALITY_PRESETS[s.quality];
        governor.reset(preset);
        pacer.setCap(effectiveFrameCap(s.frameCap, preset));
      },
    ],
    (s) => (override === null || s.quality === override ? s : { ...s, quality: override }),
  );

  const fsmSlot = new FsmSlot();
  const loopSlot = new LoopSlot();
  const services: Services = {
    fsm: fsmSlot,
    input,
    audio,
    render,
    ui: uiRoot,
    save,
    assets: {
      build: (onProgress) => library.build(onProgress),
      warmup: () => bridge.warmup(),
    },
    session,
    createRun: (c: RunConfig) => {
      const run = createRunSession(c, { log });
      runs.current = run;
      return run;
    },
    loop: loopSlot,
    perf: new MirroredPerf(perf, pacer),
    theme: () => theme,
    clock: platform.clock,
    log,
    env,
    newSeed: () => cryptoSeed(win),
    newRunId: () => cryptoRunId(win),
    reloadApp: () => {
      save.flush();
      win.location.reload();
    },
  };

  return {
    services,
    platform,
    parsed,
    log,
    bridge,
    library,
    uiRoot,
    inputService,
    input,
    audio,
    save,
    perf,
    pacer,
    governor,
    fsmSlot,
    loopSlot,
    bootNotices,
    runs,
    shaderLog,
  };
}

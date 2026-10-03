/**
 * Composition root: the 7 states and the StateMachine (frozen EDGES), GameLoop + FramePacer, page lifecycle,
 * PerfMonitor/ResolutionGovernor wiring, per-frame UI flush and save tick, storage-event sync and (DEV or
 * ?debug=1) the dev API and debug overlay.
 */
import type { StateId } from '../contracts/states';
import { QUALITY_PRESETS, effectiveFrameCap } from '../config/quality';
import type { StateRegistry } from '../engine/StateMachine';
import { type StateMachine, createStateMachine } from '../engine/StateMachine';
import { type FrameSample, type GameLoop, createGameLoop } from '../engine/GameLoop';
import { type GovernorAction } from '../engine/ResolutionGovernor';
import { installLifecycle } from '../engine/lifecycle';
import { createBootState } from '../states/BootState';
import { createCharacterSelectState } from '../states/CharacterSelectState';
import { createGameOverState } from '../states/GameOverState';
import { createMainMenuState } from '../states/MainMenuState';
import { createPausedState } from '../states/PausedState';
import { createPlayingState } from '../states/PlayingState';
import { createUpgradesShopState } from '../states/UpgradesShopState';
import { applySettingsLive } from '../states/settingsPanel';
import { DebugOverlay } from '../debug/DebugOverlay';
import { installDevApi } from '../debug/devApi';
import type { AppServices } from './createServices';
import { type GameDebugHost, createDebugHost } from './debugHost';

export interface GameHandle {
  readonly fsm: StateMachine;
  readonly loop: GameLoop;
  start(): void;
  dispose(): void;
}

/** Frames between program-count checks after Boot (growth logs a DEV error in PerfMonitor). */
const PROGRAM_CHECK_FRAMES = 120;
/** Boot notices (Chromebook auto-detect) stay up longer than ordinary toasts. */
const NOTICE_MS = 7000;

/** Base states without a world of their own whose 3D backdrop (menu orbit, select stage) the root renders. */
function drawsBackdrop(stack: readonly StateId[]): boolean {
  if (stack.length !== 1) return false;
  const top = stack[0];
  return top === 'Boot' || top === 'MainMenu' || top === 'CharacterSelect' || top === 'UpgradesShop';
}

export function createGame(app: AppServices): GameHandle {
  const s = app.services;
  const { bridge, perf, pacer, governor, save, uiRoot, audio, log, platform } = app;

  const states: StateRegistry = {
    Boot: createBootState(s),
    MainMenu: createMainMenuState(s),
    CharacterSelect: createCharacterSelectState(s),
    Playing: createPlayingState(s),
    UpgradesShop: createUpgradesShopState(s),
    Paused: createPausedState(s),
    GameOver: createGameOverState(s),
  };
  const fsm = createStateMachine({ states, input: app.inputService, log, strict: s.env.strict });
  app.fsmSlot.bind(fsm);

  let debug: GameDebugHost | null = null;
  let overlay: DebugOverlay | null = null;
  const frameStat = { frameMs: 0, cpuMs: 0, simMs: 0 };
  let bootDone = false;
  let programTimer = 0;

  const applyGovernor = (a: GovernorAction): void => {
    if (a.kind === 'frameCap') {
      const st = save.data.settings;
      const preset = QUALITY_PRESETS[app.parsed.quality ?? st.quality];
      pacer.setCap(a.value === 60 ? 60 : effectiveFrameCap(st.frameCap, preset));
      log.debug('governor: frame cap', { value: a.value });
      return;
    }
    bridge.applyGovernor(a);
  };

  const recordPerf = (sample: Readonly<FrameSample>): void => {
    perf.record(sample);
    if (perf.playing) {
      const a = governor.evaluate(platform.clock.now() / 1000, perf.percentile('frame', 95), true);
      if (a !== null) applyGovernor(a);
    }
    if (bootDone && ++programTimer >= PROGRAM_CHECK_FRAMES) {
      programTimer = 0;
      perf.setProgramCount(bridge.stats().programs);
    }
    if (debug !== null) {
      frameStat.frameMs = sample.frameMs;
      frameStat.cpuMs = sample.cpuMs;
      frameStat.simMs = sample.simMs;
      debug.frameDone(frameStat);
    }
  };

  const loop = createGameLoop({
    scheduler: platform.scheduler,
    clock: platform.clock,
    pacer,
    hooks: {
      applyPending: () => {
        fsm.applyPending();
        if (!bootDone && fsm.top !== 'Boot') {
          bootDone = true;
          // Boot baseline: every shader program is compiled by the warm-up; later growth is an error.
          perf.setProgramCount(bridge.stats().programs);
          for (const msg of app.bootNotices.splice(0)) uiRoot.toast(msg, 'info', NOTICE_MS);
        }
      },
      fixedUpdate: (dt) => {
        fsm.fixedUpdate(dt);
      },
      update: (frameDt) => {
        if (debug !== null) debug.beforeUpdate(frameDt);
        fsm.update(frameDt);
        if (overlay !== null) overlay.update(frameDt);
      },
      render: (alpha, frameDt) => {
        // Reading beatPhase every frame also drives the audio scheduler's catch-up tick.
        const beat = audio.beatPhase;
        bridge.setBeat(beat);
        fsm.render(alpha, frameDt);
        // Menu states have no world: the composition root draws their 3D backdrop (attract/select cameras).
        if (drawsBackdrop(fsm.stack)) bridge.frame(alpha, frameDt);
        uiRoot.flush();
        save.tick(platform.wallClock.now());
      },
      recordPerf,
    },
  });
  app.loopSlot.bind(loop);

  const uninstallLifecycle = installLifecycle(platform.window, {
    input: s.input,
    fsm,
    audio,
    save,
    canvas: bridge.canvas,
    log,
  });
  const unsubStorage = platform.onStorage((key) => {
    save.handleStorageEvent(key);
  });
  const unsubExternal = save.onExternalChange((d) => {
    applySettingsLive(s, d.settings);
    s.input.setBindings(d.bindings);
  });

  if (s.env.debug) {
    const host = createDebugHost(
      app,
      () => governor.step,
      () => fsm.pendingCount,
    );
    debug = host;
    platform.expose('__game', installDevApi(host));
    overlay = new DebugOverlay(platform.document, platform.window, {
      perf,
      renderStats: () => bridge.stats(),
      audioStats: () => audio.stats(),
      governorStep: () => governor.step,
      stack: () => fsm.stack,
    });
    log.info('debug: window.__game installed (Backquote toggles the overlay)');
  }

  let started = false;
  let disposed = false;
  return {
    fsm,
    loop,
    start(): void {
      if (started) return;
      started = true;
      fsm.start();
      loop.start();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      loop.stop();
      uninstallLifecycle();
      unsubStorage();
      unsubExternal();
      overlay?.dispose();
      app.input.tap = null;
      save.flush();
      app.inputService.dispose();
      audio.dispose();
      bridge.dispose();
      uiRoot.dispose();
      app.library.dispose();
    },
  };
}

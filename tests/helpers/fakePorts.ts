/**
 * Recording fakes for every Services port except save/run/fsm (see fakeSave.ts, fakeRun.ts, fakeStates.ts).
 * All conform to the frozen contracts so states can be tested in node.
 */
import type { AudioPort, AudioStats, MusicMood, SfxId } from '../../src/contracts/audio';
import type { PlayerIndex, VehicleId } from '../../src/contracts/ids';
import type {
  Bindings,
  InputContext,
  InputPort,
  KeyCode,
  MenuIntent,
  PlayerIntent,
} from '../../src/contracts/input';
import type {
  AssetLoaderPort,
  CameraMode,
  RenderCapabilities,
  RenderPort,
  RenderStats,
  ViewRectSink,
} from '../../src/contracts/render';
import type { Settings } from '../../src/contracts/save';
import type { LoopControl, PerfPort, PerfSnapshot } from '../../src/contracts/services';
import type { SimEvents } from '../../src/contracts/simEvents';
import type { PointerIntent, ScreenId, ScreenVMs, ToastKind, UiPort } from '../../src/contracts/ui';
import type { WorldView } from '../../src/contracts/world';
import { CallRecorder } from './callRecorder';

export class FakeRenderPort implements RenderPort {
  readonly rec = new CallRecorder();
  capabilities: RenderCapabilities = { webgl2: true, floatTargets: true };
  world: WorldView | null = null;
  viewRectSink: ViewRectSink | null = null;
  cameraMode: CameraMode = 'attract';
  frames = 0;
  frozenFrames = 0;

  attachWorld(w: WorldView, setViewRect: ViewRectSink): void {
    this.world = w;
    this.viewRectSink = setViewRect;
    this.rec.record('attachWorld', w);
  }
  detachWorld(): void {
    this.world = null;
    this.viewRectSink = null;
    this.rec.record('detachWorld');
  }
  setCameraMode(m: CameraMode): void {
    this.cameraMode = m;
    this.rec.record('setCameraMode', m);
  }
  showVehiclePreviews(sel: readonly [VehicleId | null, VehicleId | null]): void {
    this.rec.record('showVehiclePreviews', sel);
  }
  consumeEvents(e: SimEvents): void {
    this.rec.record('consumeEvents', e.kill.count, e.hit.count);
  }
  setSector(s: 1 | 2 | 3): void {
    this.rec.record('setSector', s);
  }
  setBeat(phase: number): void {
    this.rec.record('setBeat', phase);
  }
  frame(alpha: number, frameDt: number): void {
    this.frames++;
    this.rec.record('frame', alpha, frameDt);
  }
  renderFrozen(dim: number): void {
    this.frozenFrames++;
    this.rec.record('renderFrozen', dim);
  }
  applySettings(s: Settings): void {
    this.rec.record('applySettings', s);
  }
  stats(): RenderStats {
    return { calls: 0, triangles: 0, programs: 0, geometries: 0, textures: 0, renderScale: 1, msaa: 4 };
  }
}

export class FakeUiPort implements UiPort {
  readonly rec = new CallRecorder();
  /** Currently visible screens with their latest VM. */
  readonly visible = new Map<ScreenId, unknown>();
  readonly toasts: { msg: string; kind: ToastKind }[] = [];
  private pointerCbs: ((i: PointerIntent) => void)[] = [];
  flushes = 0;

  show<S extends ScreenId>(s: S, vm: ScreenVMs[S]): void {
    this.visible.set(s, vm);
    this.rec.record('show', s, vm);
  }
  update<S extends ScreenId>(s: S, vm: ScreenVMs[S]): void {
    if (this.visible.has(s)) this.visible.set(s, vm);
    this.rec.record('update', s, vm);
  }
  hide(s: ScreenId): void {
    this.visible.delete(s);
    this.rec.record('hide', s);
  }
  toast(msg: string, kind: ToastKind): void {
    this.toasts.push({ msg, kind });
    this.rec.record('toast', msg, kind);
  }
  onPointerIntent(cb: (i: PointerIntent) => void): () => void {
    this.pointerCbs.push(cb);
    return () => {
      this.pointerCbs = this.pointerCbs.filter((c) => c !== cb);
    };
  }
  flush(): void {
    this.flushes++;
  }
  /** Latest VM of a visible screen (typed). */
  vm<S extends ScreenId>(s: S): ScreenVMs[S] | undefined {
    return this.visible.get(s) as ScreenVMs[S] | undefined;
  }
  /** Simulates a mouse click intent. */
  click(i: PointerIntent): void {
    for (const cb of [...this.pointerCbs]) cb(i);
  }
}

export class NullAudio implements AudioPort {
  readonly rec = new CallRecorder();
  unlocked = false;
  beatPhase = 0;
  mood: MusicMood = 'silent';
  ducked = false;

  unlock(): Promise<void> {
    this.unlocked = true;
    this.rec.record('unlock');
    return Promise.resolve();
  }
  play(id: SfxId, pan?: number, gain?: number, detuneCents?: number): void {
    this.rec.record('play', id, pan, gain, detuneCents);
  }
  consumeEvents(e: SimEvents): void {
    this.rec.record('consumeEvents', e.kill.count);
  }
  setMood(m: MusicMood): void {
    this.mood = m;
    this.rec.record('setMood', m);
  }
  setIntensity(x: number): void {
    this.rec.record('setIntensity', x);
  }
  setSector(s: 1 | 2 | 3): void {
    this.rec.record('setSector', s);
  }
  duck(on: boolean): void {
    this.ducked = on;
    this.rec.record('duck', on);
  }
  setVolumes(master: number, music: number, sfx: number): void {
    this.rec.record('setVolumes', master, music, sfx);
  }
  suspend(): Promise<void> {
    this.rec.record('suspend');
    return Promise.resolve();
  }
  resume(): Promise<void> {
    this.rec.record('resume');
    return Promise.resolve();
  }
  stats(): AudioStats {
    return { voices: 0, stolen: 0, coalesced: 0, ctxState: this.unlocked ? 'running' : 'suspended' };
  }
}

/** Asset loader whose build/warmup resolve after the test calls finishBuild()/finishWarmup() (or at once). */
export class FakeAssets implements AssetLoaderPort {
  readonly rec = new CallRecorder();
  progress = 0;
  failBuild: Error | null = null;
  private resolveBuild: (() => void) | null = null;
  private resolveWarmup: (() => void) | null = null;

  private readonly instant: boolean;

  constructor(instant = true) {
    this.instant = instant;
  }

  build(onProgress: (p: number) => void): Promise<void> {
    this.rec.record('build');
    if (this.failBuild) return Promise.reject(this.failBuild);
    onProgress(0.5);
    if (this.instant) {
      onProgress(1);
      return Promise.resolve();
    }
    return new Promise((res) => {
      this.resolveBuild = () => {
        onProgress(1);
        res();
      };
    });
  }
  warmup(): Promise<void> {
    this.rec.record('warmup');
    if (this.instant) return Promise.resolve();
    return new Promise((res) => {
      this.resolveWarmup = res;
    });
  }
  finishBuild(): void {
    this.resolveBuild?.();
  }
  finishWarmup(): void {
    this.resolveWarmup?.();
  }
}

/** Scriptable InputPort: queue menu intents / gameplay intents per player. */
export class FakeInputPort implements InputPort {
  readonly rec = new CallRecorder();
  context: InputContext = 'menu';
  solo = false;
  bindings: Bindings | null = null;
  readonly held = new Set<KeyCode>();
  /** Per-player intent returned by sample() (copied into `out`). */
  readonly next: [Partial<PlayerIntent>, Partial<PlayerIntent>] = [{}, {}];
  private menuQueue: MenuIntent[] = [];
  private anyKey = false;
  private captureCb: ((code: KeyCode | null) => void) | null = null;

  get heldCodes(): ReadonlySet<KeyCode> {
    return this.held;
  }
  /** Queues menu intents delivered by the next pollMenu() call. */
  queueMenu(...intents: MenuIntent[]): void {
    this.menuQueue.push(...intents);
  }
  pressAnyKey(): void {
    this.anyKey = true;
  }
  /** Completes a pending captureNextKey. */
  capture(code: KeyCode | null): void {
    const cb = this.captureCb;
    this.captureCb = null;
    cb?.(code);
  }

  sample(p: PlayerIndex, out: PlayerIntent): void {
    out.moveX = 0;
    out.moveZ = 0;
    out.fireHeld = false;
    out.focusHeld = false;
    out.dashPressed = false;
    out.specialPressed = false;
    Object.assign(out, this.next[p]);
  }
  pollMenu(_frameDtMs: number, out: MenuIntent[]): number {
    let n = 0;
    while (this.menuQueue.length > 0 && n < out.length) {
      const i = this.menuQueue.shift()!;
      if (this.context === 'gameplay' && i.kind !== 'pause') continue;
      out[n++] = i;
    }
    return n;
  }
  consumeAnyKey(): boolean {
    const a = this.anyKey;
    this.anyKey = false;
    return a;
  }
  setContext(c: InputContext): void {
    this.context = c;
    this.rec.record('setContext', c);
  }
  setSolo(solo: boolean): void {
    this.solo = solo;
    this.rec.record('setSolo', solo);
  }
  setBindings(b: Bindings): void {
    this.bindings = b;
    this.rec.record('setBindings', b);
  }
  setFireModes(autofire: readonly [boolean, boolean], focusToggle: readonly [boolean, boolean]): void {
    this.rec.record('setFireModes', autofire, focusToggle);
  }
  clearEdges(): void {
    this.rec.record('clearEdges');
  }
  releaseAll(): void {
    this.held.clear();
    this.rec.record('releaseAll');
  }
  suppressHeldUntilRelease(): void {
    this.rec.record('suppressHeldUntilRelease');
  }
  captureNextKey(cb: (code: KeyCode | null) => void): void {
    this.captureCb = cb;
    this.rec.record('captureNextKey');
  }
  private pasteCb: ((text: string) => void) | null = null;
  onPaste(cb: (text: string) => void): () => void {
    this.pasteCb = cb;
    return () => {
      if (this.pasteCb === cb) this.pasteCb = null;
    };
  }
  /** Simulates a clipboard paste (only delivered while someone is subscribed). */
  paste(text: string): void {
    this.pasteCb?.(text);
  }
}

export class FakeLoop implements LoopControl {
  readonly rec = new CallRecorder();
  timeScale = 1;
  simTick = 0;

  resetAccumulator(): void {
    this.rec.record('resetAccumulator');
  }
  setTimeScale(s: number): void {
    this.timeScale = s;
    this.rec.record('setTimeScale', s);
  }
}

export class FakePerf implements PerfPort {
  playing = false;
  snap: PerfSnapshot = {
    avgFps: 60,
    p50: 16.6,
    p95: 16.9,
    p99: 17.2,
    longFrames: 0,
    cpuP95: 2,
    droppedSteps: 0,
  };

  snapshot(): PerfSnapshot {
    return this.snap;
  }
  setPlaying(on: boolean): void {
    this.playing = on;
  }
}

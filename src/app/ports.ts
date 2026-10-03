/**
 * Port adapters used by the composition root:
 * - late-bound FSM and loop slots (states need Services.fsm/loop before the StateMachine/GameLoop exist);
 * - an InputPort tap (the debug autopilot and input probe observe or override sampled intents);
 * - the RenderPort wrapper whose applySettings also reaches the UI palette, the frame pacer and the governor;
 * - the PerfPort wrapper mirroring setPlaying into the frame pacer.
 */
import type {
  KeyCode,
  InputContext,
  InputPort,
  MenuIntent,
  PlayerIntent,
  Bindings,
} from '../contracts/input';
import type { PlayerIndex } from '../contracts/ids';
import type {
  CameraMode,
  RenderCapabilities,
  RenderPort,
  RenderStats,
  ViewRectSink,
} from '../contracts/render';
import type { Settings } from '../contracts/save';
import type { LoopControl, PerfPort, PerfSnapshot } from '../contracts/services';
import type { PayloadArg, StateId, StateMachineApi } from '../contracts/states';
import type { SimEvents } from '../contracts/simEvents';
import type { WorldView } from '../contracts/world';
import type { VehicleId } from '../contracts/ids';

export class FsmSlot implements StateMachineApi {
  private target: StateMachineApi | null = null;

  bind(fsm: StateMachineApi): void {
    this.target = fsm;
  }

  private get fsm(): StateMachineApi {
    if (this.target === null) throw new Error('FsmSlot: the state machine is not bound yet');
    return this.target;
  }

  request<S extends StateId>(to: S, ...payload: PayloadArg<S>): boolean {
    return this.fsm.request(to, ...payload);
  }

  requestPop(): boolean {
    return this.fsm.requestPop();
  }

  get top(): StateId {
    return this.fsm.top;
  }

  get stack(): readonly StateId[] {
    return this.fsm.stack;
  }
}

export class LoopSlot implements LoopControl {
  private target: LoopControl | null = null;

  bind(loop: LoopControl): void {
    this.target = loop;
  }

  private get loop(): LoopControl {
    if (this.target === null) throw new Error('LoopSlot: the game loop is not bound yet');
    return this.target;
  }

  resetAccumulator(): void {
    this.loop.resetAccumulator();
  }

  setTimeScale(s: number): void {
    this.loop.setTimeScale(s);
  }

  get timeScale(): number {
    return this.loop.timeScale;
  }

  get simTick(): number {
    return this.loop.simTick;
  }
}

/** Called after every InputPort.sample (may overwrite `out`). */
export type SampleTap = (p: PlayerIndex, out: PlayerIntent) => void;

/** InputPort that forwards to the real service; an optional tap sees (and may rewrite) sampled intents. */
export class TappedInput implements InputPort {
  private readonly inner: InputPort;
  tap: SampleTap | null = null;

  constructor(inner: InputPort) {
    this.inner = inner;
  }

  sample(p: PlayerIndex, out: PlayerIntent): void {
    this.inner.sample(p, out);
    const tap = this.tap;
    if (tap !== null) tap(p, out);
  }

  pollMenu(frameDtMs: number, out: MenuIntent[]): number {
    return this.inner.pollMenu(frameDtMs, out);
  }

  consumeAnyKey(): boolean {
    return this.inner.consumeAnyKey();
  }

  setContext(c: InputContext): void {
    this.inner.setContext(c);
  }

  setSolo(solo: boolean): void {
    this.inner.setSolo(solo);
  }

  setBindings(b: Bindings): void {
    this.inner.setBindings(b);
  }

  setFireModes(autofire: readonly [boolean, boolean], focusToggle: readonly [boolean, boolean]): void {
    this.inner.setFireModes(autofire, focusToggle);
  }

  clearEdges(): void {
    this.inner.clearEdges();
  }

  releaseAll(): void {
    this.inner.releaseAll();
  }

  suppressHeldUntilRelease(): void {
    this.inner.suppressHeldUntilRelease();
  }

  get heldCodes(): ReadonlySet<KeyCode> {
    return this.inner.heldCodes;
  }

  captureNextKey(cb: (code: KeyCode | null) => void): void {
    this.inner.captureNextKey(cb);
  }

  /** Window (or test double) whose 'paste' events feed onPaste; null = paste unsupported. */
  pasteTarget: PasteTargetLike | null = null;

  onPaste(cb: (text: string) => void): () => void {
    const target = this.pasteTarget;
    if (target === null) return () => undefined;
    const fn = (e: PasteEventLike): void => {
      const text = e.clipboardData?.getData('text') ?? '';
      e.preventDefault();
      if (text.length > 0) cb(text);
    };
    target.addEventListener('paste', fn);
    return () => {
      target.removeEventListener('paste', fn);
    };
  }
}

/** The bits of a ClipboardEvent onPaste reads. */
export interface PasteEventLike {
  readonly clipboardData: { getData(format: string): string } | null;
  preventDefault(): void;
}

export interface PasteTargetLike {
  addEventListener(type: 'paste', fn: (e: PasteEventLike) => void): void;
  removeEventListener(type: 'paste', fn: (e: PasteEventLike) => void): void;
}

/** Settings side effects that live outside the renderer (UI palette, pacer cap, governor preset). */
export type SettingsListener = (s: Settings) => void;

/** RenderPort forwarding to the bridge; applySettings also notifies the other settings consumers. */
export class SettingsAwareRender implements RenderPort {
  private readonly inner: RenderPort;
  private readonly listeners: readonly SettingsListener[];

  constructor(inner: RenderPort, listeners: readonly SettingsListener[]) {
    this.inner = inner;
    this.listeners = listeners;
  }

  get capabilities(): RenderCapabilities {
    return this.inner.capabilities;
  }

  attachWorld(w: WorldView, setViewRect: ViewRectSink): void {
    this.inner.attachWorld(w, setViewRect);
  }

  detachWorld(): void {
    this.inner.detachWorld();
  }

  setCameraMode(m: CameraMode): void {
    this.inner.setCameraMode(m);
  }

  showVehiclePreviews(sel: readonly [VehicleId | null, VehicleId | null]): void {
    this.inner.showVehiclePreviews(sel);
  }

  consumeEvents(e: SimEvents): void {
    this.inner.consumeEvents(e);
  }

  setSector(s: 1 | 2 | 3): void {
    this.inner.setSector(s);
  }

  setBeat(phase: number): void {
    this.inner.setBeat(phase);
  }

  frame(alpha: number, frameDt: number): void {
    this.inner.frame(alpha, frameDt);
  }

  renderFrozen(dim: number): void {
    this.inner.renderFrozen(dim);
  }

  applySettings(s: Settings): void {
    this.inner.applySettings(s);
    for (let i = 0; i < this.listeners.length; i++) this.listeners[i]!(s);
  }

  stats(): RenderStats {
    return this.inner.stats();
  }
}

/** PerfPort whose setPlaying is mirrored into the frame pacer (auto cap degrades only while Playing). */
export class MirroredPerf implements PerfPort {
  private readonly perf: PerfPort;
  private readonly pacer: { setPlaying(on: boolean): void };

  constructor(perf: PerfPort, pacer: { setPlaying(on: boolean): void }) {
    this.perf = perf;
    this.pacer = pacer;
  }

  snapshot(): PerfSnapshot {
    return this.perf.snapshot();
  }

  setPlaying(on: boolean): void {
    this.perf.setPlaying(on);
    this.pacer.setPlaying(on);
  }
}

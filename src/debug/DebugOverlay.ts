/**
 * Debug overlay (?debug=1, toggled with Backquote): FPS, frame p99, CPU p95, draw calls, triangles, programs,
 * audio voices, governor step and the FSM stack. Text refreshes 4 times per second from the PerfMonitor ring.
 */
import type { AudioStats } from '../contracts/audio';
import type { RenderStats } from '../contracts/render';
import type { StateId } from '../contracts/states';
import type { PerfMonitor } from '../engine/PerfMonitor';

export interface DebugOverlaySources {
  readonly perf: PerfMonitor;
  renderStats(): RenderStats;
  audioStats(): AudioStats;
  governorStep(): number;
  stack(): readonly StateId[];
}

const REFRESH_S = 0.25;

export class DebugOverlay {
  private readonly el: HTMLElement;
  private readonly src: DebugOverlaySources;
  private readonly keyTarget: EventTarget;
  private readonly onKey: (e: Event) => void;
  private visible = false;
  private timer = 0;

  constructor(doc: Document, keyTarget: EventTarget, src: DebugOverlaySources) {
    this.src = src;
    this.keyTarget = keyTarget;
    const el = doc.createElement('pre');
    el.className = 'kp-debug-overlay';
    const css: Readonly<Record<string, string>> = {
      position: 'fixed',
      top: '8px',
      left: '8px',
      'z-index': '2147483000',
      margin: '0',
      padding: '6px 9px',
      font: '11px/1.35 ui-monospace, Menlo, Consolas, monospace',
      color: '#7dff9a',
      background: 'rgba(5, 6, 13, 0.78)',
      border: '1px solid rgba(125, 255, 154, 0.35)',
      'pointer-events': 'none',
      'white-space': 'pre',
    };
    for (const [k, v] of Object.entries(css)) el.style.setProperty(k, v);
    el.hidden = true;
    doc.body.appendChild(el);
    this.el = el;
    this.onKey = (e: Event): void => {
      if (e instanceof KeyboardEvent && e.code === 'Backquote' && !e.repeat) this.toggle();
    };
    keyTarget.addEventListener('keydown', this.onKey);
  }

  get shown(): boolean {
    return this.visible;
  }

  toggle(): void {
    this.visible = !this.visible;
    this.el.hidden = !this.visible;
    this.timer = 0;
  }

  update(frameDt: number): void {
    if (!this.visible) return;
    this.timer -= frameDt;
    if (this.timer > 0) return;
    this.timer = REFRESH_S;
    const perf = this.src.perf;
    const snap = perf.snapshot();
    const r = this.src.renderStats();
    const a = this.src.audioStats();
    this.el.textContent = [
      `FPS ${snap.avgFps.toFixed(1)}  p99 ${snap.p99.toFixed(1)} ms  long ${snap.longFrames}`,
      `CPU p95 ${snap.cpuP95.toFixed(2)} ms  sim p95 ${perf.percentile('sim', 95).toFixed(2)} ms`,
      `draws ${r.calls}  tris ${r.triangles}  programs ${r.programs}`,
      `geo ${r.geometries}  tex ${r.textures}  scale ${r.renderScale.toFixed(2)}  msaa ${r.msaa}`,
      `voices ${a.voices}  stolen ${a.stolen}  audio ${a.ctxState}`,
      `governor step ${this.src.governorStep()}  dropped ${snap.droppedSteps}`,
      `fsm ${this.src.stack().join(' > ')}`,
    ].join('\n');
  }

  dispose(): void {
    this.keyTarget.removeEventListener('keydown', this.onKey);
    this.el.remove();
  }
}

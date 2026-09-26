/**
 * WebGL2 renderer wrapper (plan section 8 Renderer.ts, section 10.4/10.7): high-performance context without
 * antialias/stencil (MSAA lives on the HDR scene target), NoToneMapping and linear output (the composite pass owns
 * tonemapping and sRGB), canvas backing store = CSS size x min(DPR, preset cap) through a ResizeObserver with a
 * 150 ms debounce, context lost/restored handling and per-frame stats (info.autoReset off: one reset per frame so
 * scene + post passes are all counted).
 */
import { LinearSRGBColorSpace, NoToneMapping, WebGLRenderer } from 'three';
import type { Logger } from '../contracts/ids';
import type { RenderCapabilities, RenderStats } from '../contracts/render';

export const RESIZE_DEBOUNCE_MS = 150;

export interface ViewportSize {
  cssWidth: number;
  cssHeight: number;
  pixelRatio: number;
  /** Backing-store pixels. */
  width: number;
  height: number;
}

/** Pure: backing-store size for a CSS box, device pixel ratio and preset DPR cap (at least 1 x 1). */
export function computeBackingSize(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
  dprCap: number,
  out: ViewportSize,
): ViewportSize {
  const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;
  const ratio = dpr < dprCap ? dpr : dprCap > 0 ? dprCap : 1;
  const w = cssWidth > 1 ? cssWidth : 1;
  const h = cssHeight > 1 ? cssHeight : 1;
  out.cssWidth = w;
  out.cssHeight = h;
  out.pixelRatio = ratio;
  out.width = Math.max(1, Math.floor(w * ratio));
  out.height = Math.max(1, Math.floor(h * ratio));
  return out;
}

export interface RenderSystemDeps {
  readonly canvasHost: HTMLElement;
  readonly log: Logger;
  readonly dprCap: number;
}

export interface RenderSystem {
  readonly renderer: WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  readonly capabilities: RenderCapabilities;
  readonly size: Readonly<ViewportSize>;
  readonly contextLost: boolean;
  setDprCap(cap: number): void;
  /** Re-measures the host immediately (no debounce). */
  resizeNow(): void;
  onResize(cb: (s: Readonly<ViewportSize>) => void): void;
  onContextLost(cb: () => void): void;
  onContextRestored(cb: () => void): void;
  /** Resets renderer.info counters (call once at the start of every rendered frame). */
  beginFrame(): void;
  stats(renderScale: number, msaa: number): RenderStats;
  dispose(): void;
}

class RenderSystemImpl implements RenderSystem {
  readonly renderer: WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  readonly capabilities: RenderCapabilities;
  readonly size: ViewportSize = { cssWidth: 1, cssHeight: 1, pixelRatio: 1, width: 1, height: 1 };
  private lost = false;
  private dprCap: number;
  private readonly host: HTMLElement;
  private readonly log: Logger;
  private readonly resizeCbs: ((s: Readonly<ViewportSize>) => void)[] = [];
  private readonly lostCbs: (() => void)[] = [];
  private readonly restoredCbs: (() => void)[] = [];
  private observer: ResizeObserver | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private readonly onObserved = (): void => {
    if (this.debounce !== null) clearTimeout(this.debounce);
    this.debounce = setTimeout(this.onDebounced, RESIZE_DEBOUNCE_MS);
  };
  private readonly onDebounced = (): void => {
    this.debounce = null;
    this.resizeNow();
  };
  private readonly onLost = (e: Event): void => {
    e.preventDefault();
    this.lost = true;
    this.log.warn('render: WebGL context lost');
    for (const cb of this.lostCbs) cb();
  };
  private readonly onRestored = (): void => {
    this.lost = false;
    this.log.info('render: WebGL context restored');
    for (const cb of this.restoredCbs) cb();
  };

  constructor(deps: RenderSystemDeps) {
    this.host = deps.canvasHost;
    this.log = deps.log;
    this.dprCap = deps.dprCap;
    const renderer = new WebGLRenderer({
      powerPreference: 'high-performance',
      antialias: false,
      stencil: false,
      depth: true,
      alpha: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });
    renderer.toneMapping = NoToneMapping;
    renderer.outputColorSpace = LinearSRGBColorSpace;
    renderer.autoClear = false;
    renderer.info.autoReset = false;
    renderer.setClearColor(0x000000, 1);
    renderer.debug.checkShaderErrors = __DEV__;
    this.renderer = renderer;
    const canvas = renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.touchAction = 'none';
    this.canvas = canvas;
    this.host.appendChild(canvas);
    this.capabilities = {
      webgl2: renderer.capabilities.isWebGL2,
      floatTargets: renderer.extensions.has('EXT_color_buffer_float'),
    };
    canvas.addEventListener('webglcontextlost', this.onLost, false);
    canvas.addEventListener('webglcontextrestored', this.onRestored, false);
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(this.onObserved);
      this.observer.observe(this.host);
    }
    this.resizeNow();
  }

  get contextLost(): boolean {
    return this.lost;
  }

  setDprCap(cap: number): void {
    if (cap === this.dprCap) return;
    this.dprCap = cap;
    this.resizeNow();
  }

  resizeNow(): void {
    const rect = this.host.getBoundingClientRect();
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
    const prevW = this.size.width;
    const prevH = this.size.height;
    const prevCssW = this.size.cssWidth;
    const prevCssH = this.size.cssHeight;
    computeBackingSize(rect.width, rect.height, dpr, this.dprCap, this.size);
    if (
      prevW === this.size.width &&
      prevH === this.size.height &&
      prevCssW === this.size.cssWidth &&
      prevCssH === this.size.cssHeight
    ) {
      return;
    }
    this.renderer.setPixelRatio(this.size.pixelRatio);
    this.renderer.setSize(this.size.cssWidth, this.size.cssHeight, false);
    for (const cb of this.resizeCbs) cb(this.size);
  }

  onResize(cb: (s: Readonly<ViewportSize>) => void): void {
    this.resizeCbs.push(cb);
  }

  onContextLost(cb: () => void): void {
    this.lostCbs.push(cb);
  }

  onContextRestored(cb: () => void): void {
    this.restoredCbs.push(cb);
  }

  beginFrame(): void {
    this.renderer.info.reset();
  }

  stats(renderScale: number, msaa: number): RenderStats {
    const info = this.renderer.info;
    return {
      calls: info.render.calls,
      triangles: info.render.triangles,
      programs: info.programs === null ? 0 : info.programs.length,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      renderScale,
      msaa,
    };
  }

  dispose(): void {
    if (this.debounce !== null) clearTimeout(this.debounce);
    this.debounce = null;
    this.observer?.disconnect();
    this.observer = null;
    this.canvas.removeEventListener('webglcontextlost', this.onLost, false);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored, false);
    this.renderer.dispose();
    if (this.canvas.parentElement === this.host) this.host.removeChild(this.canvas);
  }
}

/** Creates the WebGL2 renderer and appends its canvas to the host immediately. */
export function createRenderSystem(deps: RenderSystemDeps): RenderSystem {
  return new RenderSystemImpl(deps);
}

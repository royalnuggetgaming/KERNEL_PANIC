/**
 * RenderPort implementation (plan section 8): owns the renderer, camera rig, scenes, world views, fx and PostFX.
 * frame(): shared uniforms -> view sync (prev/current interpolation, zero allocation) -> camera -> publish the
 * ground view rect to the sim -> scene into the HDR target -> post. renderFrozen() draws one dimmed/blurred frame
 * and the GPU idles until the next frame(); a resize while frozen re-renders the frozen frame; the first live frames
 * after it fade in from its dim (unfreezeFade.ts). Before warmup() completes, attachWorld/frame/renderFrozen no-op.
 */
import { Scene } from 'three';
import type { Logger, VehicleId } from '../contracts/ids';
import type {
  CameraMode,
  RenderCapabilities,
  RenderPort,
  RenderStats,
  ViewRectSink,
} from '../contracts/render';
import type { Settings } from '../contracts/save';
import type { SimEvents } from '../contracts/simEvents';
import type { ThemeDef } from '../contracts/theme';
import type { ViewRect, WorldView } from '../contracts/world';
import { QUALITY_PRESETS, type QualityPreset } from '../config/quality';
import type { ThreeAssetLibrary } from './assetTypes';
import { CameraRig } from './CameraRig';
import { FrameUniforms, RenderClock, renderSimTime } from './frameUniforms';
import { PostFX } from './PostFX';
import { createRenderSystem, type RenderSystem, type ViewportSize } from './Renderer';
import { ArenaScene } from './scenes/ArenaScene';
import { MenuBackdrop } from './scenes/MenuBackdrop';
import { SelectStage } from './scenes/SelectStage';
import { warmupShaders, type WarmupDeps } from './ShaderWarmup';
import { UnfreezeFade } from './unfreezeFade';
import type { FrameContext } from './views/types';
import { WorldViews } from './WorldViews';

export interface RenderBridgeDeps {
  readonly canvasHost: HTMLElement;
  readonly assets: ThreeAssetLibrary;
  readonly theme: ThemeDef;
  readonly settings: Settings;
  readonly log: Logger;
}

export interface GovernorAction {
  readonly kind: 'renderScale' | 'msaa' | 'frameCap';
  readonly value: number | null;
}

export interface RenderBridge extends RenderPort {
  readonly canvas: HTMLCanvasElement;
  /**
   * Call after assets.build(): creates batches (assets.createBatches()), views and PostFX targets, then runs
   * ShaderWarmup. Before warmup, attachWorld/frame/renderFrozen are no-ops. This is Services.assets.warmup.
   */
  warmup(): Promise<void>;
  /** Governor actions from engine/ResolutionGovernor (structurally typed). */
  applyGovernor(a: GovernorAction): void;
  dispose(): void;
}

const FX_SEED = 0x6a09e667;
/** Post look defaults (vignette/grain/scanlines); bloom comes from the theme. */
const LOOK = { vignette: 0.35, grain: 0.035, scanlines: 0.06 } as const;

interface Live {
  readonly scene: Scene;
  readonly arena: ArenaScene;
  readonly backdrop: MenuBackdrop;
  readonly stage: SelectStage;
  readonly views: WorldViews;
  readonly post: PostFX;
  readonly uniforms: FrameUniforms;
}

class RenderBridgeImpl implements RenderBridge {
  readonly canvas: HTMLCanvasElement;
  readonly capabilities: RenderCapabilities;
  private readonly deps: RenderBridgeDeps;
  private readonly sys: RenderSystem;
  private readonly rig = new CameraRig();
  private readonly clock = new RenderClock();
  private readonly rect: ViewRect = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  private ctx: FrameContext | null = null;
  private warmed = false;
  private live: Live | null = null;
  private warming: Promise<void> | null = null;
  private world: WorldView | null = null;
  private sink: ViewRectSink | null = null;
  private settings: Settings;
  private preset: QualityPreset;
  private frozenDim = -1;
  private readonly fade = new UnfreezeFade();
  private mode: CameraMode = 'attract';
  private pendingSector: 1 | 2 | 3 = 1;
  private pendingBeat = 0;
  private previews: readonly [VehicleId | null, VehicleId | null] = [null, null];
  private programBaseline = 0;

  constructor(deps: RenderBridgeDeps) {
    this.deps = deps;
    this.settings = deps.settings;
    this.preset = QUALITY_PRESETS[deps.settings.quality];
    this.sys = createRenderSystem({
      canvasHost: deps.canvasHost,
      log: deps.log,
      dprCap: this.preset.dprCap,
    });
    this.canvas = this.sys.canvas;
    this.capabilities = this.sys.capabilities;
    this.sys.onResize((s) => {
      this.onResize(s);
    });
    this.sys.onContextRestored(() => {
      this.onRestored();
    });
    this.rig.setViewport(this.sys.size.cssWidth, this.sys.size.cssHeight);
    this.applySettings(deps.settings);
  }

  get programs(): number {
    return this.programBaseline;
  }

  warmup(): Promise<void> {
    this.warming ??= this.doWarmup();
    return this.warming;
  }

  private async doWarmup(): Promise<void> {
    const a = this.deps.assets;
    if (!a.built) throw new Error('RenderBridge.warmup: assets.build() has not completed');
    const set = a.createBatches();
    const scene = new Scene();
    scene.name = 'main';
    const arena = new ArenaScene(a);
    const backdrop = new MenuBackdrop(a);
    const stage = new SelectStage(a);
    const views = new WorldViews(a, set, this.rig, FX_SEED);
    scene.add(arena.root, backdrop.root, stage.root, views.root);
    const post = new PostFX(
      this.sys.renderer,
      a.getGeometry('fx:fullscreen'),
      {
        blit: a.getMaterial('post:blit'),
        prefilter: a.getMaterial('post:prefilter'),
        down: a.getMaterial('post:down'),
        up: a.getMaterial('post:up'),
        composite: a.getMaterial('post:composite'),
      },
      {
        floatTargets: this.capabilities.floatTargets,
        msaa: this.preset.msaa,
        bloomRes: this.preset.bloomRes,
        bloomLevels: this.preset.bloomLevels,
        fxaa: this.preset.fxaa,
      },
    );
    const sh = this.deps.theme.shading;
    post.setTheme(sh.bloomStrength, sh.bloomThreshold, sh.heatShimmer);
    post.setSize(this.sys.size.width, this.sys.size.height);
    const uniforms = new FrameUniforms(a.uniforms, this.deps.theme);
    const live: Live = { scene, arena, backdrop, stage, views, post, uniforms };
    this.live = live;
    this.applySettings(this.settings);
    this.onResize(this.sys.size);
    uniforms.setSector(this.pendingSector);
    uniforms.setBeat(this.pendingBeat);
    stage.show(this.previews);
    this.applyModeVisibility();
    this.programBaseline = await this.warmLive(live);
    this.warmed = true;
  }

  /** ShaderWarmup with every live batch/ring primed, so their buffers and VAOs upload at Boot (plan 10.7). */
  private async warmLive(live: Live): Promise<number> {
    live.views.primeForWarmup();
    try {
      return await warmupShaders(this.warmDeps(live));
    } finally {
      live.views.endWarmup();
      this.applyModeVisibility();
    }
  }

  private warmDeps(live: Live): WarmupDeps {
    const { warmScene, textures } = this.deps.assets;
    const { renderer } = this.sys;
    const { camera } = this.rig;
    const { log } = this.deps;
    return { renderer, camera, post: live.post, warmScene, scenes: [live.scene], textures, log };
  }

  private ready(): Live | null {
    if (!this.warmed || this.sys.contextLost) return null;
    return this.live;
  }

  attachWorld(w: WorldView, setViewRect: ViewRectSink): void {
    const live = this.warmed ? this.live : null;
    if (live === null) return;
    live.views.clear();
    this.world = w;
    this.sink = setViewRect;
    this.rig.requestSnap();
  }

  detachWorld(): void {
    this.live?.views.clear();
    this.world = null;
    this.sink = null;
  }

  setCameraMode(m: CameraMode): void {
    this.mode = m;
    this.rig.setMode(m);
    this.applyModeVisibility();
  }

  showVehiclePreviews(sel: readonly [VehicleId | null, VehicleId | null]): void {
    this.previews = sel;
    this.live?.stage.show(sel);
  }

  consumeEvents(e: SimEvents): void {
    if (this.live === null || this.world === null) return;
    this.live.views.fx.consume(e, this.clock.time);
  }

  setSector(s: 1 | 2 | 3): void {
    this.pendingSector = s;
    this.live?.uniforms.setSector(s);
  }

  setBeat(phase: number): void {
    this.pendingBeat = phase;
    this.live?.uniforms.setBeat(phase);
  }

  frame(alpha: number, frameDt: number): void {
    const live = this.ready();
    if (live === null) return;
    if (this.frozenDim > 0) this.fade.begin(this.frozenDim);
    this.frozenDim = -1;
    const dt = frameDt > 0 ? frameDt : 0;
    this.clock.advance(dt);
    const w = this.world;
    const gameplay = this.mode === 'follow' || this.mode === 'gameover';
    live.uniforms.update(this.clock.time, gameplay ? w : null, alpha);
    const rm = this.settings.reduceMotion;
    this.rig.update(gameplay ? w : null, alpha, dt);
    const cam = this.rig.camera.position;
    live.backdrop.update(dt, rm, cam.x, cam.z);
    live.stage.update(dt, rm);
    if (w !== null && gameplay) {
      this.ctx ??= { world: w, alpha, frameDt: dt, time: 0, simTime: 0 };
      const c = this.ctx;
      c.world = w;
      c.alpha = alpha;
      c.frameDt = dt;
      c.time = this.clock.time;
      c.simTime = renderSimTime(w.time, alpha);
      live.views.sync(c, this.rig.distance, rm);
      live.post.setHurt(live.views.fx.hurt);
      live.post.setChromatic(this.settings.reduceFlashes ? 0 : live.views.fx.chromatic * 0.8);
      if (this.sink !== null && this.mode === 'follow') {
        const r = this.rig.viewRect(this.rect);
        this.sink(r.minX, r.maxX, r.minZ, r.maxZ);
      }
    } else {
      live.post.setHurt(0);
      live.post.setChromatic(0);
    }
    live.post.setTime(this.clock.time);
    this.draw(live, -1, this.fade.step(dt, this.settings.reduceFlashes));
  }

  renderFrozen(dim: number): void {
    const live = this.ready();
    if (live === null) return;
    this.frozenDim = dim < 0 ? 0 : dim;
    this.draw(live, this.frozenDim, 0);
  }

  /** frozenDim >= 0 draws the frozen (blurred + dimmed) frame; otherwise a live frame darkened by `dim`. */
  private draw(live: Live, frozenDim: number, dim: number): void {
    const r = this.sys.renderer;
    this.sys.beginFrame();
    r.setRenderTarget(live.post.sceneTarget);
    r.clear(true, true, false);
    r.render(live.scene, this.rig.camera);
    if (frozenDim >= 0) live.post.renderFrozen(null, frozenDim);
    else live.post.render(null, dim);
  }

  applySettings(s: Settings): void {
    this.settings = s;
    this.preset = QUALITY_PRESETS[s.quality];
    this.sys.setDprCap(this.preset.dprCap);
    this.rig.shake.setScale(s.screenShake);
    this.rig.setReduceMotion(s.reduceMotion);
    const live = this.live;
    if (live === null) return;
    live.post.setMsaa(this.preset.msaa);
    live.post.setBloomRes(this.preset.bloomRes, this.preset.bloomLevels);
    live.post.setFxaa(this.preset.fxaa);
    live.post.setRenderScale(1);
    live.post.setPost({
      bloomStrength: this.deps.theme.shading.bloomStrength,
      bloomThreshold: this.deps.theme.shading.bloomThreshold,
      chromatic: 0,
      vignette: LOOK.vignette,
      grain: s.reduceFlashes ? 0 : LOOK.grain,
      scanlines: LOOK.scanlines,
      freeze: 0,
      hurt: 0,
    });
    live.views.applyQuality(this.preset);
    live.views.fx.setReduceFlashes(s.reduceFlashes);
    live.uniforms.setColorblind(s.colorblind);
    live.uniforms.setReduceFlashes(s.reduceFlashes);
    this.refreeze();
  }

  applyGovernor(a: GovernorAction): void {
    const live = this.live;
    if (live === null || a.value === null) return;
    if (a.kind === 'renderScale') live.post.setRenderScale(a.value);
    else if (a.kind === 'msaa') live.post.setMsaa(a.value);
    else return;
    this.deps.log.debug('render: governor', { kind: a.kind, value: a.value });
    this.refreeze();
  }

  stats(): RenderStats {
    const post = this.live?.post;
    return this.sys.stats(post?.renderScale ?? 1, post?.msaa ?? this.preset.msaa);
  }

  dispose(): void {
    const live = this.live;
    if (live !== null) {
      live.views.dispose();
      live.post.dispose();
    }
    this.live = null;
    this.world = null;
    this.sink = null;
    this.sys.dispose();
  }

  private applyModeVisibility(): void {
    const live = this.live;
    if (live === null) return;
    const gameplay = this.mode === 'follow' || this.mode === 'gameover';
    live.backdrop.visible = this.mode === 'attract';
    live.stage.root.visible = this.mode === 'select';
    live.views.root.visible = gameplay;
    live.arena.setGameplay(gameplay);
    if (!gameplay) live.views.players.clear();
  }

  private onResize(s: Readonly<ViewportSize>): void {
    this.rig.setViewport(s.cssWidth, s.cssHeight);
    const live = this.live;
    if (live === null) return;
    live.post.setSize(s.width, s.height);
    live.uniforms.setResolution(s.cssWidth, s.cssHeight);
    this.refreeze();
  }

  /** While frozen, any change that invalidates the targets re-renders the frozen frame once. */
  private refreeze(): void {
    if (this.frozenDim < 0) return;
    const live = this.ready();
    if (live !== null) this.draw(live, this.frozenDim, 0);
  }

  private onRestored(): void {
    const live = this.live;
    if (live === null) return;
    const a = this.deps.assets;
    for (let i = 0; i < a.textures.length; i++) a.textures[i]!.needsUpdate = true;
    live.post.setSize(this.sys.size.width, this.sys.size.height);
    // Buffers are re-created from their CPU arrays on next use; the views keep their state (no priming).
    const redo = warmupShaders(this.warmDeps(live));
    redo.then(
      (n) => {
        this.programBaseline = n;
        this.refreeze();
      },
      (err: unknown) => {
        this.deps.log.error('render: warm-up after context restore failed', err);
      },
    );
  }
}

/** Creates the WebGL2 renderer and canvas immediately (capabilities are known after this call). */
export function createRenderBridge(deps: RenderBridgeDeps): RenderBridge {
  return new RenderBridgeImpl(deps);
}

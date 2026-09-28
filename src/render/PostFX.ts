/**
 * Custom post pipeline (plan section 10.5), replacing EffectComposer/UnrealBloomPass:
 *   scene -> MSAA HalfFloat target (three resolves it at the end of the pass; RGBA8 fallback without
 *   EXT_color_buffer_float) -> soft-knee prefilter at 1/2 (1/4 on Low) -> 4 dual-Kawase downsamples ->
 *   4 progressive upsamples -> one composite to the canvas (ACES, sRGB, vignette, CA, grain, scanlines,
 *   heat shimmer, dim, freeze blur, hurt, FXAA on Low).
 * 10 fullscreen draws per frame. Targets are reallocated only on resize/governor steps. The frozen frame reruns
 * the chain with threshold 0 so the bloom chain doubles as the freeze blur (no extra targets).
 */
import {
  HalfFloatType,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  RGBAFormat,
  Scene,
  UnsignedByteType,
  WebGLRenderTarget,
  type BufferGeometry,
  type IUniform,
  type ShaderMaterial,
  type WebGLRenderer,
} from 'three';
import type { PostParams } from '../contracts/render';
import { requireUniform } from './uniforms';

export const BLOOM_DOWNSAMPLES = 4;
/** prefilter level + downsamples. */
const LEVELS = BLOOM_DOWNSAMPLES + 1;
/** Soft knee as a fraction of the threshold. */
const KNEE_FRAC = 0.5;
/** RGBA8 targets clamp at 1: bloom threshold scale in the LDR fallback. */
const LDR_THRESHOLD_MUL = 0.6;

export interface PostMaterials {
  readonly blit: ShaderMaterial;
  readonly prefilter: ShaderMaterial;
  readonly down: ShaderMaterial;
  readonly up: ShaderMaterial;
  readonly composite: ShaderMaterial;
}

export interface PostFXOptions {
  readonly floatTargets: boolean;
  readonly msaa: 0 | 2 | 4;
  readonly bloomRes: number;
  readonly fxaa: boolean;
}

/** Pure: scene target size then each bloom level (prefilter + downsamples) as [w, h] pairs into out. */
export function computePostSizes(
  width: number,
  height: number,
  renderScale: number,
  bloomRes: number,
  out: Int32Array,
): Int32Array {
  const sw = Math.max(1, Math.round(width * renderScale));
  const sh = Math.max(1, Math.round(height * renderScale));
  out[0] = sw;
  out[1] = sh;
  let bw = Math.max(1, Math.round(sw * bloomRes));
  let bh = Math.max(1, Math.round(sh * bloomRes));
  for (let i = 0; i < LEVELS; i++) {
    out[2 + i * 2] = bw;
    out[3 + i * 2] = bh;
    bw = Math.max(1, bw >> 1);
    bh = Math.max(1, bh >> 1);
  }
  return out;
}

interface Texel {
  x: number;
  y: number;
}

function makeTarget(float: boolean, depth: boolean, samples: number): WebGLRenderTarget {
  return new WebGLRenderTarget(1, 1, {
    type: float ? HalfFloatType : UnsignedByteType,
    format: RGBAFormat,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    generateMipmaps: false,
    depthBuffer: depth,
    stencilBuffer: false,
    samples,
  });
}

export class PostFX {
  readonly sceneTarget: WebGLRenderTarget;
  private readonly renderer: WebGLRenderer;
  private readonly mats: PostMaterials;
  private readonly levels: WebGLRenderTarget[] = [];
  private readonly ups: WebGLRenderTarget[] = [];
  private readonly texels: Texel[] = [];
  private readonly sceneTexel: Texel = { x: 1, y: 1 };
  private readonly sceneSize: Texel = { x: 1, y: 1 };
  private readonly sizes = new Int32Array(2 + LEVELS * 2);
  private readonly quad: Mesh;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly float: boolean;
  private width = 1;
  private height = 1;
  private scale = 1;
  private bloomRes: number;
  private samples: number;
  private threshold = 0.8;
  // Uniform handles (resolved once).
  private readonly uPreInput: IUniform;
  private readonly uPreTexel: IUniform;
  private readonly uPreThreshold: IUniform;
  private readonly uPreKnee: IUniform;
  private readonly uDownInput: IUniform;
  private readonly uDownTexel: IUniform;
  private readonly uUpInput: IUniform;
  private readonly uUpSkip: IUniform;
  private readonly uUpTexel: IUniform;
  private readonly uScene: IUniform;
  private readonly uBloom: IUniform;
  private readonly uSceneSize: IUniform;
  private readonly uStrength: IUniform;
  private readonly uCompThreshold: IUniform;
  private readonly uVignette: IUniform;
  private readonly uChromatic: IUniform;
  private readonly uGrain: IUniform;
  private readonly uScanlines: IUniform;
  private readonly uShimmer: IUniform;
  private readonly uTime: IUniform;
  private readonly uFreeze: IUniform;
  private readonly uDim: IUniform;
  private readonly uHurt: IUniform;
  private readonly uFxaa: IUniform;
  private readonly uBlitInput: IUniform;

  constructor(renderer: WebGLRenderer, fullscreen: BufferGeometry, mats: PostMaterials, opts: PostFXOptions) {
    this.renderer = renderer;
    this.mats = mats;
    this.float = opts.floatTargets;
    this.samples = opts.msaa;
    this.bloomRes = opts.bloomRes;
    this.sceneTarget = makeTarget(this.float, true, this.samples);
    for (let i = 0; i < LEVELS; i++) {
      this.levels.push(makeTarget(this.float, false, 0));
      this.texels.push({ x: 1, y: 1 });
      if (i < BLOOM_DOWNSAMPLES) this.ups.push(makeTarget(this.float, false, 0));
    }
    const all = [mats.blit, mats.prefilter, mats.down, mats.up, mats.composite];
    for (const m of all) {
      m.depthTest = false;
      m.depthWrite = false;
      m.transparent = false;
    }
    this.quad = new Mesh(fullscreen, mats.composite);
    this.quad.frustumCulled = false;
    this.quad.matrixAutoUpdate = false;
    this.scene.add(this.quad);
    this.scene.matrixWorldAutoUpdate = false;

    this.uPreInput = requireUniform(mats.prefilter, 'tInput');
    this.uPreTexel = requireUniform(mats.prefilter, 'uTexel');
    this.uPreThreshold = requireUniform(mats.prefilter, 'uThreshold');
    this.uPreKnee = requireUniform(mats.prefilter, 'uKnee');
    this.uDownInput = requireUniform(mats.down, 'tInput');
    this.uDownTexel = requireUniform(mats.down, 'uTexel');
    this.uUpInput = requireUniform(mats.up, 'tInput');
    this.uUpSkip = requireUniform(mats.up, 'tSkip');
    this.uUpTexel = requireUniform(mats.up, 'uTexel');
    const c = mats.composite;
    this.uScene = requireUniform(c, 'tScene');
    this.uBloom = requireUniform(c, 'tBloom');
    this.uSceneSize = requireUniform(c, 'uSceneSize');
    this.uStrength = requireUniform(c, 'uBloomStrength');
    this.uCompThreshold = requireUniform(c, 'uBloomThreshold');
    this.uVignette = requireUniform(c, 'uVignette');
    this.uChromatic = requireUniform(c, 'uChromatic');
    this.uGrain = requireUniform(c, 'uGrain');
    this.uScanlines = requireUniform(c, 'uScanlines');
    this.uShimmer = requireUniform(c, 'uShimmer');
    this.uTime = requireUniform(c, 'uPostTime');
    this.uFreeze = requireUniform(c, 'uFreeze');
    this.uDim = requireUniform(c, 'uDim');
    this.uHurt = requireUniform(c, 'uHurt');
    this.uFxaa = requireUniform(c, 'uFxaa');
    this.uBlitInput = requireUniform(mats.blit, 'tInput');
    requireUniform(c, 'uExposure').value = 1;
    this.uSceneSize.value = this.sceneSize;
    this.uFxaa.value = opts.fxaa ? 1 : 0;
    this.setThreshold(0.8);
  }

  get renderScale(): number {
    return this.scale;
  }

  get msaa(): number {
    return this.samples;
  }

  get sceneWidth(): number {
    return this.sizes[0]!;
  }

  get sceneHeight(): number {
    return this.sizes[1]!;
  }

  /** Canvas backing size in pixels; the scene renders at this x renderScale. */
  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.reallocate();
  }

  setRenderScale(s: number): void {
    const v = s > 0.25 ? (s < 1 ? s : 1) : 0.25;
    if (v === this.scale) return;
    this.scale = v;
    this.reallocate();
  }

  setMsaa(samples: number): void {
    const n = samples >= 4 ? 4 : samples >= 2 ? 2 : 0;
    if (n === this.samples) return;
    this.samples = n;
    this.sceneTarget.samples = n;
    this.sceneTarget.dispose();
  }

  setBloomRes(r: number): void {
    if (r === this.bloomRes) return;
    this.bloomRes = r;
    this.reallocate();
  }

  setFxaa(on: boolean): void {
    this.uFxaa.value = on ? 1 : 0;
  }

  /** Theme bloom strength/threshold and heat shimmer. */
  setTheme(strength: number, threshold: number, shimmer: number): void {
    this.uStrength.value = strength;
    this.uShimmer.value = shimmer;
    this.setThreshold(threshold);
  }

  setPost(p: PostParams): void {
    this.uStrength.value = p.bloomStrength;
    this.setThreshold(p.bloomThreshold);
    this.uChromatic.value = p.chromatic;
    this.uVignette.value = p.vignette;
    this.uGrain.value = p.grain;
    this.uScanlines.value = p.scanlines;
    this.uFreeze.value = p.freeze;
    this.uHurt.value = p.hurt;
  }

  setHurt(h: number): void {
    this.uHurt.value = h;
  }

  setChromatic(c: number): void {
    this.uChromatic.value = c;
  }

  /** Wrapped seconds (grain, shimmer). */
  setTime(t: number): void {
    this.uTime.value = t;
  }

  /**
   * Runs bloom + composite from sceneTarget into `output` (null = canvas). `dim` (0..1) darkens the live frame:
   * the fade back from a frozen overlay frame (render/unfreezeFade.ts).
   */
  render(output: WebGLRenderTarget | null, dim = 0): void {
    this.uFreeze.value = 0;
    this.uDim.value = dim > 0 ? (dim < 1 ? dim : 1) : 0;
    this.uPreThreshold.value = this.effectiveThreshold();
    this.runChain();
    this.composite(output);
  }

  /** One frozen frame: the chain blurs the whole scene; composite mixes blur + dim. */
  renderFrozen(output: WebGLRenderTarget | null, dim: number): void {
    this.uPreThreshold.value = 0;
    this.runChain();
    this.uFreeze.value = 1;
    this.uDim.value = dim < 0 ? 0 : dim > 1 ? 1 : dim;
    this.composite(output);
    this.uFreeze.value = 0;
    this.uDim.value = 0;
    this.uPreThreshold.value = this.effectiveThreshold();
  }

  /** Copies a texture to `output` (warm-up of the blit program, debug views). */
  blit(input: WebGLRenderTarget, output: WebGLRenderTarget | null): void {
    this.uBlitInput.value = input.texture;
    this.pass(this.mats.blit, output);
  }

  dispose(): void {
    this.sceneTarget.dispose();
    for (const t of this.levels) t.dispose();
    for (const t of this.ups) t.dispose();
    this.scene.remove(this.quad);
  }

  private effectiveThreshold(): number {
    return this.float ? this.threshold : this.threshold * LDR_THRESHOLD_MUL;
  }

  private setThreshold(t: number): void {
    this.threshold = t;
    const eff = this.effectiveThreshold();
    this.uPreThreshold.value = eff;
    this.uPreKnee.value = eff * KNEE_FRAC;
    this.uCompThreshold.value = eff;
  }

  private reallocate(): void {
    const s = computePostSizes(this.width, this.height, this.scale, this.bloomRes, this.sizes);
    this.sceneTarget.setSize(s[0]!, s[1]!);
    this.sceneSize.x = s[0]!;
    this.sceneSize.y = s[1]!;
    this.sceneTexel.x = 1 / s[0]!;
    this.sceneTexel.y = 1 / s[1]!;
    for (let i = 0; i < LEVELS; i++) {
      const w = s[2 + i * 2]!;
      const h = s[3 + i * 2]!;
      this.levels[i]!.setSize(w, h);
      if (i < BLOOM_DOWNSAMPLES) this.ups[i]!.setSize(w, h);
      const t = this.texels[i]!;
      t.x = 1 / w;
      t.y = 1 / h;
    }
  }

  private runChain(): void {
    const lv = this.levels;
    this.uPreInput.value = this.sceneTarget.texture;
    this.uPreTexel.value = this.sceneTexel;
    this.pass(this.mats.prefilter, lv[0]!);
    for (let i = 1; i < LEVELS; i++) {
      this.uDownInput.value = lv[i - 1]!.texture;
      this.uDownTexel.value = this.texels[i - 1];
      this.pass(this.mats.down, lv[i]!);
    }
    for (let i = BLOOM_DOWNSAMPLES - 1; i >= 0; i--) {
      const src = i === BLOOM_DOWNSAMPLES - 1 ? lv[LEVELS - 1]! : this.ups[i + 1]!;
      this.uUpInput.value = src.texture;
      this.uUpTexel.value = this.texels[i + 1];
      this.uUpSkip.value = lv[i]!.texture;
      this.pass(this.mats.up, this.ups[i]!);
    }
  }

  private composite(output: WebGLRenderTarget | null): void {
    this.uScene.value = this.sceneTarget.texture;
    this.uBloom.value = this.ups[0]!.texture;
    this.pass(this.mats.composite, output);
  }

  private pass(mat: ShaderMaterial, target: WebGLRenderTarget | null): void {
    this.quad.material = mat;
    mat.uniformsNeedUpdate = true;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }
}

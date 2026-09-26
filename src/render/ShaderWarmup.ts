/**
 * Shader and asset warm-up (plan section 10.6): compileAsync over the asset library's warm scene (every
 * material x geometry x instancing variant) and over the bridge's own scenes, with the HDR scene target bound so
 * program keys match the real frame; initTexture for every DataTexture; then 2 full-size offscreen frames through
 * PostFX (which compiles the post programs and allocates every target). Returns the program-count baseline.
 */
import type { Camera, DataTexture, Object3D, Scene, WebGLRenderer } from 'three';
import type { Logger } from '../contracts/ids';
import type { PostFX } from './PostFX';

export interface WarmupDeps {
  readonly renderer: WebGLRenderer;
  readonly camera: Camera;
  readonly post: PostFX;
  /** Library warm scene (compiled, then drawn in the offscreen frames). */
  readonly warmScene: Object3D;
  /** The bridge's scenes (compiled so their exact program keys exist). */
  readonly scenes: readonly Scene[];
  readonly textures: readonly DataTexture[];
  readonly log: Logger;
}

/** Number of offscreen frames rendered through PostFX. */
export const WARMUP_FRAMES = 2;

export async function warmupShaders(d: WarmupDeps): Promise<number> {
  const r = d.renderer;
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  r.setRenderTarget(d.post.sceneTarget);
  await r.compileAsync(d.warmScene, d.camera);
  for (let i = 0; i < d.scenes.length; i++) {
    r.setRenderTarget(d.post.sceneTarget);
    await r.compileAsync(d.scenes[i]!, d.camera);
  }
  for (let i = 0; i < d.textures.length; i++) {
    const tex = d.textures[i]!;
    r.initTexture(tex);
  }
  d.post.blit(d.post.sceneTarget, null);
  for (let f = 0; f < WARMUP_FRAMES; f++) {
    r.setRenderTarget(d.post.sceneTarget);
    r.clear(true, true, false);
    r.render(d.warmScene, d.camera);
    for (let i = 0; i < d.scenes.length; i++) r.render(d.scenes[i]!, d.camera);
    d.post.render(null);
  }
  r.setRenderTarget(null);
  const programs = r.info.programs === null ? 0 : r.info.programs.length;
  const ms = typeof performance !== 'undefined' ? performance.now() - t0 : 0;
  d.log.info('render: shader warm-up done', { programs, ms: Math.round(ms) });
  return programs;
}

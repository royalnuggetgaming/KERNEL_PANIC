/**
 * Post-processing sources (plan section 10.5), owned by W1-RENDER. assets/materials.ts turns each ShaderSource into
 * the GLSL3 ShaderMaterial for the matching `post:*` MaterialKey (post:blit, post:prefilter, post:down, post:up);
 * render/PostFX.ts drives the uniforms declared here. All passes draw the `fx:fullscreen` geometry whose
 * `position.xy` is already in clip space (a big triangle or a [-1, 1] quad both work).
 *
 * Uniform values are plain structural objects (vec2 = {x, y}) because shaders/ may not import three; three's
 * uniform upload accepts any object with x/y fields.
 */
import type { ShaderSource, UniformSlot } from '../shaderSource';

export interface Vec2Value {
  x: number;
  y: number;
}

/** Full-screen vertex shader shared by every post pass. */
export const FULLSCREEN_VERT = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export interface BlitUniforms extends Record<string, UniformSlot> {
  tInput: UniformSlot<unknown>;
  uIntensity: UniformSlot<number>;
}

/** Plain copy (optionally scaled): frozen-frame copies and the RGBA8 fallback path. */
export const BLIT: ShaderSource<BlitUniforms> = {
  name: 'post:blit',
  vertex: FULLSCREEN_VERT,
  fragment: /* glsl */ `
uniform sampler2D tInput;
uniform float uIntensity;
in vec2 vUv;
out vec4 outColor;
void main() {
  outColor = vec4(texture(tInput, vUv).rgb * uIntensity, 1.0);
}
`,
  defines: {},
  createUniforms: () => ({ tInput: { value: null }, uIntensity: { value: 1 } }),
};

export interface PrefilterUniforms extends Record<string, UniformSlot> {
  tInput: UniformSlot<unknown>;
  /** Source texel size (1 / source pixels). */
  uTexel: UniformSlot<Vec2Value>;
  uThreshold: UniformSlot<number>;
  /** Soft-knee width (0 = hard threshold). */
  uKnee: UniformSlot<number>;
}

/**
 * Soft-knee bright pass with a 4-tap Karis-weighted box downsample (fireflies suppressed), writing the first
 * bloom level at 1/2 (or 1/4 on Low) resolution. Threshold 0 turns it into a plain blur source (frozen frame).
 */
export const BLOOM_PREFILTER: ShaderSource<PrefilterUniforms> = {
  name: 'post:prefilter',
  vertex: FULLSCREEN_VERT,
  fragment: /* glsl */ `
uniform sampler2D tInput;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uKnee;
in vec2 vUv;
out vec4 outColor;

float kpLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 kpSoftKnee(vec3 c) {
  float br = max(c.r, max(c.g, c.b));
  float knee = max(uKnee, 1e-4);
  float rq = clamp(br - uThreshold + knee, 0.0, 2.0 * knee);
  rq = rq * rq / (4.0 * knee + 1e-4);
  float contrib = max(rq, br - uThreshold) / max(br, 1e-4);
  return c * contrib;
}

void main() {
  vec4 o = uTexel.xyxy * vec4(-1.0, -1.0, 1.0, 1.0);
  vec3 a = min(texture(tInput, vUv + o.xy).rgb, vec3(256.0));
  vec3 b = min(texture(tInput, vUv + o.zy).rgb, vec3(256.0));
  vec3 c = min(texture(tInput, vUv + o.xw).rgb, vec3(256.0));
  vec3 d = min(texture(tInput, vUv + o.zw).rgb, vec3(256.0));
  float wa = 1.0 / (1.0 + kpLuma(a));
  float wb = 1.0 / (1.0 + kpLuma(b));
  float wc = 1.0 / (1.0 + kpLuma(c));
  float wd = 1.0 / (1.0 + kpLuma(d));
  vec3 avg = (a * wa + b * wb + c * wc + d * wd) / max(wa + wb + wc + wd, 1e-4);
  vec3 col = uThreshold > 0.0 ? kpSoftKnee(avg) : avg;
  outColor = vec4(max(col, vec3(0.0)), 1.0);
}
`,
  defines: {},
  createUniforms: () => ({
    tInput: { value: null },
    uTexel: { value: { x: 1, y: 1 } },
    uThreshold: { value: 0.8 },
    uKnee: { value: 0.4 },
  }),
};

export interface KawaseUniforms extends Record<string, UniformSlot> {
  tInput: UniformSlot<unknown>;
  /** Source texel size. */
  uTexel: UniformSlot<Vec2Value>;
  /** Tap offset in source texels (1 = classic dual filter). */
  uOffset: UniformSlot<number>;
}

/** Dual-Kawase downsample: centre x4 plus 4 diagonal half-texel taps, / 8. */
export const KAWASE_DOWN: ShaderSource<KawaseUniforms> = {
  name: 'post:down',
  vertex: FULLSCREEN_VERT,
  fragment: /* glsl */ `
uniform sampler2D tInput;
uniform vec2 uTexel;
uniform float uOffset;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec2 h = uTexel * 0.5 * uOffset;
  vec3 s = texture(tInput, vUv).rgb * 4.0;
  s += texture(tInput, vUv - h).rgb;
  s += texture(tInput, vUv + h).rgb;
  s += texture(tInput, vUv + vec2(h.x, -h.y)).rgb;
  s += texture(tInput, vUv - vec2(h.x, -h.y)).rgb;
  outColor = vec4(s * 0.125, 1.0);
}
`,
  defines: {},
  createUniforms: () => ({
    tInput: { value: null },
    uTexel: { value: { x: 1, y: 1 } },
    uOffset: { value: 1 },
  }),
};

export interface KawaseUpUniforms extends KawaseUniforms {
  /** Same-resolution level of the down chain, added back (progressive upsample). */
  tSkip: UniformSlot<unknown>;
  uSkipWeight: UniformSlot<number>;
}

/** Dual-Kawase upsample: 8-tap tent (4 edge x1, 4 diagonal x2, / 12) plus the skip level. */
export const KAWASE_UP: ShaderSource<KawaseUpUniforms> = {
  name: 'post:up',
  vertex: FULLSCREEN_VERT,
  fragment: /* glsl */ `
uniform sampler2D tInput;
uniform sampler2D tSkip;
uniform vec2 uTexel;
uniform float uOffset;
uniform float uSkipWeight;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec2 h = uTexel * 0.5 * uOffset;
  vec3 s = texture(tInput, vUv + vec2(-h.x * 2.0, 0.0)).rgb;
  s += texture(tInput, vUv + vec2(-h.x, h.y)).rgb * 2.0;
  s += texture(tInput, vUv + vec2(0.0, h.y * 2.0)).rgb;
  s += texture(tInput, vUv + vec2(h.x, h.y)).rgb * 2.0;
  s += texture(tInput, vUv + vec2(h.x * 2.0, 0.0)).rgb;
  s += texture(tInput, vUv + vec2(h.x, -h.y)).rgb * 2.0;
  s += texture(tInput, vUv + vec2(0.0, -h.y * 2.0)).rgb;
  s += texture(tInput, vUv + vec2(-h.x, -h.y)).rgb * 2.0;
  vec3 col = s / 12.0 + texture(tSkip, vUv).rgb * uSkipWeight;
  outColor = vec4(col, 1.0);
}
`,
  defines: {},
  createUniforms: () => ({
    tInput: { value: null },
    tSkip: { value: null },
    uTexel: { value: { x: 1, y: 1 } },
    uOffset: { value: 1 },
    uSkipWeight: { value: 1 },
  }),
};

/** Number of bloom levels summed by the progressive upsample (prefilter + 4 downsamples). */
export const BLOOM_LEVELS = 5;

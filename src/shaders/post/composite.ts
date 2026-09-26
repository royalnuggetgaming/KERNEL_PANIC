/**
 * Single composite pass (plan section 10.5): scene + bloom, heat shimmer, chromatic aberration (scaled up by the
 * hurt amount), optional FXAA (Low preset, uniform branch so the program never changes), ACES filmic tonemapping,
 * sRGB encode, vignette, hurt vignette, scanlines, grain, and the frozen-frame dim + blur mix. In a frozen frame the
 * prefilter runs with threshold 0, so tBloom holds a blurred copy of the whole scene: the composite mixes it in and
 * re-derives the glow from it by thresholding here. Uniform names avoid the shared-uniform names (uTime,
 * uResolution) so a material builder can merge SharedUniforms without collisions.
 */
import type { ShaderSource, UniformSlot } from '../shaderSource';
import { BLOOM_LEVELS, FULLSCREEN_VERT, type Vec2Value } from './bloom';

export interface CompositeUniforms extends Record<string, UniformSlot> {
  tScene: UniformSlot<unknown>;
  tBloom: UniformSlot<unknown>;
  /** Scene target size in pixels (FXAA texel). */
  uSceneSize: UniformSlot<Vec2Value>;
  uBloomStrength: UniformSlot<number>;
  /** Used to re-derive glow from the blurred scene in a frozen frame. */
  uBloomThreshold: UniformSlot<number>;
  uExposure: UniformSlot<number>;
  uVignette: UniformSlot<number>;
  uChromatic: UniformSlot<number>;
  uGrain: UniformSlot<number>;
  uScanlines: UniformSlot<number>;
  uShimmer: UniformSlot<number>;
  /** Wrapped seconds for grain/shimmer. */
  uPostTime: UniformSlot<number>;
  /** 0 live .. 1 frozen (blur mix). */
  uFreeze: UniformSlot<number>;
  /** 0..1 brightness reduction of the frozen frame. */
  uDim: UniformSlot<number>;
  uHurt: UniformSlot<number>;
  /** 1 = FXAA path (Low preset). */
  uFxaa: UniformSlot<number>;
}

export const COMPOSITE: ShaderSource<CompositeUniforms> = {
  name: 'post:composite',
  vertex: FULLSCREEN_VERT,
  fragment: /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform vec2 uSceneSize;
uniform float uBloomStrength;
uniform float uBloomThreshold;
uniform float uExposure;
uniform float uVignette;
uniform float uChromatic;
uniform float uGrain;
uniform float uScanlines;
uniform float uShimmer;
uniform float uPostTime;
uniform float uFreeze;
uniform float uDim;
uniform float uHurt;
uniform float uFxaa;
in vec2 vUv;
out vec4 outColor;

const float KP_BLOOM_NORM = 1.0 / ${BLOOM_LEVELS.toFixed(1)};

const mat3 KP_ACES_IN = mat3(
  vec3(0.59719, 0.07600, 0.02840),
  vec3(0.35458, 0.90834, 0.13383),
  vec3(0.04823, 0.01566, 0.83777)
);
const mat3 KP_ACES_OUT = mat3(
  vec3(1.60475, -0.10208, -0.00327),
  vec3(-0.53108, 1.10813, -0.07276),
  vec3(-0.07367, -0.00605, 1.07602)
);

vec3 kpRrtOdt(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}

vec3 kpAces(vec3 c) {
  c *= uExposure / 0.6;
  c = KP_ACES_IN * c;
  c = kpRrtOdt(c);
  c = KP_ACES_OUT * c;
  return clamp(c, 0.0, 1.0);
}

vec3 kpToSrgb(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return mix(hi, lo, vec3(lessThanEqual(c, vec3(0.0031308))));
}

float kpLumaT(vec3 c) {
  vec3 t = c / (1.0 + c);
  return dot(t, vec3(0.299, 0.587, 0.114));
}

float kpHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 kpScene(vec2 uv) { return texture(tScene, uv).rgb; }

// FXAA (low preset): edge-directed blend on the HDR scene using tonemapped luma.
vec3 kpFxaa(vec2 uv) {
  vec2 px = 1.0 / max(uSceneSize, vec2(1.0));
  vec3 cM = kpScene(uv);
  float lM = kpLumaT(cM);
  float lNW = kpLumaT(kpScene(uv + vec2(-px.x, -px.y)));
  float lNE = kpLumaT(kpScene(uv + vec2(px.x, -px.y)));
  float lSW = kpLumaT(kpScene(uv + vec2(-px.x, px.y)));
  float lSE = kpLumaT(kpScene(uv + vec2(px.x, px.y)));
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  if (lMax - lMin < max(0.0312, lMax * 0.125)) return cM;
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
  float reduce = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
  float rcpMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
  dir = clamp(dir * rcpMin, vec2(-8.0), vec2(8.0)) * px;
  vec3 a = 0.5 * (kpScene(uv + dir * (1.0 / 3.0 - 0.5)) + kpScene(uv + dir * (2.0 / 3.0 - 0.5)));
  vec3 b = a * 0.5 + 0.25 * (kpScene(uv - dir * 0.5) + kpScene(uv + dir * 0.5));
  float lB = kpLumaT(b);
  return (lB < lMin || lB > lMax) ? a : b;
}

void main() {
  vec2 uv = vUv;
  if (uShimmer > 0.0) {
    uv += vec2(sin(uv.y * 43.0 + uPostTime * 3.1), cos(uv.x * 37.0 + uPostTime * 2.3)) * 0.0016 * uShimmer;
  }
  vec2 fromC = uv - 0.5;
  float r = length(fromC);

  vec3 scene;
  if (uFxaa > 0.5) {
    scene = kpFxaa(uv);
  } else {
    float ca = (uChromatic + uHurt * 0.6) * 0.012 * r;
    vec2 off = fromC * ca;
    scene = vec3(kpScene(uv + off).r, kpScene(uv).g, kpScene(uv - off).b);
  }

  vec3 blurred = texture(tBloom, uv).rgb * KP_BLOOM_NORM;
  vec3 glowLive = blurred;
  vec3 glowFrozen = max(blurred - vec3(uBloomThreshold), vec3(0.0));
  vec3 glow = mix(glowLive, glowFrozen, uFreeze) * uBloomStrength;
  vec3 hdr = mix(scene, blurred, uFreeze * 0.85) + glow;

  vec3 ldr = kpAces(hdr);

  float vig = smoothstep(0.85, 0.25, r * (1.0 + uVignette * 0.35));
  ldr *= mix(1.0, vig, uVignette);
  float hurtMask = smoothstep(0.3, 0.75, r);
  ldr = mix(ldr, vec3(0.85, 0.04, 0.08), hurtMask * clamp(uHurt, 0.0, 1.0) * 0.55);
  ldr *= 1.0 - uScanlines * (0.5 + 0.5 * sin(gl_FragCoord.y * 3.14159265));
  ldr *= 1.0 - clamp(uDim, 0.0, 1.0);
  ldr = clamp(ldr, 0.0, 1.0);

  vec3 outRgb = kpToSrgb(ldr);
  outRgb += (kpHash(gl_FragCoord.xy + fract(uPostTime) * 97.0) - 0.5) * uGrain;
  outColor = vec4(clamp(outRgb, 0.0, 1.0), 1.0);
}
`,
  defines: {},
  createUniforms: () => ({
    tScene: { value: null },
    tBloom: { value: null },
    uSceneSize: { value: { x: 1, y: 1 } },
    uBloomStrength: { value: 0.9 },
    uBloomThreshold: { value: 0.8 },
    uExposure: { value: 1 },
    uVignette: { value: 0.35 },
    uChromatic: { value: 0 },
    uGrain: { value: 0.035 },
    uScanlines: { value: 0.06 },
    uShimmer: { value: 0 },
    uPostTime: { value: 0 },
    uFreeze: { value: 0 },
    uDim: { value: 0 },
    uHurt: { value: 0 },
    uFxaa: { value: 0 },
  }),
};

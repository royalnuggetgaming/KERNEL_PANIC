/**
 * Shockwaves: expanding ground rings from a write-once ring record (shaders/ringLayouts.ts SHOCKWAVE_RECORD).
 * The fx:quad (XY in [-0.5, 0.5]) is laid flat on the ground and scaled to the current radius; the ring is an
 * antialiased SDF band with an ease-out radius, a hot leading edge and a hex-shimmer interior. Additive.
 */
import { GLSL_COMMON } from './chunks/common';
import { GLSL_LIGHTING } from './chunks/lighting';
import type { ShaderSource, UniformSlot } from './shaderSource';
import { createCommonUniforms, type CommonUniforms } from './tints';

export type ShockwaveUniforms = CommonUniforms & {
  /** Height above the floor (u). */
  readonly uHeight: UniformSlot<number>;
};

const VERTEX = /* glsl */ `
${GLSL_COMMON}
uniform float uHeight;
in vec4 aW0;
in vec4 aW1;

out vec2 vLocal;
out float vRadius;
out float vWidth;
out float vFade;
out float vTint;
out vec3 vWorld;

void main() {
  float life = aW0.w;
  float age = uTime - aW0.z;
  if (life <= 0.0 || age < 0.0 || age > life) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vLocal = vec2(0.0);
    vRadius = 0.0;
    vWidth = 1.0;
    vFade = 0.0;
    vTint = 0.0;
    vWorld = vec3(0.0);
    return;
  }
  float x = age / life;
  float ease = 1.0 - pow(1.0 - x, 3.0);
  float radius = aW1.x * ease;
  float width = aW1.y * (1.0 - 0.6 * x);
  float extent = radius + width * 2.0;
  vec2 local = position.xy * 2.0 * extent;
  vec4 wp = modelMatrix * vec4(aW0.x + local.x, uHeight, aW0.y + local.y, 1.0);
  vLocal = local;
  vRadius = radius;
  vWidth = width;
  vFade = (1.0 - x) * aW1.w;
  vTint = aW1.z;
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAGMENT = /* glsl */ `
${GLSL_COMMON}
${GLSL_LIGHTING}
in vec2 vLocal;
in float vRadius;
in float vWidth;
in float vFade;
in float vTint;
in vec3 vWorld;
out vec4 fragColor;

void main() {
  float r = length(vLocal);
  float d = abs(r - vRadius) - vWidth * 0.5;
  float aa = fwidth(r) + 1e-4;
  float band = 1.0 - smoothstep(-aa, aa, d);
  float glow = exp(-max(d, 0.0) / max(vWidth, 0.05) * 2.5) * 0.5;
  float lead = smoothstep(vRadius - vWidth * 0.5, vRadius + vWidth * 0.5, r) * band;
  float inner = r < vRadius ? 0.06 * (0.5 + 0.5 * sin(r * 6.0 - uTime * 12.0)) : 0.0;
  vec3 tintC = kpTintColor(vTint);
  float m = (band + glow + inner) * vFade;
  vec3 col = tintC * m * 1.8 + vec3(1.0) * lead * vFade * 0.8;
  col = kpFadeFog(col, length(vWorld - cameraPosition));
  fragColor = vec4(col, kpSaturate(m));
}
`;

export const SHOCKWAVE: ShaderSource<ShockwaveUniforms> = {
  name: 'shockwave',
  vertex: VERTEX,
  fragment: FRAGMENT,
  defines: {},
  createUniforms(): ShockwaveUniforms {
    return { ...createCommonUniforms(), uHeight: { value: 0.06 } };
  },
};

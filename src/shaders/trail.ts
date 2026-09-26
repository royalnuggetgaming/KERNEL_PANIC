/**
 * Player trails: 64-segment ribbons (geometry fx:trail:<p>). render/fx/TrailRenderer rewrites the world-space
 * `position` attribute each frame (both ribbon edges per segment); uv.x runs 0 at the head to 1 at the tail,
 * uv.y is 0/1 across; the per-geometry attribute aTint holds the player's tint slot. Additive ribbon fade.
 */
import { GLSL_COMMON } from './chunks/common';
import { GLSL_LIGHTING } from './chunks/lighting';
import type { ShaderSource, UniformSlot } from './shaderSource';
import { createCommonUniforms, type CommonUniforms } from './tints';

export type TrailUniforms = CommonUniforms & {
  /** Overall trail intensity (0 hides, e.g. while a player is offline). */
  readonly uIntensity: UniformSlot<number>;
};

const VERTEX = /* glsl */ `
${GLSL_COMMON}
in float aTint;
out vec2 vUv;
out float vTint;
out vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vUv = uv;
  vTint = aTint;
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAGMENT = /* glsl */ `
${GLSL_COMMON}
${GLSL_LIGHTING}
uniform float uIntensity;
in vec2 vUv;
in float vTint;
in vec3 vWorld;
out vec4 fragColor;
void main() {
  float along = 1.0 - kpSaturate(vUv.x);
  float across = abs(vUv.y * 2.0 - 1.0);
  float core = 1.0 - smoothstep(0.0, 0.35, across);
  float soft = 1.0 - across * across;
  float m = pow(along, 1.6) * soft * uIntensity;
  float scan = 0.85 + 0.15 * sin(vUv.x * 60.0 - uTime * 20.0);
  vec3 tintC = kpTintColor(vTint);
  vec3 col = (tintC * 1.3 * scan + vec3(0.5) * core * along) * m;
  col = kpFadeFog(col, length(vWorld - cameraPosition));
  fragColor = vec4(col, kpSaturate(m));
}
`;

export const TRAIL: ShaderSource<TrailUniforms> = {
  name: 'trail',
  vertex: VERTEX,
  fragment: FRAGMENT,
  defines: {},
  createUniforms(): TrailUniforms {
    return { ...createCommonUniforms(), uIntensity: { value: 1 } };
  },
};

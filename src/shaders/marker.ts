/**
 * Player markers at a constant screen size: the P1/P2 chevron above each craft plus progress arcs (bleed-out,
 * revive, dash and special charge). The fx:quad is expanded in clip space from the projected anchor, so the
 * marker keeps its pixel size at any camera distance. Drawn on top (depthTest off), additive.
 *
 * Instance record: aT = (x, z, yaw (unused), size px); aS = (progress 0..1, anchor height u,
 * style = encodeStyle(MARKER_KIND.*, tint slot), seed). size <= 0 hides the instance.
 */
import { GLSL_COMMON } from './chunks/common';
import { GLSL_INSTANCING } from './chunks/instancing';
import type { ShaderSource } from './shaderSource';
import { createCommonUniforms, type CommonUniforms } from './tints';

export const MARKER_KIND = { CHEVRON: 0, BLEED: 1, REVIVE: 2, DASH: 3, SPECIAL: 4 } as const;

export type MarkerUniforms = CommonUniforms;

const VERTEX = /* glsl */ `
${GLSL_COMMON}
${GLSL_INSTANCING}
out vec2 vUv;
out float vProgress;
out float vKind;
out float vTint;

void main() {
  float sizePx = aT.w;
  if (sizePx <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vUv = vec2(0.0);
    vProgress = 0.0;
    vKind = 0.0;
    vTint = 0.0;
    return;
  }
  vec4 clip = projectionMatrix * viewMatrix * modelMatrix * vec4(aT.x, aS.y, aT.y, 1.0);
  vec2 px = 2.0 / max(uResolution, vec2(1.0));
  clip.xy += position.xy * sizePx * px * clip.w;
  vUv = position.xy * 2.0;
  vProgress = aS.x;
  vKind = floor(aS.z / 16.0);
  vTint = mod(aS.z, 16.0);
  gl_Position = clip;
}
`;

const FRAGMENT = /* glsl */ `
${GLSL_COMMON}
in vec2 vUv;
in float vProgress;
in float vKind;
in float vTint;
out vec4 fragColor;

void main() {
  int kind = int(vKind + 0.5);
  vec3 tintC = kpTintColor(vTint);
  float r = length(vUv);
  float aa = fwidth(r) * 1.5 + 1e-4;
  float m = 0.0;
  if (kind == 0) {
    // Downward chevron: two strokes meeting at the bottom, bobbing slightly.
    vec2 p = vUv - vec2(0.0, 0.1 * sin(uTime * 4.0));
    float d1 = abs(p.y + 0.35 - abs(p.x) * 1.2);
    float body = (1.0 - smoothstep(0.12, 0.12 + aa, d1)) * step(abs(p.x), 0.7);
    float fill = step(p.y + 0.35 - abs(p.x) * 1.2, 0.0) * step(-0.35, p.y) * step(abs(p.x), 0.7) * 0.25;
    m = body * 1.3 + fill;
  } else {
    // Progress arc clockwise from 12 o'clock.
    float ang = atan(vUv.x, vUv.y) / KP_TAU;
    ang = ang < 0.0 ? ang + 1.0 : ang;
    float ring = 1.0 - smoothstep(0.1, 0.1 + aa, abs(r - 0.8));
    float filled = step(ang, vProgress);
    float track = 0.18;
    float warn = kind == 1 ? 0.6 + 0.4 * step(0.5, fract(uTime * (2.0 + (1.0 - vProgress) * 6.0))) : 1.0;
    if (kind == 3) {
      // Dash charges: split the ring into segments.
      float seg = step(0.03, fract(ang * 2.0)) * step(fract(ang * 2.0), 0.97);
      ring *= seg;
    }
    m = ring * (filled * warn + track * (1.0 - filled));
  }
  vec3 col = tintC * m * 1.8 + vec3(1.0) * m * 0.25;
  fragColor = vec4(col, kpSaturate(m));
}
`;

export const MARKER: ShaderSource<MarkerUniforms> = {
  name: 'marker',
  vertex: VERTEX,
  fragment: FRAGMENT,
  defines: {},
  createUniforms: createCommonUniforms,
};

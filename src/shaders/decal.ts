/**
 * Ground decals (one batch): spawn/area telegraphs with fill progress, dart lunge line telegraphs, contact-glow
 * blobs (the no-shadow-map grounding) and portal spawn rings. Geometry fx:quad laid flat. Additive.
 *
 * Instance record: aT = (x, z, yaw, size u: radius, or line length); aS = (progress 0..1, spawnT,
 * style = encodeStyle(DECAL_KIND.*, tint slot), seed). size <= 0 hides the instance.
 */
import { GLSL_COMMON } from './chunks/common';
import { GLSL_INSTANCING } from './chunks/instancing';
import { GLSL_LIGHTING } from './chunks/lighting';
import type { ShaderSource, UniformSlot } from './shaderSource';
import { createCommonUniforms, type CommonUniforms } from './tints';

export const DECAL_KIND = { CIRCLE: 0, LINE: 1, GLOW: 2, PORTAL: 3 } as const;

export type DecalUniforms = CommonUniforms & {
  readonly uHeight: UniformSlot<number>;
  /** Line telegraph width (u). */
  readonly uLineWidth: UniformSlot<number>;
};

const VERTEX = /* glsl */ `
${GLSL_COMMON}
uniform float uHeight;
uniform float uLineWidth;
${GLSL_INSTANCING}

out vec2 vLocal;
out float vSize;
out float vProgress;
out float vKind;
out float vTint;
out float vAge;
out vec3 vWorld;

void main() {
  float size = aT.w;
  if (size <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vLocal = vec2(0.0);
    vSize = 1.0;
    vProgress = 0.0;
    vKind = 0.0;
    vTint = 0.0;
    vAge = 0.0;
    vWorld = vec3(0.0);
    return;
  }
  float kind = floor(aS.z / 16.0);
  vec2 dir = vec2(sin(aT.z), cos(aT.z));
  vec2 perp = vec2(dir.y, -dir.x);
  vec2 local;
  if (kind == 1.0) {
    local = vec2(position.x * uLineWidth * 1.6, (position.y + 0.5) * size);
  } else {
    local = position.xy * 2.0 * size * 1.15;
  }
  vec2 xz = aT.xy + perp * local.x + dir * local.y;
  vec4 wp = modelMatrix * vec4(xz.x, uHeight, xz.y, 1.0);
  vLocal = local;
  vSize = size;
  vProgress = aS.x;
  vKind = kind;
  vTint = mod(aS.z, 16.0);
  vAge = uTime - aS.y;
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAGMENT = /* glsl */ `
${GLSL_COMMON}
${GLSL_LIGHTING}
uniform float uLineWidth;
in vec2 vLocal;
in float vSize;
in float vProgress;
in float vKind;
in float vTint;
in float vAge;
in vec3 vWorld;
out vec4 fragColor;

void main() {
  int kind = int(vKind + 0.5);
  vec3 tintC = kpTintColor(vTint);
  float appear = kpSaturate(vAge / 0.12);
  float m = 0.0;
  float r = length(vLocal) / vSize;
  float aa = fwidth(r) + 1e-4;
  float stripes = step(0.5, fract((vLocal.x + vLocal.y) * 0.9 - uTime * 1.5));
  if (kind == 0) {
    float ring = 1.0 - smoothstep(0.0, aa * 1.5 + 0.03, abs(r - 1.0));
    float fill = (1.0 - smoothstep(vProgress - aa, vProgress + aa, r)) * (0.18 + 0.12 * stripes);
    float pulse = 0.75 + 0.25 * sin(uTime * 14.0);
    m = ring * pulse + fill * step(r, 1.0);
  } else if (kind == 1) {
    float halfW = uLineWidth * 0.5;
    float along = vLocal.y / vSize;
    float edge = abs(vLocal.x) - halfW;
    float border = 1.0 - smoothstep(0.0, 0.06, abs(edge));
    float inside = step(edge, 0.0) * step(along, vProgress) * (0.2 + 0.15 * stripes);
    float tip = step(abs(along - vProgress), 0.02) * step(edge, 0.0);
    m = (border * 0.8 + inside + tip) * smoothstep(0.0, 0.05, along) * smoothstep(1.0, 0.95, along);
  } else if (kind == 2) {
    m = exp(-r * r * 3.5) * 0.55 * max(vProgress, 0.2);
  } else {
    float ang = atan(vLocal.y, vLocal.x);
    float hexR = cos(KP_PI / 6.0) / cos(mod(ang + uTime * 1.2, KP_PI / 3.0) - KP_PI / 6.0);
    float ring = 1.0 - smoothstep(0.0, aa * 1.5 + 0.04, abs(r - hexR * 0.9));
    float swirl = 0.5 + 0.5 * sin(ang * 3.0 + r * 10.0 - uTime * 8.0);
    m = ring * 1.2 + swirl * (1.0 - smoothstep(0.0, 0.85, r)) * 0.25 * vProgress;
  }
  m *= appear;
  vec3 col = kpFadeFog(tintC * m * 1.4, length(vWorld - cameraPosition));
  fragColor = vec4(col, kpSaturate(m));
}
`;

export const DECAL: ShaderSource<DecalUniforms> = {
  name: 'decal',
  vertex: VERTEX,
  fragment: FRAGMENT,
  defines: {},
  createUniforms(): DecalUniforms {
    return { ...createCommonUniforms(), uHeight: { value: 0.04 }, uLineWidth: { value: 1.4 } };
  },
};

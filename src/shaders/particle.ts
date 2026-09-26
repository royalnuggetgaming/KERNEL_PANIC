/**
 * Particles: analytic GPU motion evaluated per vertex from a write-once ring record (shaders/ringLayouts.ts
 * PARTICLE_RECORD). Position p(t) = p0 + v * (1 - e^(-drag t)) / drag - 0.5 g t^2 (y), floored at the ground;
 * camera-facing quad (geometry fx:quad, XY in [-0.5, 0.5]) stretched along screen-space velocity, shrinking
 * and fading over life. Expired or unwritten records collapse to a degenerate clip position. Additive.
 */
import { GLSL_COMMON } from './chunks/common';
import { GLSL_LIGHTING } from './chunks/lighting';
import type { ShaderSource } from './shaderSource';
import { createCommonUniforms, type CommonUniforms } from './tints';

export type ParticleUniforms = CommonUniforms;

const VERTEX = /* glsl */ `
${GLSL_COMMON}
in vec4 aP0;
in vec4 aV0;
in vec4 aPX;

out vec2 vUv;
out float vLife;
out float vTint;
out vec3 vWorld;

vec3 kpParticlePos(float t) {
  float drag = aPX.y;
  float k = drag > 1e-3 ? (1.0 - exp(-drag * t)) / drag : t;
  vec3 p = aP0.xyz + aV0.xyz * k;
  p.y -= 0.5 * aPX.z * t * t;
  p.y = max(p.y, 0.03);
  return p;
}

void main() {
  float life = aV0.w;
  float age = uTime - aP0.w;
  if (life <= 0.0 || age < 0.0 || age > life) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vUv = vec2(0.0);
    vLife = 1.0;
    vTint = 0.0;
    vWorld = vec3(0.0);
    return;
  }
  float x = age / life;
  vec3 p = kpParticlePos(age);
  vec3 pNext = kpParticlePos(age + 0.02);
  vec4 view = viewMatrix * modelMatrix * vec4(p, 1.0);
  vec4 viewNext = viewMatrix * modelMatrix * vec4(pNext, 1.0);
  vec2 vel = viewNext.xy - view.xy;
  float speed = length(vel);
  vec2 along = speed > 1e-4 ? vel / speed : vec2(0.0, 1.0);
  vec2 across = vec2(-along.y, along.x);
  float size = aPX.x * (1.0 - x * x);
  float stretch = 1.0 + min(speed * 18.0, 3.0);
  view.xy += across * position.x * size + along * position.y * size * stretch;
  vUv = position.xy * 2.0;
  vLife = x;
  vTint = aPX.w;
  vWorld = p;
  gl_Position = projectionMatrix * view;
}
`;

const FRAGMENT = /* glsl */ `
${GLSL_COMMON}
${GLSL_LIGHTING}
in vec2 vUv;
in float vLife;
in float vTint;
in vec3 vWorld;
out vec4 fragColor;

void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float core = exp(-r * r * 5.0);
  float fade = (1.0 - vLife) * (1.0 - vLife);
  vec3 tintC = kpTintColor(vTint);
  vec3 col = (tintC * 2.2 + vec3(0.6) * core) * core * fade;
  col = kpFadeFog(col, length(vWorld - cameraPosition));
  fragColor = vec4(col, core * fade);
}
`;

export const PARTICLE: ShaderSource<ParticleUniforms> = {
  name: 'particle',
  vertex: VERTEX,
  fragment: FRAGMENT,
  defines: {},
  createUniforms: createCommonUniforms,
};

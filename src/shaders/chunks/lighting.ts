/**
 * GLSL ES 3.0 lighting chunk: one fixed key light baked into the shader (no dynamic lights, so the light count
 * never changes a program), fresnel rim, custom exponential-squared fog from the shared uFog uniform (never
 * scene.fog) and the emissive floor (uMinEmissive). Requires GLSL_COMMON first.
 */
export const GLSL_LIGHTING = /* glsl */ `
const vec3 KP_KEY_DIR = vec3(0.3713907, 0.7427814, 0.5570860); // normalize(0.4, 0.8, 0.6)
const vec3 KP_FILL_DIR = vec3(-0.5547002, 0.2773501, -0.7844645);

// Wrapped key light plus a cool fill and hemispheric ambient, in [0, ~1.2].
float kpKeyLight(vec3 n) {
  float key = max(dot(n, KP_KEY_DIR), 0.0);
  float fill = max(dot(n, KP_FILL_DIR), 0.0) * 0.25;
  float hemi = 0.5 + 0.5 * n.y;
  return 0.18 + 0.12 * hemi + 0.75 * key + fill;
}

float kpFresnel(vec3 n, vec3 v, float power) {
  return pow(1.0 - kpSaturate(abs(dot(n, v))), power);
}

// Exponential-squared fog factor in [0, 1] (1 = fully fogged).
float kpFogFactor(float dist) {
  float d = uFog.w * dist;
  return 1.0 - exp(-d * d);
}

vec3 kpApplyFog(vec3 color, float dist) {
  return mix(color, uFog.rgb, kpFogFactor(dist));
}

// Additive surfaces fade towards black (not fog colour) so blending stays physically additive.
vec3 kpFadeFog(vec3 color, float dist) {
  return color * (1.0 - kpFogFactor(dist));
}

// Keeps emissive parts readable at the theme's minimum emissive level.
vec3 kpEmissiveFloor(vec3 color, vec3 tint) {
  return max(color, tint * uMinEmissive);
}

// Hit flash mix honouring the reduce-flashes setting.
vec3 kpHitFlash(vec3 color, float flash) {
  float f = kpSaturate(flash) * mix(1.0, 0.35, uReduceFlashes);
  return mix(color, vec3(2.5), f);
}
`;

/**
 * GLSL ES 3.0 noise chunk: value noise (2D/3D), simplex 3D, FBM, Voronoi and a sampler for the 256^2 tiling
 * noise DataTexture (uNoiseTex, channels: r = fbm, g = value octave, b = white hash, a = cellular).
 * Requires GLSL_COMMON (hash functions) to be included first.
 *
 * LOW_FX (Chromebook quality): a Boot-time define that assets/materials.ts adds to floor/sky/neonSurface only when
 * on (tested with #ifdef, so it is never declared as 0); the FBMs then drop to 2 octaves.
 */
export const GLSL_NOISE = /* glsl */ `
#ifdef LOW_FX
#define KP_FBM_OCTAVES 2
#define KP_FBM_NORM 0.75
#else
#define KP_FBM_OCTAVES 3
#define KP_FBM_NORM 0.875
#endif
float kpValueNoise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = kpHash12(i);
  float b = kpHash12(i + vec2(1.0, 0.0));
  float c = kpHash12(i + vec2(0.0, 1.0));
  float d = kpHash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float kpValueNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = kpHash13(i);
  float n100 = kpHash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = kpHash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = kpHash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = kpHash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = kpHash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = kpHash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = kpHash13(i + vec3(1.0, 1.0, 1.0));
  float x00 = mix(n000, n100, u.x);
  float x10 = mix(n010, n110, u.x);
  float x01 = mix(n001, n101, u.x);
  float x11 = mix(n011, n111, u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}

vec4 kpPermute(vec4 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
vec4 kpTaylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

// Simplex noise 3D (Gustavson / McEwan), range about [-1, 1].
float kpSimplex3(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod(i, 289.0);
  vec4 p = kpPermute(kpPermute(kpPermute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 1.0 / 7.0;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = kpTaylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

// 3-octave (LOW_FX: 2) FBM in [0, 1].
float kpFbm2(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < KP_FBM_OCTAVES; i++) {
    sum += amp * kpValueNoise2(p);
    p = kpRot2(0.5) * p * 2.03 + vec2(17.1, 9.2);
    amp *= 0.5;
  }
  return sum / KP_FBM_NORM;
}

// 3-octave (LOW_FX: 2) simplex FBM in about [-1, 1].
float kpFbm3(vec3 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < KP_FBM_OCTAVES; i++) {
    sum += amp * kpSimplex3(p);
    p = p * 2.01 + vec3(11.3, 5.7, 3.1);
    amp *= 0.5;
  }
  return sum / KP_FBM_NORM;
}

// Voronoi: x = distance to the nearest feature point, y = cell id hash.
vec2 kpVoronoi2(vec2 p) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  float best = 8.0;
  float id = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = kpHash22(n + g);
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < best) {
        best = d;
        id = kpHash12(n + g);
      }
    }
  }
  return vec2(sqrt(best), id);
}

// Hex tiling: x = distance to the nearest hex-cell edge (flat-top hexes of circumradius 1) and the cell centre.
vec3 kpHex(vec2 p) {
  const vec2 s = vec2(1.0, 1.7320508);
  vec4 hc = floor(vec4(p, p - vec2(0.5, 1.0)) / s.xyxy) + 0.5;
  vec4 h = vec4(p - hc.xy * s, p - (hc.zw + 0.5) * s);
  vec4 c = dot(h.xy, h.xy) < dot(h.zw, h.zw) ? vec4(h.xy, hc.xy) : vec4(h.zw, hc.zw + 0.5);
  vec2 a = abs(c.xy);
  float edge = 0.5 - max(dot(a, s * 0.5), a.x);
  return vec3(edge, c.zw);
}

// Tiling noise texture lookup (repeat wrap), uv in texture periods.
vec4 kpNoiseTex(vec2 uv) { return texture(uNoiseTex, uv); }
`;

/**
 * Allocation-free math helpers. Out-params instead of returned objects.
 *
 * Conventions: ground plane (x, z); yaw 0 faces +Z; forward(yaw) = (sin(yaw), cos(yaw));
 * dirToYaw(x, z) = atan2(x, z). Angles in radians unless the name says Deg.
 */

export const TAU = Math.PI * 2;
export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export interface Vec2Out {
  x: number;
  z: number;
}

/** Critically damped spring state (velocity carried between calls). */
export interface SmoothDampState {
  velocity: number;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function saturate(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function invLerp(a: number, b: number, v: number): number {
  return a === b ? 0 : (v - a) / (b - a);
}

/** Moves `current` toward `target` by at most `maxDelta`. */
export function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return current + maxDelta >= target ? target : current + maxDelta;
  return current - maxDelta <= target ? target : current - maxDelta;
}

/** Wraps to (-PI, PI]. */
export function wrapAngle(a: number): number {
  let r = a % TAU;
  if (r <= -Math.PI) r += TAU;
  else if (r > Math.PI) r -= TAU;
  return r;
}

/** Signed shortest difference b - a in (-PI, PI]. */
export function angleDiff(a: number, b: number): number {
  return wrapAngle(b - a);
}

export function lerpAngle(a: number, b: number, t: number): number {
  return a + angleDiff(a, b) * t;
}

/** Rotates `current` toward `target` by at most `maxStep` radians. */
export function turnToward(current: number, target: number, maxStep: number): number {
  const d = angleDiff(current, target);
  if (d > maxStep) return wrapAngle(current + maxStep);
  if (d < -maxStep) return wrapAngle(current - maxStep);
  return wrapAngle(target);
}

export function dirToYaw(x: number, z: number): number {
  return Math.atan2(x, z);
}

export function yawToDir(yaw: number, out: Vec2Out): Vec2Out {
  out.x = Math.sin(yaw);
  out.z = Math.cos(yaw);
  return out;
}

export function len2(x: number, z: number): number {
  return Math.sqrt(x * x + z * z);
}

export function dist2Sq(ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  return dx * dx + dz * dz;
}

/** Normalises (x, z) into out; a zero vector yields (0, 0). Returns the original length. */
export function normalize2(x: number, z: number, out: Vec2Out): number {
  const l = Math.sqrt(x * x + z * z);
  if (l > 1e-9) {
    out.x = x / l;
    out.z = z / l;
  } else {
    out.x = 0;
    out.z = 0;
  }
  return l;
}

/**
 * Critically damped smoothing (Game Programming Gems 4), frame-rate independent.
 * Returns the new value; updates state.velocity.
 */
export function smoothDamp(
  current: number,
  target: number,
  state: SmoothDampState,
  smoothTime: number,
  dt: number,
  maxSpeed = Infinity,
): number {
  const st = Math.max(0.0001, smoothTime);
  const omega = 2 / st;
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  let change = current - target;
  const maxChange = maxSpeed * st;
  change = clamp(change, -maxChange, maxChange);
  const clampedTarget = current - change;
  const temp = (state.velocity + omega * change) * dt;
  state.velocity = (state.velocity - omega * temp) * exp;
  let output = clampedTarget + (change + temp) * exp;
  if (target - current > 0 === output > target) {
    output = target;
    state.velocity = (output - target) / Math.max(dt, 1e-9);
  }
  return output;
}

/** Squared distance from point P to segment AB. */
export function pointSegDistSq(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const abx = bx - ax;
  const abz = bz - az;
  const l2 = abx * abx + abz * abz;
  let t = l2 > 0 ? ((px - ax) * abx + (pz - az) * abz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + abx * t - px;
  const cz = az + abz * t - pz;
  return cx * cx + cz * cz;
}

/**
 * Swept test of segment A->B against circle (C, r). Returns the smallest t in [0, 1] where the segment
 * enters the circle (0 if A starts inside), or -1 when there is no hit.
 */
export function segCircleHit(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  r: number,
): number {
  const fx = ax - cx;
  const fz = az - cz;
  const c = fx * fx + fz * fz - r * r;
  if (c <= 0) return 0;
  const dx = bx - ax;
  const dz = bz - az;
  const a = dx * dx + dz * dz;
  if (a <= 1e-12) return -1;
  const b = 2 * (fx * dx + fz * dz);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : -1;
}

/**
 * True when direction (dx, dz) lies within +-halfArc of the facing yaw (Warden shields, aim-assist cones).
 * A zero direction is never inside.
 */
export function inArc(facingYaw: number, halfArc: number, dx: number, dz: number): boolean {
  if (dx === 0 && dz === 0) return false;
  return Math.abs(angleDiff(facingYaw, Math.atan2(dx, dz))) <= halfArc;
}

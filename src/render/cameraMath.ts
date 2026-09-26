/**
 * Pure camera math (plan section 4). No three: the gameplay camera is a pinhole with fixed yaw, vertical FOV
 * CAMERA.FOV_DEG and pitch CAMERA.PITCH_DEG below the horizon, looking at a ground target (targetX, 0, targetZ)
 * from `distance` along the view axis. Ground plane: x right, z toward the camera (screen down).
 *
 * Camera position = (tx, D sin(pitch), tz + D cos(pitch)). For a ground point with dx = x - tx, dz = z - tz:
 *   depth = D - dz cos(pitch),  ndcX = dx / (depth tan(fov/2) aspect),  ndcY = -dz sin(pitch) / (depth tan(fov/2)).
 * Every function here is allocation-free and writes into out-params.
 */
import type { WorldView, ViewRect } from '../contracts/world';
import { ARENA, CAMERA } from '../config/tuning';
import { DEG2RAD } from '../core/math';

export interface FramingPoint {
  x: number;
  z: number;
  pad: number;
}

export interface CameraPose {
  targetX: number;
  targetZ: number;
  distance: number;
}

export interface NdcOut {
  x: number;
  y: number;
}

const SIN_P = Math.sin(CAMERA.PITCH_DEG * DEG2RAD);
const COS_P = Math.cos(CAMERA.PITCH_DEG * DEG2RAD);
const TAN_HALF = Math.tan(CAMERA.FOV_DEG * 0.5 * DEG2RAD);
/** Upper bound for the max-distance search; doubled until the arena fits. */
const SEARCH_HI = 256;
/** Framing-set capacity: 2 players + CAPACITY.bossParts. */
export const MAX_FRAMING_POINTS = 6;

/** Sine/cosine of the camera pitch (shared with CameraRig so the three camera matches the math). */
export const PITCH_SIN = SIN_P;
export const PITCH_COS = COS_P;

/** Allocates a framing-point array (call once; out-param for collectFramingPoints). */
export function createFramingPoints(n = MAX_FRAMING_POINTS): FramingPoint[] {
  const out: FramingPoint[] = [];
  for (let i = 0; i < n; i++) out.push({ x: 0, z: 0, pad: 0 });
  return out;
}

function ndcX(tx: number, tz: number, d: number, aspect: number, x: number, z: number): number {
  const depth = d - (z - tz) * COS_P;
  if (depth <= 1e-6) return x - tx >= 0 ? 1e9 : -1e9;
  return (x - tx) / (depth * TAN_HALF * aspect);
}

function ndcY(tz: number, d: number, z: number): number {
  const dz = z - tz;
  const depth = d - dz * COS_P;
  if (depth <= 1e-6) return -1e9;
  return (-dz * SIN_P) / (depth * TAN_HALF);
}

export function projectToNdc(
  pose: CameraPose,
  aspect: number,
  x: number,
  z: number,
  out: { x: number; y: number },
): void {
  out.x = ndcX(pose.targetX, pose.targetZ, pose.distance, aspect, x, z);
  out.y = ndcY(pose.targetZ, pose.distance, z);
}

function insideBox(
  tx: number,
  tz: number,
  d: number,
  aspect: number,
  x: number,
  z: number,
  xMax: number,
  yMin: number,
  yMax: number,
): boolean {
  const nx = ndcX(tx, tz, d, aspect, x, z);
  if (nx < -xMax || nx > xMax) return false;
  const ny = ndcY(tz, d, z);
  return ny >= yMin && ny <= yMax;
}

function arenaFits(d: number, aspect: number): boolean {
  const r = ARENA.RADIUS + CAMERA.ARENA_MARGIN;
  const n = CAMERA.ARENA_SAMPLES;
  const lim = CAMERA.MAXDIST_NDC;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    if (!insideBox(0, 0, d, aspect, Math.sin(a) * r, Math.cos(a) * r, lim, -lim, lim)) return false;
  }
  return true;
}

/**
 * Smallest distance (16-iteration binary search) at which the arena circle plus CAMERA.ARENA_MARGIN, sampled at
 * CAMERA.ARENA_SAMPLES points around the arena centre, projects inside NDC +-CAMERA.MAXDIST_NDC. Never below
 * CAMERA.MIN_DIST. Handles portrait and very narrow aspects.
 */
export function solveMaxDistance(aspect: number): number {
  const a = aspect > 1e-3 ? aspect : 1e-3;
  let hi = SEARCH_HI;
  for (let guard = 0; guard < 16 && !arenaFits(hi, a); guard++) hi *= 2;
  let lo = 0;
  for (let i = 0; i < CAMERA.MAXDIST_ITERATIONS; i++) {
    const mid = (lo + hi) * 0.5;
    if (arenaFits(mid, a)) hi = mid;
    else lo = mid;
  }
  return hi < CAMERA.MIN_DIST ? CAMERA.MIN_DIST : hi;
}

/** True when every padded point (4 offsets each) lies inside the safe NDC box. */
export function framingFits(
  points: readonly FramingPoint[],
  count: number,
  aspect: number,
  tx: number,
  tz: number,
  d: number,
): boolean {
  const xs = CAMERA.SAFE_X;
  const y0 = CAMERA.SAFE_Y_MIN;
  const y1 = CAMERA.SAFE_Y_MAX;
  for (let i = 0; i < count; i++) {
    const p = points[i]!;
    if (!insideBox(tx, tz, d, aspect, p.x - p.pad, p.z, xs, y0, y1)) return false;
    if (!insideBox(tx, tz, d, aspect, p.x + p.pad, p.z, xs, y0, y1)) return false;
    if (!insideBox(tx, tz, d, aspect, p.x, p.z - p.pad, xs, y0, y1)) return false;
    if (!insideBox(tx, tz, d, aspect, p.x, p.z + p.pad, xs, y0, y1)) return false;
  }
  return true;
}

/**
 * Goal pose for a framing set. Centre = midpoint of the padded AABB + lead (clamped to CAMERA.LEAD_MAX), then
 * clamped to CAMERA.CENTER_CLAMP from the arena centre. Distance = smallest value in [MIN_DIST, maxDist] at which
 * every padded point lands in the safe box (12-iteration binary search), maxDist when nothing fits.
 * With count 0 the target is left unchanged and the distance is clamped into [MIN_DIST, maxDist].
 */
export function solveFraming(
  points: readonly FramingPoint[],
  count: number,
  aspect: number,
  leadX: number,
  leadZ: number,
  maxDist: number,
  out: CameraPose,
): CameraPose {
  const minD = CAMERA.MIN_DIST < maxDist ? CAMERA.MIN_DIST : maxDist;
  const a = aspect > 1e-3 ? aspect : 1e-3;
  if (count <= 0) {
    out.distance = out.distance < minD ? minD : out.distance > maxDist ? maxDist : out.distance;
    return out;
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < count; i++) {
    const p = points[i]!;
    if (p.x - p.pad < minX) minX = p.x - p.pad;
    if (p.x + p.pad > maxX) maxX = p.x + p.pad;
    if (p.z - p.pad < minZ) minZ = p.z - p.pad;
    if (p.z + p.pad > maxZ) maxZ = p.z + p.pad;
  }
  let lx = leadX;
  let lz = leadZ;
  const ll = Math.sqrt(lx * lx + lz * lz);
  if (ll > CAMERA.LEAD_MAX) {
    lx *= CAMERA.LEAD_MAX / ll;
    lz *= CAMERA.LEAD_MAX / ll;
  }
  let cx = (minX + maxX) * 0.5 + lx;
  let cz = (minZ + maxZ) * 0.5 + lz;
  const cl = Math.sqrt(cx * cx + cz * cz);
  if (cl > CAMERA.CENTER_CLAMP) {
    cx *= CAMERA.CENTER_CLAMP / cl;
    cz *= CAMERA.CENTER_CLAMP / cl;
  }
  out.targetX = cx;
  out.targetZ = cz;
  if (framingFits(points, count, a, cx, cz, minD)) {
    out.distance = minD;
    return out;
  }
  if (!framingFits(points, count, a, cx, cz, maxDist)) {
    out.distance = maxDist;
    return out;
  }
  let lo = minD;
  let hi = maxDist;
  for (let i = 0; i < CAMERA.FRAMING_ITERATIONS; i++) {
    const mid = (lo + hi) * 0.5;
    if (framingFits(points, count, a, cx, cz, mid)) hi = mid;
    else lo = mid;
  }
  out.distance = hi;
  return out;
}

/**
 * Axis-aligned rectangle on the ground that is fully visible: z spans the screen's top (far) to bottom (near)
 * edge, x spans the narrower bottom edge of the view trapezoid. The sim clamps the Offline ghost to it (inset).
 */
export function viewRectOnGround(pose: CameraPose, aspect: number, out: ViewRect): ViewRect {
  const d = pose.distance;
  const camY = d * SIN_P;
  const camZ = pose.targetZ + d * COS_P;
  // Bottom edge (ndcY = -1): ray dir y = -(sin + tan cos), z = -(cos - tan sin).
  const dyB = SIN_P + TAN_HALF * COS_P;
  const lamB = camY / dyB;
  const zNear = camZ + lamB * (-COS_P + TAN_HALF * SIN_P);
  // Top edge (ndcY = +1): ray dir y = -(sin - tan cos) (> 0 because pitch > fov / 2).
  const dyT = SIN_P - TAN_HALF * COS_P;
  const lamT = camY / dyT;
  const zFar = camZ + lamT * (-COS_P - TAN_HALF * SIN_P);
  const half = lamB * TAN_HALF * (aspect > 1e-3 ? aspect : 1e-3);
  out.minX = pose.targetX - half;
  out.maxX = pose.targetX + half;
  out.minZ = zFar;
  out.maxZ = zNear;
  return out;
}

/**
 * Framing set from interpolated render positions (alpha in [0, 1] between prev and current):
 * alive player pad 7, downed player pad 5 (versus eliminated too), living boss part pad 4. Offline, absent and
 * respawning players and the solo Echo Drone are excluded. `out` needs MAX_FRAMING_POINTS entries.
 */
export function collectFramingPointsInterp(w: WorldView, alpha: number, out: FramingPoint[]): number {
  let n = 0;
  for (let i = 0; i < 2; i++) {
    const p = w.players[i === 0 ? 0 : 1];
    let pad: number;
    if (p.life === 'alive') pad = CAMERA.PAD_ALIVE;
    else if (p.life === 'downed') pad = CAMERA.PAD_DOWNED;
    else continue;
    if (n >= out.length) return n;
    const o = out[n++]!;
    o.x = p.prevX + (p.x - p.prevX) * alpha;
    o.z = p.prevZ + (p.z - p.prevZ) * alpha;
    o.pad = pad;
  }
  const bosses = w.bosses;
  for (let i = 0; i < bosses.length; i++) {
    const b = bosses[i]!;
    if (!b.alive) continue;
    if (n >= out.length) return n;
    const o = out[n++]!;
    o.x = b.prevX + (b.x - b.prevX) * alpha;
    o.z = b.prevZ + (b.z - b.prevZ) * alpha;
    o.pad = CAMERA.PAD_BOSS;
  }
  return n;
}

/** alive pad 7, downed pad 5 (versus eliminated too), boss pad 4; offline and echo drone excluded. */
export function collectFramingPoints(w: WorldView, out: FramingPoint[]): number {
  return collectFramingPointsInterp(w, 1, out);
}

/** Average velocity of alive players times CAMERA.LEAD_TIME into out (unclamped; solveFraming clamps). */
export function leadFromPlayers(w: WorldView, out: { x: number; z: number }): number {
  let sx = 0;
  let sz = 0;
  let n = 0;
  for (let i = 0; i < 2; i++) {
    const p = w.players[i === 0 ? 0 : 1];
    if (p.life !== 'alive') continue;
    sx += p.vx;
    sz += p.vz;
    n++;
  }
  if (n === 0) {
    out.x = 0;
    out.z = 0;
    return 0;
  }
  out.x = (sx / n) * CAMERA.LEAD_TIME;
  out.z = (sz / n) * CAMERA.LEAD_TIME;
  return n;
}

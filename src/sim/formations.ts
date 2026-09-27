/**
 * Spawn geometry for the WaveDirector: the 8 edge portals, the "3 farthest from the players" choice and the
 * four pulse formations (ring, line, pincer, cluster). Allocation-free (out-params, module scratch).
 */
import type { Rng } from '../contracts/sim';
import type { WorldView } from '../contracts/world';
import type { Formation } from '../config/waves';
import { ARENA } from '../config/tuning';
import { TAU } from '../core/math';

export interface PointOut {
  x: number;
  z: number;
}

const RING_RADIUS = 2.5;
const RING_PER_LAYER = 8;
const RING_LAYER_STEP = 1.4;
const LINE_SPACING = 1.6;
const PINCER_SPREAD = 4.5;
const PINCER_DEPTH = 1.3;
const CLUSTER_RADIUS = 2.2;
/** Every formation is pushed this far inward from the portal so bodies start inside the arena. */
const INWARD = 2;

const SCORES = new Float64Array(ARENA.PORTALS);

/** Portal i sits on the portal ring at yaw i * TAU / PORTALS (portal 0 at +Z). */
export function portalPosition(i: number, out: PointOut): PointOut {
  const a = (i * TAU) / ARENA.PORTALS;
  out.x = Math.sin(a) * ARENA.PORTAL_RADIUS;
  out.z = Math.cos(a) * ARENA.PORTAL_RADIUS;
  return out;
}

const P = { x: 0, z: 0 };

/**
 * Writes the ARENA.PORTALS_PER_PULSE portals farthest from the players into out (farthest first). A portal's
 * distance is to the NEAREST present player (alive, downed or respawning); ties go to the lower index.
 * With no present player every portal scores 0 and the lowest indices are used. Returns the count written.
 */
export function choosePortals(w: WorldView, out: Int32Array): number {
  const n = ARENA.PORTALS;
  for (let i = 0; i < n; i++) {
    portalPosition(i, P);
    let best = Infinity;
    for (let pi = 0; pi < 2; pi++) {
      const p = w.players[pi === 0 ? 0 : 1];
      if (p.life === 'absent' || p.life === 'offline') continue;
      const dx = p.x - P.x;
      const dz = p.z - P.z;
      const d = dx * dx + dz * dz;
      if (d < best) best = d;
    }
    SCORES[i] = best === Infinity ? 0 : best;
  }
  const k = Math.min(ARENA.PORTALS_PER_PULSE, out.length);
  for (let j = 0; j < k; j++) {
    let bi = -1;
    for (let i = 0; i < n; i++) {
      if (SCORES[i]! < 0) continue;
      if (bi === -1 || SCORES[i]! > SCORES[bi]!) bi = i;
    }
    out[j] = bi;
    SCORES[bi] = -1;
  }
  return k;
}

/**
 * Position of the k-th enemy of a formation group at portal `portal`. Offsets are expressed along the
 * portal's inward normal and tangent. `rng` is consumed only by 'cluster'.
 */
export function formationPoint(
  formation: Formation,
  portal: number,
  k: number,
  rng: Rng,
  out: PointOut,
): PointOut {
  const a = (portal * TAU) / ARENA.PORTALS;
  // Outward normal (sin a, cos a); tangent (cos a, -sin a).
  const nx = Math.sin(a);
  const nz = Math.cos(a);
  const tx = nz;
  const tz = -nx;
  let along = 0;
  let inward = INWARD;
  switch (formation) {
    case 'ring': {
      const layer = Math.floor(k / RING_PER_LAYER);
      const ang = ((k % RING_PER_LAYER) * TAU) / RING_PER_LAYER + layer * 0.4;
      const r = RING_RADIUS + layer * RING_LAYER_STEP;
      along = Math.sin(ang) * r;
      inward += RING_RADIUS + layer * RING_LAYER_STEP + Math.cos(ang) * r;
      break;
    }
    case 'line': {
      const side = (k & 1) === 0 ? 1 : -1;
      along = side * Math.ceil(k / 2) * LINE_SPACING;
      break;
    }
    case 'pincer': {
      const side = (k & 1) === 0 ? 1 : -1;
      const depth = k >> 1;
      along = side * (PINCER_SPREAD + (depth % 3) * 0.9);
      inward += Math.floor(depth / 3) * PINCER_DEPTH + (depth % 3) * 0.4;
      break;
    }
    case 'cluster': {
      const ang = rng.range(0, TAU);
      const r = Math.sqrt(rng.next()) * (CLUSTER_RADIUS + Math.sqrt(k) * 0.35);
      along = Math.sin(ang) * r;
      inward += CLUSTER_RADIUS + Math.cos(ang) * r;
      break;
    }
  }
  const px = nx * ARENA.PORTAL_RADIUS - nx * inward + tx * along;
  const pz = nz * ARENA.PORTAL_RADIUS - nz * inward + tz * along;
  out.x = px;
  out.z = pz;
  return out;
}

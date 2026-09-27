/**
 * Player trails: one ribbon mesh per player (geometry fx:trail:<p>, material `trail`). The geometry has two
 * vertices per ribbon point; each vertex's uv (x = 0 head .. 1 tail, y = 0/1 side) tells which history point and
 * which edge it is, so the writer does not depend on vertex order. History is sampled at TRAIL_SAMPLE_HZ; the head
 * follows the interpolated craft. Hidden (collapsed) unless the player is alive. Allocation-free per frame.
 */
import {
  DynamicDrawUsage,
  Group,
  Mesh,
  type BufferAttribute,
  type BufferGeometry,
  type InterleavedBufferAttribute,
  type ShaderMaterial,
} from 'three';
import { lerp1, type FrameContext } from '../views/types';

export const TRAIL_SAMPLE_HZ = 60;
export const TRAIL_HALF_WIDTH = 0.38;
export const TRAIL_HEIGHT = 0.28;
/** A jump longer than this (teleport, respawn) restarts the trail instead of drawing a streak. */
export const TRAIL_RESET_JUMP = 6;

/** Pure ribbon state for one player (tested without three). */
export class TrailRibbon {
  readonly points: number;
  /** Ring of past samples (x, z), most recent at `head`. */
  private readonly hist: Float32Array;
  private head = 0;
  private filled = 0;
  private sinceSample = 0;
  /** Per-vertex point index and side (-1 / +1). */
  private readonly vPoint: Int32Array;
  private readonly vSide: Float32Array;
  /** Scratch: resolved point positions (head first). */
  private readonly px: Float32Array;
  private readonly pz: Float32Array;

  constructor(uv: ArrayLike<number>, vertexCount: number) {
    const n = Math.max(2, Math.floor(vertexCount / 2));
    this.points = n;
    this.hist = new Float32Array(n * 2);
    this.vPoint = new Int32Array(vertexCount);
    this.vSide = new Float32Array(vertexCount);
    for (let v = 0; v < vertexCount; v++) {
      const u = uv[v * 2] ?? 0;
      const s = uv[v * 2 + 1] ?? 0;
      const k = Math.round(u * (n - 1));
      this.vPoint[v] = k < 0 ? 0 : k > n - 1 ? n - 1 : k;
      this.vSide[v] = s > 0.5 ? 1 : -1;
    }
    this.px = new Float32Array(n);
    this.pz = new Float32Array(n);
  }

  get historyCount(): number {
    return this.filled;
  }

  reset(): void {
    this.filled = 0;
    this.head = 0;
    this.sinceSample = 0;
  }

  /** Records the craft position; samples history at TRAIL_SAMPLE_HZ. */
  advance(x: number, z: number, dt: number): void {
    if (this.filled > 0) {
      const lx = this.hist[this.head * 2]!;
      const lz = this.hist[this.head * 2 + 1]!;
      const dx = x - lx;
      const dz = z - lz;
      if (dx * dx + dz * dz > TRAIL_RESET_JUMP * TRAIL_RESET_JUMP) this.reset();
    }
    this.sinceSample += dt;
    if (this.filled === 0 || this.sinceSample >= 1 / TRAIL_SAMPLE_HZ) {
      this.sinceSample = 0;
      const cap = this.points - 1;
      this.head = this.filled === 0 ? 0 : (this.head + 1) % cap;
      this.hist[this.head * 2] = x;
      this.hist[this.head * 2 + 1] = z;
      if (this.filled < cap) this.filled++;
    }
  }

  /**
   * Writes xyz for every vertex into `pos` (itemSize 3). Point 0 = (x, z) (the live head), then history newest
   * to oldest, clamped to the oldest sample. `visible` false collapses the ribbon onto the head.
   */
  write(pos: Float32Array, x: number, z: number, visible: boolean): void {
    const n = this.points;
    const cap = n - 1;
    this.px[0] = x;
    this.pz[0] = z;
    for (let k = 1; k < n; k++) {
      const age = k - 1 < this.filled ? k - 1 : this.filled - 1;
      if (age < 0) {
        this.px[k] = x;
        this.pz[k] = z;
        continue;
      }
      const idx = (this.head - age + cap * 4) % cap;
      this.px[k] = this.hist[idx * 2]!;
      this.pz[k] = this.hist[idx * 2 + 1]!;
    }
    const verts = this.vPoint.length;
    for (let v = 0; v < verts; v++) {
      const k = this.vPoint[v]!;
      let ox = 0;
      let oz = 0;
      if (visible) {
        const a = k > 0 ? k - 1 : 0;
        const b = k < n - 1 ? k + 1 : n - 1;
        const dx = this.px[a]! - this.px[b]!;
        const dz = this.pz[a]! - this.pz[b]!;
        const l = Math.sqrt(dx * dx + dz * dz);
        if (l > 1e-5) {
          const s = (this.vSide[v]! * TRAIL_HALF_WIDTH) / l;
          ox = dz * s;
          oz = -dx * s;
        }
      }
      // Point 0 holds the head (x, z): index the scratch instead of mixing the typed-array load with the
      // tagged parameter in one expression, which makes TurboFan box the merged double (2 HeapNumbers/vertex).
      const kk = visible ? k : 0;
      const o = v * 3;
      pos[o] = this.px[kk]! + ox;
      pos[o + 1] = TRAIL_HEIGHT;
      pos[o + 2] = this.pz[kk]! + oz;
    }
  }
}

interface TrailSlot {
  readonly mesh: Mesh;
  readonly ribbon: TrailRibbon;
  readonly attr: BufferAttribute;
  readonly array: Float32Array;
}

function isPlain(a: BufferAttribute | InterleavedBufferAttribute): a is BufferAttribute {
  return !('isInterleavedBufferAttribute' in a);
}

export class TrailRenderer {
  readonly root = new Group();
  private readonly slots: TrailSlot[] = [];

  constructor(material: ShaderMaterial, geometries: readonly [BufferGeometry, BufferGeometry]) {
    for (let i = 0; i < 2; i++) {
      const g = geometries[i === 0 ? 0 : 1];
      const pos = g.getAttribute('position');
      const uv = g.getAttribute('uv');
      if (!isPlain(pos) || !isPlain(uv) || !(pos.array instanceof Float32Array)) {
        throw new Error('TrailRenderer: fx:trail geometry needs plain Float32 position and uv attributes');
      }
      pos.setUsage(DynamicDrawUsage);
      const mesh = new Mesh(g, material);
      mesh.name = `trail:${String(i)}`;
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.visible = false;
      this.root.add(mesh);
      this.slots.push({
        mesh,
        ribbon: new TrailRibbon(uv.array, pos.count),
        attr: pos,
        array: pos.array,
      });
    }
  }

  sync(ctx: FrameContext): void {
    const w = ctx.world;
    for (let i = 0; i < 2; i++) {
      const p = w.players[i === 0 ? 0 : 1];
      const s = this.slots[i]!;
      const alive = p.life === 'alive';
      if (!alive) {
        if (s.mesh.visible) {
          s.mesh.visible = false;
          s.ribbon.reset();
        }
        continue;
      }
      const x = lerp1(p.prevX, p.x, ctx.alpha);
      const z = lerp1(p.prevZ, p.z, ctx.alpha);
      s.ribbon.advance(x, z, ctx.frameDt);
      s.ribbon.write(s.array, x, z, true);
      s.attr.needsUpdate = true;
      s.mesh.visible = true;
    }
  }

  clear(): void {
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i]!;
      s.mesh.visible = false;
      s.ribbon.reset();
    }
  }
}

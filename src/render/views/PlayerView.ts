/**
 * Players: two hull meshes (materials hull:0 / hull:1, geometry vehicle:<id>) with hover bob, bank into turns,
 * hit/invulnerability flash, the downed core (shrunk, glitching, flickering) and hidden while offline/respawning;
 * plus the shields batch (Firewall domes, Nanoshield bubbles). Ghost wisps, thrusters and dash streaks are
 * particles (FxDirector); dash/special charge rings are markers (MarkerView).
 */
import { Group, Mesh, type BufferGeometry, type IUniform, type ShaderMaterial } from 'three';
import type { PlayerIndex, VehicleId } from '../../contracts/ids';
import type { GeometryKey } from '../../contracts/render';
import type { PlayerEntity } from '../../contracts/sim';
import { lerpAngle } from '../../core/math';
import { TINT } from '../../shaders/tints';
import { findUniform } from '../uniforms';
import { lerp1, type BatchSink, type FrameContext } from './types';

const DOWNED_SCALE = 0.6;
const NANOSHIELD_RADIUS = 1.5;

interface HullSlot {
  readonly mesh: Mesh;
  readonly uFlash: IUniform | null;
  readonly uDissolve: IUniform | null;
  readonly uGlitch: IUniform | null;
  vehicle: VehicleId | null;
}

/** Pure: hull flash from hit flash, invulnerability flicker (12 Hz) and the downed pulse. */
export function hullFlash(p: Readonly<PlayerEntity>, simTime: number, time: number): number {
  let f = p.hitFlash > 1 ? 1 : p.hitFlash < 0 ? 0 : p.hitFlash;
  if (p.life === 'alive' && p.invulnUntil > simTime) {
    const blink = Math.floor(time * 24) % 2 === 0 ? 0.35 : 0;
    if (blink > f) f = blink;
  }
  if (p.life === 'downed') {
    const pulse = 0.25 + 0.25 * Math.sin(time * 9);
    if (pulse > f) f = pulse;
  }
  return f;
}

export class PlayerView {
  readonly root = new Group();
  private readonly hulls: HullSlot[] = [];
  private readonly geometry: (k: GeometryKey) => BufferGeometry;
  private readonly shields: BatchSink;

  constructor(
    materials: readonly [ShaderMaterial, ShaderMaterial],
    geometry: (k: GeometryKey) => BufferGeometry,
    shields: BatchSink,
  ) {
    this.geometry = geometry;
    this.shields = shields;
    for (let i = 0; i < 2; i++) {
      const mat = materials[i === 0 ? 0 : 1];
      const mesh = new Mesh(geometry('vehicle:lancer'), mat);
      mesh.name = `hull:${String(i)}`;
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      this.root.add(mesh);
      this.hulls.push({
        mesh,
        uFlash: findUniform(mat, 'uFlash'),
        uDissolve: findUniform(mat, 'uDissolve'),
        uGlitch: findUniform(mat, 'uGlitch'),
        vehicle: null,
      });
    }
  }

  sync(ctx: FrameContext): void {
    const w = ctx.world;
    const a = ctx.alpha;
    const sh = this.shields;
    sh.begin();
    for (let i = 0; i < 2; i++) {
      const idx: PlayerIndex = i === 0 ? 0 : 1;
      const p = w.players[idx];
      const slot = this.hulls[i]!;
      const m = slot.mesh;
      const visible = p.life === 'alive' || p.life === 'downed';
      if (!visible) {
        m.visible = false;
        continue;
      }
      if (slot.vehicle !== p.vehicle) {
        slot.vehicle = p.vehicle;
        m.geometry = this.geometry(`vehicle:${p.vehicle}`);
      }
      const x = lerp1(p.prevX, p.x, a);
      const z = lerp1(p.prevZ, p.z, a);
      const yaw = lerpAngle(p.prevYaw, p.yaw, a);
      const downed = p.life === 'downed';
      const bob = Math.sin(ctx.time * 3.1 + i * 1.7) * 0.06;
      // Hull geometry has the hover height baked in (belly above the floor); add only a bob.
      m.position.set(x, downed ? -0.1 : bob, z);
      // Bank into lateral velocity (visual only).
      const lateral = p.vx * Math.cos(yaw) - p.vz * Math.sin(yaw);
      const bank = downed ? 0 : Math.max(-0.35, Math.min(0.35, -lateral * 0.025));
      m.rotation.set(0, downed ? yaw + ctx.time * 1.5 : yaw, bank, 'YXZ');
      m.scale.setScalar(downed ? DOWNED_SCALE : 1);
      m.updateMatrix();
      m.visible = downed ? Math.floor(ctx.time * 10) % 4 !== 0 : true;
      if (slot.uFlash !== null) slot.uFlash.value = hullFlash(p, ctx.simTime, ctx.time);
      if (slot.uDissolve !== null) slot.uDissolve.value = downed ? 0.25 : 0;
      if (slot.uGlitch !== null) slot.uGlitch.value = downed ? 0.6 : 0;
      const tint = idx === 0 ? TINT.P1 : TINT.P2;
      const sp = p.special;
      if (sp.active && sp.kind === 'firewall') {
        const left = sp.duration > 0 ? sp.timer / sp.duration : 0;
        const flash = left < 0.2 ? (Math.floor(ctx.time * 16) % 2 === 0 ? 0.6 : 0) : 0;
        sh.push(x, z, 0, sp.radius, flash, ctx.time - (sp.duration - sp.timer), tint, idx);
      }
      if (!downed && p.cards.nanoshieldReady) {
        sh.push(x, z, 0, NANOSHIELD_RADIUS, 0, 0, tint, 2 + idx);
      }
    }
    sh.commit();
  }

  /** Hidden hulls and neutral hull uniforms (the hull materials are shared with menu/select meshes). */
  clear(): void {
    for (let i = 0; i < this.hulls.length; i++) {
      const h = this.hulls[i]!;
      h.mesh.visible = false;
      if (h.uFlash !== null) h.uFlash.value = 0;
      if (h.uDissolve !== null) h.uDissolve.value = 0;
      if (h.uGlitch !== null) h.uGlitch.value = 0;
    }
    this.shields.begin();
    this.shields.commit();
  }
}

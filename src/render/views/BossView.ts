/**
 * Bosses: one non-instanced mesh per boss part (CAPACITY.bossParts; Race Condition twins, Fork Bomb splits) with
 * the shared `boss` neonSurface material. Per-mesh uniforms (hit flash, intro/death dissolve, enrage glitch,
 * tint) are applied in onBeforeRender from per-part scratch values, so one material serves every part.
 */
import { Group, Mesh, type BufferGeometry, type ShaderMaterial } from 'three';
import { BOSS_IDS, type BossId } from '../../contracts/ids';
import type { GeometryKey } from '../../contracts/render';
import { BOSS_COMMON, BOSS_DEFS } from '../../config/bosses';
import { CAPACITY } from '../../config/tuning';
import { lerpAngle } from '../../core/math';
import { TINT } from '../../shaders/tints';
import { findUniform } from '../uniforms';
import { lerp1, type FrameContext } from './types';

/** Seconds the death dissolve stays visible after a part dies. */
export const BOSS_DEATH_FADE = 0.7;

interface PartState {
  flash: number;
  dissolve: number;
  glitch: number;
  tint: number;
}

export class BossView {
  readonly root = new Group();
  private readonly meshes: Mesh[] = [];
  private readonly parts: PartState[] = [];
  private readonly geometries: Readonly<Record<BossId, BufferGeometry>>;

  constructor(material: ShaderMaterial, geometry: (k: GeometryKey) => BufferGeometry) {
    const geos: Partial<Record<BossId, BufferGeometry>> = {};
    for (const id of BOSS_IDS) geos[id] = geometry(`boss:${id}`);
    this.geometries = {
      forkBomb: geos.forkBomb!,
      raceCondition: geos.raceCondition!,
      kernel: geos.kernel!,
    };
    const uFlash = findUniform(material, 'uFlash');
    const uDissolve = findUniform(material, 'uDissolve');
    const uGlitch = findUniform(material, 'uGlitch');
    const uTint = findUniform(material, 'uTintIndex');
    for (let i = 0; i < CAPACITY.bossParts; i++) {
      const st: PartState = { flash: 0, dissolve: 0, glitch: 0, tint: TINT.ENEMY };
      const m = new Mesh(this.geometries.forkBomb, material);
      m.name = `boss:${String(i)}`;
      m.visible = false;
      m.frustumCulled = false;
      m.matrixAutoUpdate = false;
      m.onBeforeRender = (): void => {
        if (uFlash !== null) uFlash.value = st.flash;
        if (uDissolve !== null) uDissolve.value = st.dissolve;
        if (uGlitch !== null) uGlitch.value = st.glitch;
        if (uTint !== null) uTint.value = st.tint;
        material.uniformsNeedUpdate = true;
      };
      this.meshes.push(m);
      this.parts.push(st);
      this.root.add(m);
    }
  }

  sync(ctx: FrameContext): void {
    const bosses = ctx.world.bosses;
    const a = ctx.alpha;
    const now = ctx.world.time;
    for (let i = 0; i < this.meshes.length; i++) {
      const m = this.meshes[i]!;
      const b = i < bosses.length ? bosses[i]! : null;
      if (b === null) {
        m.visible = false;
        continue;
      }
      let dissolve = 0;
      if (!b.alive) {
        const since = b.deathTime >= 0 ? now - b.deathTime : Infinity;
        if (!(since < BOSS_DEATH_FADE)) {
          m.visible = false;
          continue;
        }
        dissolve = since / BOSS_DEATH_FADE;
      } else if (b.introTimer > 0) {
        dissolve = b.introTimer / BOSS_COMMON.INTRO_TIME;
      }
      const st = this.parts[i]!;
      st.flash = b.flash > 1 ? 1 : b.flash < 0 ? 0 : b.flash;
      st.dissolve = dissolve > 1 ? 1 : dissolve;
      st.glitch = b.enraged ? 0.55 : 0;
      st.tint = b.enraged ? TINT.ELITE : TINT.ENEMY;
      const geo = this.geometries[b.id];
      if (m.geometry !== geo) m.geometry = geo;
      const s = b.radius / BOSS_DEFS[b.id].radius;
      // Geometry is authored at world size with the hover height baked in.
      m.position.set(lerp1(b.prevX, b.x, a), 0, lerp1(b.prevZ, b.z, a));
      m.rotation.set(0, lerpAngle(b.prevYaw, b.yaw, a), 0);
      m.scale.setScalar(s > 0 ? s : 1);
      m.updateMatrix();
      m.visible = true;
    }
  }

  clear(): void {
    for (let i = 0; i < this.meshes.length; i++) this.meshes[i]!.visible = false;
  }
}

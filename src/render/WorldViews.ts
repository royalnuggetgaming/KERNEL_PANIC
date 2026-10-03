/**
 * Everything drawn for a live world: the 8 views, the fx systems and the FxDirector, wired to the library's
 * batches and rings. One instance, created at warm-up; attach/detach only clears counts (no GPU allocation).
 */
import { Group, type BufferGeometry, type ShaderMaterial } from 'three';
import type { BatchSet, GeometryKey, MaterialKey } from '../contracts/render';
import type { QualityPreset } from '../config/quality';
import { CAPACITY } from '../config/tuning';
import { createRng } from '../core/rng';
import type { SharedUniforms } from './assetTypes';
import type { GpuRingBuffer } from './GpuRingBuffer';
import type { InstanceBatch } from './InstanceBatch';
import { DamageNumbers, MAX_DIGITS_PER_FRAME } from './fx/DamageNumbers';
import { FxDirector, type CameraCues } from './fx/FxDirector';
import { ParticleSystem } from './fx/ParticleSystem';
import { ShockwaveSystem } from './fx/ShockwaveSystem';
import { TrailRenderer } from './fx/TrailRenderer';
import { TransientList } from './fx/TransientList';
import { BeamView } from './views/BeamView';
import { BossView } from './views/BossView';
import { DecalView } from './views/DecalView';
import { EnemyView } from './views/EnemyView';
import { MarkerView } from './views/MarkerView';
import { PickupView } from './views/PickupView';
import { PlayerView } from './views/PlayerView';
import { ProjectileView } from './views/ProjectileView';
import type { FrameContext } from './views/types';

export interface WorldAssets {
  getMaterial(key: MaterialKey): ShaderMaterial;
  getGeometry(key: GeometryKey): BufferGeometry;
  readonly uniforms: SharedUniforms;
}

/** Telegraph list size (the decal batch also carries glows and drone areas). */
const TELEGRAPHS = Math.max(8, CAPACITY.decals - 8);
const ARCS = Math.max(8, CAPACITY.beams - 16);

export class WorldViews {
  readonly root = new Group();
  readonly players: PlayerView;
  readonly enemies: EnemyView;
  readonly bosses: BossView;
  readonly projectiles: ProjectileView;
  readonly pickups: PickupView;
  readonly beams: BeamView;
  readonly decals: DecalView;
  readonly markers: MarkerView;
  readonly trails: TrailRenderer;
  readonly particles: ParticleSystem;
  readonly shockwaves: ShockwaveSystem;
  readonly digits: DamageNumbers;
  readonly fx: FxDirector;
  private readonly arcs = new TransientList(ARCS);
  private readonly telegraphs = new TransientList(TELEGRAPHS);
  private readonly set: BatchSet<InstanceBatch, GpuRingBuffer>;

  constructor(
    assets: WorldAssets,
    set: BatchSet<InstanceBatch, GpuRingBuffer>,
    cues: CameraCues,
    fxSeed: number,
  ) {
    this.set = set;
    this.root.name = 'world';
    const b = set.batches;
    const geo = (k: GeometryKey): BufferGeometry => assets.getGeometry(k);
    this.players = new PlayerView(
      [assets.getMaterial('hull:0'), assets.getMaterial('hull:1')],
      geo,
      b.shields,
    );
    this.enemies = new EnemyView(b);
    this.bosses = new BossView(assets.getMaterial('boss'), geo);
    this.projectiles = new ProjectileView(b);
    this.pickups = new PickupView(b.pickups);
    this.beams = new BeamView(b.beams);
    this.decals = new DecalView(b.decals);
    this.markers = new MarkerView(b.markers);
    this.trails = new TrailRenderer(assets.getMaterial('trail'), [
      assets.getGeometry('fx:trail:0'),
      assets.getGeometry('fx:trail:1'),
    ]);
    this.particles = new ParticleSystem(set.rings.particles, createRng(fxSeed));
    this.shockwaves = new ShockwaveSystem(set.rings.shockwaves, assets.uniforms.uRipples.value);
    this.digits = new DamageNumbers(set.rings.digits);
    this.fx = new FxDirector({
      particles: this.particles,
      shockwaves: this.shockwaves,
      digits: this.digits,
      arcs: this.arcs,
      telegraphs: this.telegraphs,
      cues,
      rng: createRng(fxSeed ^ 0x9e3779b9),
    });
    this.root.add(this.players.root, this.bosses.root, this.trails.root);
    const keys = Object.keys(b) as (keyof typeof b)[];
    for (const k of keys) this.root.add(b[k].mesh);
    this.root.add(set.rings.particles.mesh, set.rings.shockwaves.mesh, set.rings.digits.mesh);
  }

  /** Pure-FX budgets of the quality preset (particle emission + ring sizes, digits per frame). */
  applyQuality(p: QualityPreset): void {
    const r = this.set.rings;
    this.particles.setCap(p.particleCap);
    r.particles.setLimit(p.particleCap);
    r.digits.setLimit(p.digitCap);
    r.shockwaves.setLimit(p.shockwaveCap);
    this.digits.maxPerFrame = Math.min(MAX_DIGITS_PER_FRAME, p.digitsPerFrame);
  }

  sync(ctx: FrameContext, cameraDistance: number, reduceMotion: boolean): void {
    this.players.sync(ctx);
    this.enemies.sync(ctx);
    this.bosses.sync(ctx);
    this.projectiles.sync(ctx);
    this.pickups.sync(ctx);
    this.beams.sync(ctx, this.arcs);
    this.decals.sync(ctx, this.telegraphs);
    this.markers.sync(ctx, cameraDistance, reduceMotion);
    this.trails.sync(ctx);
    this.fx.update(ctx);
  }

  /**
   * Warm-up only (plan 10.6/10.7): shows the root and gives every batch one degenerate (scale 0) instance and
   * every ring a visible mesh, so the warm-up frames upload each buffer and VAO at Boot instead of on its first
   * visible Playing frame. endWarmup() empties them again.
   */
  primeForWarmup(): void {
    this.root.visible = true;
    const b = this.set.batches;
    const keys = Object.keys(b) as (keyof typeof b)[];
    for (const k of keys) {
      const batch = b[k];
      batch.begin();
      batch.push(0, 0, 0, 0, 0, 0, 0, 0);
      batch.commit();
    }
    this.set.rings.particles.mesh.visible = true;
    this.set.rings.shockwaves.mesh.visible = true;
    this.set.rings.digits.mesh.visible = true;
  }

  /** Undoes primeForWarmup(): empty batches, reset (hidden) rings. The caller restores root visibility. */
  endWarmup(): void {
    const b = this.set.batches;
    const keys = Object.keys(b) as (keyof typeof b)[];
    for (const k of keys) {
      const batch = b[k];
      batch.begin();
      batch.commit();
    }
    this.clear();
  }

  clear(): void {
    this.players.clear();
    this.enemies.clear();
    this.bosses.clear();
    this.projectiles.clear();
    this.pickups.clear();
    this.beams.clear();
    this.decals.clear();
    this.markers.clear();
    this.trails.clear();
    this.fx.reset();
  }

  dispose(): void {
    const b = this.set.batches;
    const keys = Object.keys(b) as (keyof typeof b)[];
    for (const k of keys) b[k].dispose();
    this.set.rings.particles.dispose();
    this.set.rings.shockwaves.dispose();
    this.set.rings.digits.dispose();
  }
}

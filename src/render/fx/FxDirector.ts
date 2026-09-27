/**
 * Maps SimEvents to particles, shockwaves, floor ripples, camera trauma, damage digits, arc beams and telegraph
 * decals (read-only drain: never clears channels), and emits the continuous effects (ghost wisps, thrusters, Patch
 * Drone motes, downed sparks). Visual randomness comes from its own fx rng, never the sim's. Honours reduce
 * flashes (fewer/larger-free bursts, no chromatic kick, softer hurt vignette). Allocation-free.
 */
import type { PlayerIndex } from '../../contracts/ids';
import type { Rng } from '../../contracts/sim';
import type { SimEvents } from '../../contracts/simEvents';
import { SOURCE_LINK, type DamageSource } from '../../contracts/simEvents';
import { DECAL_KIND } from '../../shaders/decal';
import { TINT } from '../../shaders/tints';
import type { FrameContext } from '../views/types';
import type { DamageNumbers } from './DamageNumbers';
import { burstSpec, type ParticleSystem, type XZ } from './ParticleSystem';
import type { ShockwaveSystem } from './ShockwaveSystem';
import type { TransientList } from './TransientList';
import { ContinuousEmitter } from './continuous';

export interface CameraCues {
  trauma(amount: number): void;
  bossIntro(x: number, z: number): void;
  countdownSwoop(): void;
}

export interface FxDirectorDeps {
  readonly particles: ParticleSystem;
  readonly shockwaves: ShockwaveSystem;
  readonly digits: DamageNumbers;
  readonly arcs: TransientList;
  readonly telegraphs: TransientList;
  readonly cues: CameraCues;
  readonly rng: Rng;
}

/** Hit sparks spawned per frame before further hits get a single spark. */
const HIT_SPARK_BUDGET = 48;
const HURT_DECAY = 1.6;
const ARC_LIFE = 0.14;

const SPARK = burstSpec(4, 4, 9, 0.28, 0.14, TINT.WHITE);
const KILL = burstSpec(14, 3, 11, 0.6, 0.22, TINT.ENEMY);
const BLAST = burstSpec(26, 5, 16, 0.8, 0.3, TINT.ENEMY_SHOT);
const PICK = burstSpec(5, 1, 3, 0.35, 0.12, TINT.PICKUP);
const RING = burstSpec(18, 6, 9, 0.45, 0.16, TINT.P1);
const MUZZLE = burstSpec(2, 6, 12, 0.12, 0.12, TINT.P1);
const PORTAL = burstSpec(10, 1, 4, 0.7, 0.18, TINT.ENEMY);
const ORIGIN: XZ = { x: 0, z: 0 };

export function sourceTint(src: DamageSource | -1): number {
  if (src === 0) return TINT.P1;
  if (src === 1) return TINT.P2;
  if (src === SOURCE_LINK) return TINT.LINK;
  return TINT.ENEMY_SHOT;
}

function playerTint(p: PlayerIndex): number {
  return p === 0 ? TINT.P1 : TINT.P2;
}

export class FxDirector {
  /** 0..1 hurt vignette driving PostFX. */
  hurt = 0;
  /** 0..1 chromatic kick (decays with hurt). */
  chromatic = 0;
  private reduceFlashes = false;
  private readonly d: FxDirectorDeps;
  private readonly continuous = new ContinuousEmitter();

  constructor(deps: FxDirectorDeps) {
    this.d = deps;
  }

  setReduceFlashes(on: boolean): void {
    this.reduceFlashes = on;
  }

  consume(e: SimEvents, t: number): void {
    const { particles: ps, shockwaves: sw, digits, cues } = this.d;
    const rf = this.reduceFlashes;
    for (let i = 0; i < e.shot.count; i++) {
      const s = e.shot.get(i);
      MUZZLE.tint = playerTint(s.owner);
      ps.cone(s, 0.9, 0.7, 0.35, t, MUZZLE);
    }
    for (let i = 0; i < e.hit.count; i++) {
      const h = e.hit.get(i);
      SPARK.count = i < HIT_SPARK_BUDGET ? (h.crit ? 7 : 4) : 1;
      SPARK.tint = h.target === 1 ? TINT.ENEMY_SHOT : h.target === 2 ? TINT.ACCENT : TINT.WHITE;
      ps.burst(h, 0.8, t, SPARK);
      if (h.target === 0 || h.target === 3) {
        digits.spawn(h, t, h.player === -1 ? TINT.WHITE : playerTint(h.player), h.crit);
      } else if (h.target === 1) {
        this.hurt = Math.max(this.hurt, rf ? 0.35 : 0.7);
        if (!rf) this.chromatic = Math.max(this.chromatic, 0.6);
        cues.trauma(0.22);
      } else {
        sw.spawn(h, t, 0.25, 1.4, 0.25, TINT.ACCENT, 0.6);
      }
    }
    for (let i = 0; i < e.kill.count; i++) {
      const k = e.kill.get(i);
      KILL.tint = k.elite ? TINT.ELITE : TINT.ENEMY;
      KILL.count = k.elite ? 24 : 14;
      ps.burst(k, 0.6, t, KILL);
      sw.spawn(k, t, 0.35, k.elite ? 3.2 : 2, 0.35, sourceTint(k.by), k.elite ? 1 : 0.6);
      if (k.elite) sw.ripple(k, t, 0.5);
      cues.trauma(k.elite ? 0.14 : 0.05);
    }
    for (let i = 0; i < e.explosion.count; i++) {
      const x = e.explosion.get(i);
      BLAST.count = Math.round(12 + 26 * x.power * (rf ? 0.5 : 1));
      ps.burst(x, 0.5, t, BLAST);
      sw.spawn(x, t, 0.5, x.radius * 1.2, 0.6, TINT.ENEMY_SHOT, x.power);
      sw.ripple(x, t, x.power);
      cues.trauma(0.35 * x.power);
    }
    for (let i = 0; i < e.enemyShot.count; i++) {
      const s = e.enemyShot.get(i);
      if (i >= 16 && !s.boss) continue;
      SPARK.count = 1;
      SPARK.tint = TINT.ENEMY_SHOT;
      ps.burst(s, 0.7, t, SPARK);
    }
    for (let i = 0; i < e.pickup.count; i++) {
      const p = e.pickup.get(i);
      PICK.count = p.value >= 25 ? 10 : p.value >= 5 ? 6 : 3;
      ps.burst(p, 0.5, t, PICK);
    }
    this.consumePlayers(e, t);
    this.consumeWorld(e, t);
  }

  private consumePlayers(e: SimEvents, t: number): void {
    const { particles: ps, shockwaves: sw, cues } = this.d;
    for (let i = 0; i < e.player.count; i++) {
      const p = e.player.get(i);
      const tint = playerTint(p.player);
      RING.tint = tint;
      switch (p.what) {
        case 'hurt':
          this.hurt = Math.max(this.hurt, this.reduceFlashes ? 0.35 : 0.7);
          cues.trauma(0.2);
          break;
        case 'downed':
        case 'eliminated':
          BLAST.count = 30;
          ps.burst(p, 0.6, t, BLAST);
          sw.spawn(p, t, 0.7, 6, 0.8, tint, 1);
          sw.ripple(p, t, 1);
          cues.trauma(0.35);
          break;
        case 'revived':
        case 'kernel':
        case 'reboot':
          RING.count = 22;
          ps.burst(p, 0.4, t, RING);
          sw.spawn(p, t, 0.6, 4, 0.5, tint, 1);
          break;
        case 'offline':
          RING.count = 16;
          ps.burst(p, 1, t, RING);
          break;
        case 'dash':
          RING.count = 8;
          ps.burst(p, 0.4, t, RING);
          break;
        case 'special':
          sw.spawn(p, t, 0.5, 5, 0.6, tint, 1);
          sw.ripple(p, t, 0.7);
          cues.trauma(0.12);
          break;
        case 'heal':
          PICK.count = 4;
          ps.burst(p, 0.6, t, PICK);
          break;
        case 'shieldBlock':
          sw.spawn(p, t, 0.3, 2, 0.3, TINT.ACCENT, 0.8);
          break;
      }
    }
    for (let i = 0; i < e.special.count; i++) {
      const s = e.special.get(i);
      if (s.kind === 'railburst') cues.trauma(0.25);
      if (s.kind === 'blinkSwarm') {
        RING.tint = playerTint(s.player);
        RING.count = 20;
        ps.burst(s, 0.6, t, RING);
      }
    }
    for (let i = 0; i < e.arc.count; i++) {
      const a = e.arc.get(i);
      const r = this.d.arcs.add();
      r.x0 = a.x0;
      r.z0 = a.z0;
      r.x1 = a.x1;
      r.z1 = a.z1;
      r.t0 = t;
      r.life = ARC_LIFE;
      r.size = 0;
      r.kind = 0;
      r.tint = a.owner === -1 ? TINT.ENEMY_SHOT : playerTint(a.owner);
      r.seed = this.d.rng.next();
    }
  }

  private consumeWorld(e: SimEvents, t: number): void {
    const { particles: ps, shockwaves: sw, cues, telegraphs } = this.d;
    for (let i = 0; i < e.telegraph.count; i++) {
      const g = e.telegraph.get(i);
      const r = telegraphs.add();
      r.x0 = g.x;
      r.z0 = g.z;
      r.x1 = g.shape === 1 ? Math.atan2(g.dirX, g.dirZ) : 0;
      r.z1 = 0;
      r.t0 = t;
      r.life = g.duration > 0 ? g.duration : 0.5;
      r.size = g.size;
      r.kind = g.shape === 1 ? DECAL_KIND.LINE : DECAL_KIND.CIRCLE;
      r.tint = TINT.ENEMY_SHOT;
      r.seed = this.d.rng.next();
    }
    for (let i = 0; i < e.spawn.count; i++) {
      const s = e.spawn.get(i);
      PORTAL.tint = s.elite ? TINT.ELITE : TINT.ENEMY;
      ps.burst(s, 0.2, t, PORTAL);
    }
    for (let i = 0; i < e.boss.count; i++) {
      const b = e.boss.get(i);
      switch (b.what) {
        case 'intro':
          if (b.part === 0) cues.bossIntro(b.x, b.z);
          sw.spawn(b, t, 1.2, 12, 1, TINT.ELITE, 1);
          sw.ripple(b, t, 1);
          break;
        case 'phase':
        case 'split':
        case 'enrage':
          BLAST.count = 30;
          ps.burst(b, 1, t, BLAST);
          sw.spawn(b, t, 0.8, 9, 0.8, TINT.ELITE, 1);
          sw.ripple(b, t, 1);
          cues.trauma(0.3);
          break;
        case 'respawn':
          sw.spawn(b, t, 0.8, 6, 0.6, TINT.ENEMY, 0.8);
          break;
        case 'dead':
          BLAST.count = this.reduceFlashes ? 40 : 80;
          ps.burst(b, 1, t, BLAST);
          sw.spawn(b, t, 1.4, 18, 1.2, TINT.ELITE, 1);
          sw.ripple(b, t, 1);
          cues.trauma(0.35);
          break;
      }
    }
    for (let i = 0; i < e.wave.count; i++) {
      const w = e.wave.get(i);
      switch (w.what) {
        case 'countdown':
        case 'roundStart':
          cues.countdownSwoop();
          break;
        case 'cleared':
        case 'roundEnd':
        case 'matchEnd':
          sw.ripple(ORIGIN, t, 1);
          sw.spawn(ORIGIN, t, 1.5, 30, 1.2, TINT.ACCENT, 0.8);
          break;
        case 'bossDead':
          cues.trauma(0.35);
          break;
        case 'suddenDeath':
          this.hurt = Math.max(this.hurt, 0.5);
          break;
        case 'start':
        case 'purge':
        case 'bossSpawn':
        case 'bossPhase':
        case 'bossEnrage':
        case 'sync':
        case 'comboTier':
          break;
      }
    }
  }

  /** Per-frame: continuous emitters, hurt decay (plus low-HP floor), ring uploads. */
  update(ctx: FrameContext): void {
    this.continuous.emit(this.d.particles, ctx);
    this.d.arcs.expire(ctx.time);
    this.d.telegraphs.expire(ctx.time);
    const w = ctx.world;
    let low = 0;
    for (let i = 0; i < 2; i++) {
      const p = w.players[i === 0 ? 0 : 1];
      if (p.life !== 'alive' || p.stats.maxHp <= 0) continue;
      const frac = p.hp / p.stats.maxHp;
      if (frac < 0.25) low = Math.max(low, (0.25 - frac) * 1.6);
    }
    const decay = HURT_DECAY * ctx.frameDt;
    this.hurt = Math.max(low * (0.75 + 0.25 * Math.sin(ctx.time * 6)), this.hurt - decay);
    this.chromatic = Math.max(0, this.chromatic - decay * 1.5);
    this.commit();
  }

  commit(): void {
    this.d.particles.commit();
    this.d.shockwaves.commit();
    this.d.digits.commit();
  }

  reset(): void {
    this.hurt = 0;
    this.chromatic = 0;
    this.d.particles.reset();
    this.d.shockwaves.reset();
    this.d.digits.reset();
    this.d.arcs.clear();
    this.d.telegraphs.clear();
  }
}

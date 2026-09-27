import { describe, expect, it } from 'vitest';
import { NO_HANDLE } from '../../src/contracts/ids';
import { PROJECTILE_KINDS } from '../../src/contracts/sim';
import { CAMERA, COOP, OVERDRIVE, PICKUPS } from '../../src/config/tuning';
import { TransientList } from '../../src/render/fx/TransientList';
import { ARC_CHORDS, BeamView } from '../../src/render/views/BeamView';
import { DecalView } from '../../src/render/views/DecalView';
import { ELITE_SCALE, EnemyView } from '../../src/render/views/EnemyView';
import { bleedTotal, MarkerView, markerTarget, reviveFraction } from '../../src/render/views/MarkerView';
import { pickupBlink, pickupScale, PickupView } from '../../src/render/views/PickupView';
import { hullFlash } from '../../src/render/views/PlayerView';
import {
  isMissileKind,
  projectileTint,
  ProjectileView,
  SparseShotTracker,
} from '../../src/render/views/ProjectileView';
import { lerp1, seed01 } from '../../src/render/views/types';
import { BEAM_KIND } from '../../src/shaders/beam';
import { DECAL_KIND } from '../../src/shaders/decal';
import { MARKER_KIND } from '../../src/shaders/marker';
import { encodeStyle, TINT } from '../../src/shaders/tints';
import {
  addTestEnemy,
  addTestEnemyShot,
  addTestPickup,
  addTestPlayerShot,
  createTestWorld,
  placePlayer,
} from '../helpers/worldFixture';
import { FakeBatch, frameCtx } from './renderFakes';

function enemyBatches(
  cap = 16,
): Record<
  'enemy:shard' | 'enemy:dart' | 'enemy:fork' | 'enemy:spiker' | 'enemy:warden' | 'enemy:leech',
  FakeBatch
> {
  return {
    'enemy:shard': new FakeBatch(cap),
    'enemy:dart': new FakeBatch(cap),
    'enemy:fork': new FakeBatch(cap),
    'enemy:spiker': new FakeBatch(cap),
    'enemy:warden': new FakeBatch(cap),
    'enemy:leech': new FakeBatch(cap),
  };
}

describe('helpers', () => {
  it('seed01 stays in [0, 1) and lerp1 interpolates', () => {
    for (const n of [0, 1, 4098, 4099, 0xffffffff, -5]) {
      expect(seed01(n)).toBeGreaterThanOrEqual(0);
      expect(seed01(n)).toBeLessThan(1);
    }
    expect(lerp1(2, 6, 0.25)).toBe(3);
  });
});

describe('EnemyView', () => {
  it('routes enemies to their kind batch with interpolated transforms', () => {
    const w = createTestWorld();
    const e = addTestEnemy(w, 'dart', 10, 4);
    e.prevX = 6;
    e.prevZ = 0;
    e.prevYaw = 0;
    e.yaw = 1;
    e.flash = 3;
    e.age = 2;
    addTestEnemy(w, 'shard', 0, 0, { elite: true });
    const b = enemyBatches();
    const v = new EnemyView(b);
    v.sync(frameCtx(w, 0.5, 100));
    expect(b['enemy:dart'].count).toBe(1);
    expect(b['enemy:shard'].count).toBe(1);
    expect(b['enemy:fork'].count).toBe(0);
    const r = b['enemy:dart'].rec(0);
    expect(r[0]).toBeCloseTo(8);
    expect(r[1]).toBeCloseTo(2);
    expect(r[2]).toBeCloseTo(0.5);
    expect(r[3]).toBe(1);
    expect(r[4]).toBe(1);
    expect(r[5]).toBe(98);
    expect(r[6]).toBe(TINT.ENEMY);
    const s = b['enemy:shard'].rec(0);
    expect(s[3]).toBeCloseTo(ELITE_SCALE);
    expect(s[6]).toBe(TINT.ELITE);
    for (const k of Object.values(b)) expect(k.commits).toBe(1);
    v.clear();
    expect(b['enemy:dart'].count).toBe(0);
  });

  it('writes a negative spawnT (death dissolve) for dying enemies', () => {
    const w = createTestWorld();
    const e = addTestEnemy(w, 'fork', 0, 0);
    const b = enemyBatches();
    const v = new EnemyView(b);
    v.sync(frameCtx(w, 1, 40));
    expect(b['enemy:fork'].rec(0)[5]).toBeGreaterThan(0);
    e.dying = true;
    v.sync(frameCtx(w, 1, 50));
    expect(b['enemy:fork'].rec(0)[5]).toBe(-50);
    // Latched: the death start does not move while the dissolve plays.
    v.sync(frameCtx(w, 1, 50.3));
    expect(b['enemy:fork'].rec(0)[5]).toBe(-50);
    // A new enemy in the same slot starts alive again.
    w.enemies.despawn(e);
    const e2 = addTestEnemy(w, 'fork', 1, 1);
    expect(e2.slot).toBe(e.slot);
    v.sync(frameCtx(w, 1, 51));
    expect(b['enemy:fork'].rec(0)[5]).toBeGreaterThan(0);
  });
});

describe('ProjectileView (sparse linear bullets)', () => {
  it('writes a linear bullet once on spawn, not again while it flies, and zeroes it on despawn', () => {
    const w = createTestWorld();
    const s = addTestPlayerShot(w, 1, 2, 3, 0, 20);
    s.spawnTime = 0.5;
    const batch = new FakeBatch(64);
    const t = new SparseShotTracker(batch);
    t.sync(w.playerShots, frameCtx(w), true);
    expect(t.writes).toBe(1);
    const r = batch.rec(s.slot);
    expect(r[0]).toBe(2);
    expect(r[1]).toBe(3);
    expect(r[2]).toBeCloseTo(0);
    expect(r[3]).toBeCloseTo(20);
    expect(r[4]).toBeCloseTo(0.25);
    expect(r[5]).toBe(0.5);
    expect(r[6]).toBe(TINT.P2);
    expect(batch.count).toBe(s.slot + 1);
    expect(batch.lastDense).toBe(false);
    s.x += 1;
    s.prevX = s.x - 0.2;
    t.sync(w.playerShots, frameCtx(w), true);
    expect(t.writes).toBe(0);
    w.playerShots.despawn(s);
    t.sync(w.playerShots, frameCtx(w), true);
    expect(t.writes).toBe(1);
    expect(batch.rec(s.slot)[4]).toBe(0);
    expect(batch.count).toBe(0);
    t.sync(w.playerShots, frameCtx(w), true);
    expect(t.writes).toBe(0);
  });

  it('rebases on a velocity change, rewrites a reused slot and rewrites homing shots every frame', () => {
    const w = createTestWorld();
    const s = addTestEnemyShot(w, 0, 0, 5, 0);
    const batch = new FakeBatch(64);
    const t = new SparseShotTracker(batch);
    t.sync(w.enemyShots, frameCtx(w), false);
    expect(batch.rec(s.slot)[6]).toBe(TINT.ENEMY_SHOT);
    w.time = 2;
    s.x = 4;
    s.z = 1;
    s.vx = -5;
    t.sync(w.enemyShots, frameCtx(w), false);
    expect(t.writes).toBe(1);
    const r = batch.rec(s.slot);
    expect(r[0]).toBe(4);
    expect(r[1]).toBe(1);
    expect(r[5]).toBe(2);
    // Despawn + respawn into the same slot within one frame: new seq => rewritten.
    w.enemyShots.despawn(s);
    const s2 = addTestEnemyShot(w, 9, 9, 0, 3);
    expect(s2.slot).toBe(s.slot);
    t.sync(w.enemyShots, frameCtx(w), false);
    expect(batch.rec(s2.slot)[0]).toBe(9);
    s2.homing = 5;
    t.sync(w.enemyShots, frameCtx(w), false);
    t.sync(w.enemyShots, frameCtx(w), false);
    expect(t.writes).toBe(1);
    expect(batch.rec(s2.slot)[3]).toBe(0);
    s2.homing = NO_HANDLE;
    t.sync(w.enemyShots, frameCtx(w), false);
    expect(t.writes).toBe(1);
    t.sync(w.enemyShots, frameCtx(w), false);
    expect(t.writes).toBe(0);
    t.clear();
    expect(batch.count).toBe(0);
  });

  it('draws missiles and mines in the dense batch, not the sparse one', () => {
    const w = createTestWorld();
    addTestPlayerShot(w, 0, 0, 0, 0, 10);
    const m = addTestPlayerShot(w, 0, 5, 5, 1, 0, 10, { kind: PROJECTILE_KINDS.missile, radius: 0.4 });
    const b = { playerShots: new FakeBatch(64), enemyShots: new FakeBatch(64), missiles: new FakeBatch(8) };
    const v = new ProjectileView(b);
    v.sync(frameCtx(w));
    expect(b.missiles.count).toBe(1);
    expect(b.missiles.rec(0)[0]).toBe(5);
    expect(b.missiles.rec(0)[3]).toBe(0);
    expect(b.playerShots.rec(m.slot)[4]).toBe(0);
    expect(v.player.writes).toBe(1);
    v.clear();
    expect(b.missiles.count).toBe(0);
    expect(isMissileKind(PROJECTILE_KINDS.mine)).toBe(true);
    expect(isMissileKind(PROJECTILE_KINDS.bolt)).toBe(false);
    expect(projectileTint(0)).toBe(TINT.P1);
    expect(projectileTint(2)).toBe(TINT.LINK);
    expect(projectileTint(-1)).toBe(TINT.ENEMY_SHOT);
  });
});

describe('PickupView', () => {
  it('packs denomination scale, blink and spawn time', () => {
    const w = createTestWorld();
    const p = addTestPickup(w, 3, 4, 25);
    p.age = 1;
    const b = new FakeBatch(8);
    new PickupView(b).sync(frameCtx(w, 1, 10));
    const r = b.rec(0);
    expect(r[3]).toBeCloseTo(pickupScale(25));
    expect(r[5]).toBe(9);
    expect(r[6]).toBe(TINT.PICKUP);
    expect(pickupScale(1)).toBeLessThan(pickupScale(5));
    expect(pickupBlink(1)).toBe(0);
    let on = 0;
    for (let t = PICKUPS.BLINK_AT; t < PICKUPS.BLINK_AT + 1; t += 0.01) if (pickupBlink(t) > 0) on++;
    expect(on).toBeGreaterThan(20);
    expect(on).toBeLessThan(80);
  });
});

describe('MarkerView', () => {
  it('shows chevrons only when zoomed out past MARKER_DIST, easing in', () => {
    const w = createTestWorld();
    placePlayer(w, 0, 1, 2);
    const b = new FakeBatch(8);
    const v = new MarkerView(b);
    v.sync(frameCtx(w), CAMERA.MARKER_DIST - 1, false);
    expect(b.count).toBe(0);
    for (let i = 0; i < 240; i++) v.sync(frameCtx(w), CAMERA.MARKER_DIST + 20, false);
    expect(b.count).toBe(2);
    expect(b.rec(0)[3]).toBeCloseTo(CAMERA.MARKER_PX);
    expect(b.rec(0)[6]).toBe(encodeStyle(MARKER_KIND.CHEVRON, TINT.P1));
    expect(markerTarget(CAMERA.MARKER_DIST)).toBe(0);
    expect(markerTarget(1000)).toBe(1);
    v.clear();
    expect(v.fade[0]).toBe(0);
  });

  it('downed players get bleed-out and revive arcs (not in versus); alive get dash/special rings', () => {
    const w = createTestWorld();
    const p = w.players[1];
    p.life = 'downed';
    p.downsThisWave = 1;
    p.bleedLeft = 6;
    p.reviveProgress = 0.4;
    const a = w.players[0];
    a.dashCooldownLeft = a.stats.dashCooldown / 2;
    a.overdrive = OVERDRIVE.MAX / 4;
    const b = new FakeBatch(8);
    new MarkerView(b).sync(frameCtx(w), 30, true);
    const styles = [0, 1, 2, 3].map((i) => b.rec(i)[6]);
    expect(styles).toEqual([
      encodeStyle(MARKER_KIND.DASH, TINT.P1),
      encodeStyle(MARKER_KIND.SPECIAL, TINT.P1),
      encodeStyle(MARKER_KIND.BLEED, TINT.P2),
      encodeStyle(MARKER_KIND.REVIVE, TINT.P2),
    ]);
    expect(b.rec(0)[4]).toBeCloseTo(0.5);
    expect(b.rec(1)[4]).toBeCloseTo(0.25);
    expect(b.rec(2)[4]).toBeCloseTo(6 / COOP.BLEED_OUT);
    expect(b.rec(3)[4]).toBeCloseTo(reviveFraction(p));
    expect(bleedTotal(1)).toBe(12);
    expect(bleedTotal(3)).toBe(8);
    expect(bleedTotal(9)).toBe(COOP.BLEED_MIN);

    const vs = createTestWorld({ mode: 'versus' });
    vs.players[0].life = 'downed';
    const b2 = new FakeBatch(8);
    new MarkerView(b2).sync(frameCtx(vs), 30, true);
    expect(b2.count).toBe(0);
  });
});

describe('BeamView and DecalView', () => {
  it('draws the co-op link between interpolated players, arcs and laser chords', () => {
    const w = createTestWorld();
    placePlayer(w, 0, -3, 0);
    placePlayer(w, 1, 5, 0);
    w.link.active = true;
    const arcs = new TransientList(4);
    const r = arcs.add();
    Object.assign(r, { x0: 0, z0: 0, x1: 1, z1: 1, t0: 99.9, life: 0.2, tint: TINT.P2, seed: 0.3 });
    const l = w.lasers.spawn()!;
    Object.assign(l, {
      shape: 1,
      x: 0,
      z: 0,
      angle: 0,
      angularVel: 0,
      length: 0,
      width: 0.5,
      radius: 10,
      arcHalf: 0.4,
      warmup: 0.5,
      life: 3,
      damage: 1,
    });
    const b = new FakeBatch(32);
    new BeamView(b).sync(frameCtx(w, 1, 100), arcs);
    expect(b.count).toBe(2 + ARC_CHORDS);
    expect(b.rec(0).slice(0, 4)).toEqual([-3, 0, 5, 0]);
    expect(b.rec(0)[6]).toBe(encodeStyle(BEAM_KIND.LINK, TINT.LINK));
    expect(b.rec(1)[6]).toBe(encodeStyle(BEAM_KIND.ARC, TINT.P2));
    expect(b.rec(2)[6]).toBe(encodeStyle(BEAM_KIND.LASER_WARN, TINT.ENEMY_SHOT));
    const last = b.rec(1 + ARC_CHORDS);
    expect(Math.hypot(last[2]!, last[3]!)).toBeCloseTo(10);
  });

  it('draws glows under players and telegraphs with fill progress', () => {
    const w = createTestWorld();
    const tl = new TransientList(4);
    const r = tl.add();
    Object.assign(r, {
      x0: 2,
      z0: 3,
      x1: 0.5,
      z1: 0,
      t0: 99,
      life: 2,
      size: 4,
      kind: DECAL_KIND.LINE,
      tint: TINT.ENEMY_SHOT,
      seed: 0.1,
    });
    const b = new FakeBatch(16);
    new DecalView(b).sync(frameCtx(w, 1, 100), tl);
    expect(b.count).toBe(3);
    expect(b.rec(0)[6]).toBe(encodeStyle(DECAL_KIND.GLOW, TINT.P1));
    const t = b.rec(2);
    expect(t.slice(0, 4)).toEqual([2, 3, 0.5, 4]);
    expect(t[4]).toBeCloseTo(0.5);
    expect(t[6]).toBe(encodeStyle(DECAL_KIND.LINE, TINT.ENEMY_SHOT));
  });
});

describe('PlayerView hullFlash', () => {
  it('combines hit flash, invulnerability blink and the downed pulse', () => {
    const w = createTestWorld();
    const p = w.players[0];
    p.hitFlash = 0.5;
    expect(hullFlash(p, 0, 0)).toBe(0.5);
    p.hitFlash = 0;
    p.invulnUntil = 10;
    expect(hullFlash(p, 1, 0)).toBeCloseTo(0.35);
    p.life = 'downed';
    expect(hullFlash(p, 1, 0)).toBeGreaterThan(0);
  });
});

describe('TransientList', () => {
  it('expires by age with swap-remove and reuses the oldest when full', () => {
    const l = new TransientList(2);
    const a = l.add();
    a.t0 = 0;
    a.life = 1;
    const b = l.add();
    b.t0 = 5;
    b.life = 1;
    expect(l.add()).toBe(a);
    l.expire(5.5);
    expect(l.count).toBe(1);
    expect(l.items[0]).toBe(b);
    l.clear();
    expect(l.count).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { NO_HANDLE } from '../../src/contracts/ids';
import { PROJECTILE_KINDS, type ProjectileSpec } from '../../src/contracts/sim';
import { ARENA, SIM } from '../../src/config/tuning';
import { CARD_BIT } from '../../src/entities/cardBits';
import { spawnProjectile, stepProjectiles } from '../../src/entities/projectiles';
import { RATE, effectiveFireRate, stepWeapons } from '../../src/entities/weapons';
import { createIntents } from '../helpers/scriptedIntents';
import { addTestEnemy, createTestWorld, stepSystem } from '../helpers/worldFixture';

function firing(): ReturnType<typeof createIntents> {
  const it = createIntents();
  it[0].fireHeld = true;
  return it;
}

function soloWorld(vehicle: 'lancer' | 'bulwark' | 'specter' | 'tinker' = 'lancer') {
  return createTestWorld({ mode: 'solo', vehicles: [vehicle, vehicle] });
}

/** A world whose P1 barrels are primed (the first held tick fires). */
function primed(vehicle: 'lancer' | 'bulwark' | 'specter' | 'tinker' = 'lancer') {
  const w = soloWorld(vehicle);
  w.players[0].fireAcc = 1;
  return w;
}

describe('weapons: cadence', () => {
  it('fireRate 20/s gives exactly 20 volleys per simulated second', () => {
    const w = soloWorld();
    w.players[0].stats.fireRate = 20;
    stepSystem(w, stepWeapons, SIM.HZ, firing());
    expect(w.playerShots.count).toBe(20);
    expect(w.events.shot.count).toBe(20);
  });

  it('base Lancer fires 9 shots/s, and several shots per tick when the rate exceeds the tick rate', () => {
    const w = soloWorld();
    stepSystem(w, stepWeapons, SIM.HZ, firing());
    expect(w.playerShots.count).toBe(9);
    const w2 = soloWorld();
    w2.players[0].stats.fireRate = 240; // raw rate above the cap is clamped to 20/s
    stepSystem(w2, stepWeapons, SIM.HZ, firing());
    expect(w2.playerShots.count).toBe(20);
  });

  it('idle barrels stay primed and nothing fires without fireHeld or while locked', () => {
    const w = soloWorld();
    stepSystem(w, stepWeapons, 60);
    expect(w.playerShots.count).toBe(0);
    expect(w.players[0].fireAcc).toBe(1);
    stepSystem(w, stepWeapons, 1, firing());
    expect(w.playerShots.count).toBe(1);
    w.run.phase = 'clearOutro';
    stepSystem(w, stepWeapons, 120, firing());
    expect(w.playerShots.count).toBe(1);
  });

  it('downed players do not fire', () => {
    const w = soloWorld();
    w.players[0].life = 'downed';
    stepSystem(w, stepWeapons, 120, firing());
    expect(w.playerShots.count).toBe(0);
  });
});

describe('weapons: overflow and Overheat', () => {
  it('rate above 20/s becomes a damage multiplier', () => {
    const w = soloWorld();
    const p = w.players[0];
    p.stats.fireRate = 18;
    p.cards.overheatActive = true;
    effectiveFireRate(p);
    expect(RATE.rate).toBe(20);
    expect(RATE.mul).toBeCloseTo((18 * 1.4) / 20, 10);
    p.cards.overheatActive = false;
    effectiveFireRate(p);
    expect(RATE.rate).toBe(18);
    expect(RATE.mul).toBe(1);
  });

  it('overflow damage is applied to every projectile', () => {
    const w = soloWorld();
    const p = w.players[0];
    p.stats.fireRate = 20;
    p.cards.overheatActive = true;
    stepSystem(w, stepWeapons, 6, firing());
    expect(w.playerShots.count).toBe(1);
    expect(w.playerShots.active[0]!.damage).toBeCloseTo(10 * 1.4, 10);
  });
});

describe('weapons: volley shapes and flags', () => {
  it('Bulwark fires a 3-pellet spread', () => {
    const w = primed('bulwark');
    stepSystem(w, stepWeapons, 1, firing());
    expect(w.playerShots.count).toBe(3);
    for (let i = 0; i < 3; i++) expect(w.playerShots.active[i]!.kind).toBe(PROJECTILE_KINDS.pellet);
  });

  it('split shot adds 2 side bullets at +-12 deg; the total respects the 5-projectile cap', () => {
    const w = primed();
    const p = w.players[0];
    p.cardStacks[CARD_BIT.splitShot] = 1;
    p.stats.spreadDeg = 0;
    p.aimX = 0;
    p.aimZ = 1;
    stepSystem(w, stepWeapons, 1, firing());
    expect(w.playerShots.count).toBe(3);
    const angles = [0, 1, 2].map((i) => {
      const s = w.playerShots.active[i]!;
      return Math.round((Math.atan2(s.vx, s.vz) * 180) / Math.PI);
    });
    expect(angles.sort((a, b) => a - b)).toEqual([-12, 0, 12]);
    const w2 = primed('bulwark');
    w2.players[0].cardStacks[CARD_BIT.splitShot] = 2;
    stepSystem(w2, stepWeapons, 1, firing());
    expect(w2.playerShots.count).toBe(5);
  });

  it('pierce, bounces and projectile kinds come from stats and the vehicle', () => {
    const w = primed('specter');
    const p = w.players[0];
    p.stats.bounces = 2;
    stepSystem(w, stepWeapons, 1, firing());
    const s = w.playerShots.active[0]!;
    expect(s.pierce).toBe(1);
    expect(s.bounces).toBe(2);
    expect(s.kind).toBe(PROJECTILE_KINDS.needle);
    expect(s.owner).toBe(0);
    const t = primed('tinker');
    stepSystem(t, stepWeapons, 1, firing());
    expect(t.playerShots.active[0]!.kind).toBe(PROJECTILE_KINDS.arc);
  });

  it('focus adds 15% damage and tightens spread', () => {
    const w = primed('bulwark');
    const it = firing();
    it[0].focusHeld = true;
    w.players[0].aimX = 0;
    w.players[0].aimZ = 1;
    stepSystem(w, stepWeapons, 1, it);
    const shots = [0, 1, 2].map((i) => w.playerShots.active[i]!);
    expect(shots[0]!.damage).toBeCloseTo(9 * 1.15, 10);
    const maxAngle = Math.max(...shots.map((s) => Math.abs((Math.atan2(s.vx, s.vz) * 180) / Math.PI)));
    expect(maxAngle).toBeCloseTo(14 * 0.4, 6);
  });

  it('critChance 1 doubles damage and flags crit', () => {
    const w = primed();
    w.players[0].stats.critChance = 1;
    stepSystem(w, stepWeapons, 1, firing());
    const s = w.playerShots.active[0]!;
    expect(s.crit).toBe(true);
    expect(s.damage).toBe(20);
  });

  it('FORK() doubles every 5th volley', () => {
    const w = primed();
    const p = w.players[0];
    p.cardStacks[CARD_BIT.forkCall] = 1;
    p.stats.fireRate = 20;
    stepSystem(w, stepWeapons, 24, firing()); // 5 volleys (primed + 4)
    expect(w.events.shot.count).toBe(5);
    expect(w.playerShots.count).toBe(6);
  });

  it('shots travel along the aim direction from the muzzle', () => {
    const w = primed();
    const p = w.players[0];
    p.stats.spreadDeg = 0;
    p.aimX = 1;
    p.aimZ = 0;
    stepSystem(w, stepWeapons, 1, firing());
    const s = w.playerShots.active[0]!;
    expect(s.vx).toBeCloseTo(48, 6);
    expect(Math.abs(s.vz)).toBeLessThan(1e-9);
    expect(s.x).toBeGreaterThan(p.x);
  });
});

function spec(patch: Partial<ProjectileSpec> = {}): ProjectileSpec {
  return {
    side: 'player',
    owner: 0,
    kind: PROJECTILE_KINDS.bolt,
    x: 0,
    z: 0,
    vx: 10,
    vz: 0,
    damage: 5,
    radius: 0.2,
    life: 1,
    pierce: 0,
    bounces: 0,
    crit: false,
    homing: NO_HANDLE,
    ...patch,
  };
}

describe('projectiles', () => {
  it('player side recycles the oldest; enemy side returns null when full', () => {
    const w = soloWorld();
    const first = spawnProjectile(w, spec())!;
    const firstSeq = first.seq;
    for (let i = 1; i < w.playerShots.capacity; i++) spawnProjectile(w, spec());
    expect(w.playerShots.count).toBe(w.playerShots.capacity);
    const extra = spawnProjectile(w, spec({ damage: 99 }));
    expect(extra).not.toBeNull();
    expect(w.playerShots.count).toBe(w.playerShots.capacity);
    const seqs = w.playerShots.active.slice(0, w.playerShots.count).map((s) => s.seq);
    expect(seqs).not.toContain(firstSeq);
    for (let i = 0; i < w.enemyShots.capacity; i++) spawnProjectile(w, spec({ side: 'enemy' }));
    expect(spawnProjectile(w, spec({ side: 'enemy' }))).toBeNull();
  });

  it('integrates linearly, expires, and records prev positions', () => {
    const w = soloWorld();
    const s = spawnProjectile(w, spec({ life: 0.05 }))!;
    stepSystem(w, stepProjectiles, 1);
    expect(s.prevX).toBe(0);
    expect(s.x).toBeCloseTo(10 * SIM.DT, 10);
    stepSystem(w, stepProjectiles, 10);
    expect(w.playerShots.count).toBe(0);
  });

  it('bounces off the arena wall when bounces remain, else despawns', () => {
    const w = soloWorld();
    const b = spawnProjectile(w, spec({ x: ARENA.RADIUS - 0.1, vx: 30, bounces: 1, life: 5 }))!;
    stepSystem(w, stepProjectiles, 2);
    expect(b.vx).toBeLessThan(0);
    expect(b.bounces).toBe(0);
    expect(w.playerShots.isAlive(b)).toBe(true);
    spawnProjectile(w, spec({ side: 'enemy', x: ARENA.RADIUS - 0.1, vx: 30 }));
    stepSystem(w, stepProjectiles, 2);
    expect(w.enemyShots.count).toBe(0);
  });

  it('homing missiles turn toward their target; mines seek enemies in range', () => {
    const w = soloWorld();
    const e = addTestEnemy(w, 'shard', 0, 10);
    const m = spawnProjectile(
      w,
      spec({ kind: PROJECTILE_KINDS.missile, vx: 22, vz: 0, homing: w.enemies.handleOf(e), life: 3 }),
    )!;
    stepSystem(w, stepProjectiles, 30);
    expect(m.vz).toBeGreaterThan(0);
    const mine = spawnProjectile(w, spec({ kind: PROJECTILE_KINDS.mine, x: 0, z: 6, vx: 0, life: 3 }))!;
    stepSystem(w, stepProjectiles, 1);
    expect(mine.vz).toBeGreaterThan(0);
    const idle = spawnProjectile(w, spec({ kind: PROJECTILE_KINDS.mine, x: -25, z: -10, vx: 0, life: 3 }))!;
    stepSystem(w, stepProjectiles, 1);
    expect(idle.vx).toBe(0);
    expect(idle.vz).toBe(0);
  });
});

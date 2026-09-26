import { describe, expect, it } from 'vitest';
import { PROJECTILE_KINDS } from '../../src/contracts/sim';
import { createRng } from '../../src/core/rng';
import { ENEMY_DEFS } from '../../src/config/enemies';
import { COOP, SIM } from '../../src/config/tuning';
import { VEHICLES } from '../../src/config/vehicles';
import { VERSUS } from '../../src/config/versus';
import { stepProjectiles } from '../../src/entities/projectiles';
import { LASER_TICK, stepCollision } from '../../src/sim/collision';
import {
  addTestEnemy,
  addTestEnemyShot,
  addTestPlayerShot,
  createTestWorld,
  placePlayer,
  stepSystem,
} from '../helpers/worldFixture';

type W = ReturnType<typeof createTestWorld>;

function tick(w: W, n = 1): void {
  for (let i = 0; i < n; i++) {
    stepProjectiles(w, [defaultIntent(), defaultIntent()], SIM.DT);
    stepCollision(w, [defaultIntent(), defaultIntent()], SIM.DT);
    w.tick++;
    w.time = w.tick * SIM.DT;
  }
}

function defaultIntent() {
  return { moveX: 0, moveZ: 0, fireHeld: false, focusHeld: false, dashPressed: false, specialPressed: false };
}

const MAX_SPEED = Math.max(...Object.values(VEHICLES).map((v) => v.weapon.projectileSpeed));

describe('collision: swept player shots', () => {
  it('never tunnels at 3x the maximum projectile speed (500 seeded layouts)', () => {
    const rng = createRng(99);
    const speed = MAX_SPEED * 3;
    let hits = 0;
    for (let k = 0; k < 500; k++) {
      const w = createTestWorld({ mode: 'solo' });
      placePlayer(w, 0, 0, 30); // keep the player out of the way
      // Enemy and shot origin stay inside the arena (shots outside it despawn at the wall).
      const ex = rng.range(-14, 14);
      const ez = rng.range(-14, 14);
      const e = addTestEnemy(w, 'shard', ex, ez, { hp: 1e6, maxHp: 1e6 });
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(3, 10);
      const sx = ex - Math.sin(a) * d;
      const sz = ez - Math.cos(a) * d;
      // Lateral offset strictly inside the combined radius.
      const off = rng.range(-0.95, 0.95) * (e.radius + 0.18);
      const ox = Math.cos(a) * off;
      const oz = -Math.sin(a) * off;
      addTestPlayerShot(w, 0, sx + ox, sz + oz, Math.sin(a) * speed, Math.cos(a) * speed, 10, { radius: 0.18 });
      tick(w, 20);
      if (e.hp < 1e6) hits++;
    }
    expect(hits).toBe(500);
  });

  it('misses just outside the combined radius', () => {
    const w = createTestWorld({ mode: 'solo' });
    placePlayer(w, 0, 0, 30);
    const e = addTestEnemy(w, 'shard', 0, 0);
    const clear = e.radius + 0.25 + 0.01;
    addTestPlayerShot(w, 0, -10, clear, MAX_SPEED * 3, 0);
    tick(w, 20);
    expect(e.hp).toBe(ENEMY_DEFS.shard.hp);
  });

  it('pierce hits several enemies in one sweep and never the same enemy twice in a row', () => {
    const w = createTestWorld({ mode: 'solo' });
    placePlayer(w, 0, 0, 30);
    const a = addTestEnemy(w, 'spiker', 1, 0);
    const b = addTestEnemy(w, 'spiker', 2.5, 0);
    const c = addTestEnemy(w, 'spiker', 12, 0);
    const s = addTestPlayerShot(w, 0, 0, 0, 480, 0, 10, { pierce: 1 });
    tick(w, 1);
    expect(a.hp).toBe(50);
    expect(b.hp).toBe(50);
    expect(w.playerShots.isAlive(s)).toBe(false);
    expect(c.hp).toBe(60);
    const w2 = createTestWorld({ mode: 'solo' });
    placePlayer(w2, 0, 0, 30);
    const fat = addTestEnemy(w2, 'spiker', 1, 0, { radius: 3 });
    addTestPlayerShot(w2, 0, 0, 0, 30, 0, 10, { pierce: 3 });
    tick(w2, 10);
    expect(fat.hp).toBe(50);
  });

  it('a Warden front shield consumes the shot; flank shots hurt', () => {
    const w = createTestWorld({ mode: 'solo' });
    placePlayer(w, 0, 0, 30);
    const e = addTestEnemy(w, 'warden', 0, 0, { yaw: -Math.PI / 2 }); // faces -X
    const s = addTestPlayerShot(w, 0, -3, 0, 60, 0, 10, { pierce: 4 });
    tick(w, 10);
    expect(e.hp).toBe(ENEMY_DEFS.warden.hp);
    expect(w.playerShots.isAlive(s)).toBe(false);
    addTestPlayerShot(w, 0, 3, 0, -60, 0, 10);
    tick(w, 10);
    expect(e.hp).toBe(ENEMY_DEFS.warden.hp - 10);
  });

  it('hits boss parts, skips dying enemies, and chains Tinker arc shots', () => {
    const w = createTestWorld({ mode: 'solo' });
    placePlayer(w, 0, 0, 30);
    const b = w.bosses[0]!;
    Object.assign(b, { alive: true, hp: 100, maxHp: 100, radius: 2, x: 5, z: 0, introTimer: 0 });
    addTestPlayerShot(w, 0, 0, 0, 60, 0, 10);
    tick(w, 10);
    expect(b.hp).toBe(90);
    b.alive = false;
    const dying = addTestEnemy(w, 'spiker', 5, 0, { dying: true });
    const next = addTestEnemy(w, 'spiker', 8, 0);
    const chained = addTestEnemy(w, 'spiker', 8, 5);
    addTestPlayerShot(w, 0, 0, 0, 60, 0, 12, { kind: PROJECTILE_KINDS.arc });
    tick(w, 20);
    expect(dying.hp).toBe(60);
    expect(next.hp).toBe(48);
    expect(chained.hp).toBe(48);
  });
});

describe('collision: enemy shots, contact, lasers', () => {
  it('enemy shots hit players; dash i-frames let them pass', () => {
    const w = createTestWorld({ mode: 'solo' });
    placePlayer(w, 0, 0, 0);
    addTestEnemyShot(w, -5, 0, 60, 0, 10);
    tick(w, 10);
    expect(w.players[0].hp).toBe(90);
    expect(w.enemyShots.count).toBe(0);
    w.players[0].invulnUntil = w.time + 1;
    const s = addTestEnemyShot(w, -5, 0, 60, 0, 10);
    tick(w, 5);
    expect(w.players[0].hp).toBe(90);
    expect(w.enemyShots.isAlive(s)).toBe(true);
  });

  it('contact damage uses the per-player cooldown and armor', () => {
    const w = createTestWorld({ mode: 'coop', vehicles: ['bulwark', 'lancer'] });
    placePlayer(w, 0, 0, 0);
    placePlayer(w, 1, 20, 0);
    addTestEnemy(w, 'shard', 0.5, 0);
    stepSystem(w, stepCollision, 1);
    expect(w.players[0].hp).toBeCloseTo(150 - ENEMY_DEFS.shard.contactDamage * 0.8, 10);
    stepSystem(w, stepCollision, 10);
    expect(w.players[0].hp).toBeCloseTo(150 - ENEMY_DEFS.shard.contactDamage * 0.8, 10);
    w.players[0].contactCd = 0;
    stepSystem(w, stepCollision, 1);
    expect(w.players[0].hp).toBeCloseTo(150 - 2 * ENEMY_DEFS.shard.contactDamage * 0.8, 10);
    expect(w.players[0].contactCd).toBe(COOP.CONTACT_COOLDOWN);
  });

  it('boss lasers (sweep and arc segments) damage players after warmup', () => {
    const w = createTestWorld({ mode: 'solo' });
    placePlayer(w, 0, 5, 0);
    const l = w.lasers.spawn()!;
    Object.assign(l, {
      shape: 0,
      x: 0,
      z: 0,
      angle: Math.PI / 2,
      angularVel: 0,
      length: 10,
      width: 1,
      radius: 0,
      arcHalf: 0,
      warmup: 0.5,
      life: 5,
      damage: 40,
    });
    stepSystem(w, stepCollision, 1);
    expect(w.players[0].hp).toBe(100);
    l.warmup = 0;
    stepSystem(w, stepCollision, 1);
    expect(w.players[0].hp).toBeCloseTo(100 - 40 * LASER_TICK, 10);
    Object.assign(l, { shape: 1, radius: 5, arcHalf: 0.2, angle: 0 });
    w.players[0].contactCd = 0;
    stepSystem(w, stepCollision, 1);
    expect(w.players[0].hp).toBeCloseTo(100 - 40 * LASER_TICK, 10);
    l.angle = Math.PI / 2;
    stepSystem(w, stepCollision, 1);
    expect(w.players[0].hp).toBeCloseTo(100 - 80 * LASER_TICK, 10);
  });
});

describe('collision: versus', () => {
  it('player shots hit the opponent at 45% in versus and pass through the partner in co-op', () => {
    const vs = createTestWorld({ mode: 'versus', vehicles: ['lancer', 'lancer'] });
    placePlayer(vs, 0, 0, 0);
    placePlayer(vs, 1, 5, 0);
    addTestPlayerShot(vs, 0, 1, 0, 60, 0, 10);
    tick(vs, 10);
    expect(vs.players[1].hp).toBeCloseTo(100 - 10 * VERSUS.PVP_DAMAGE_MUL, 10);
    addTestPlayerShot(vs, 0, 1, 0, 60, 0, 10, { kind: PROJECTILE_KINDS.missile });
    tick(vs, 10);
    expect(vs.players[1].hp).toBeCloseTo(100 - 10 * VERSUS.PVP_DAMAGE_MUL, 10);
    const co = createTestWorld({ mode: 'coop', vehicles: ['lancer', 'lancer'] });
    placePlayer(co, 0, 0, 0);
    placePlayer(co, 1, 5, 0);
    addTestPlayerShot(co, 0, 1, 0, 60, 0, 10);
    tick(co, 10);
    expect(co.players[1].hp).toBe(100);
  });

  it('a Firewall deletes the opponent bullets inside the dome', () => {
    const vs = createTestWorld({ mode: 'versus', vehicles: ['lancer', 'bulwark'] });
    placePlayer(vs, 1, 0, 0);
    const s = vs.players[1].special;
    Object.assign(s, { active: true, kind: 'firewall', x: 0, z: 0, radius: 4.5, timer: 3 });
    const own = addTestPlayerShot(vs, 1, 1, 1, 0, 0, 10);
    const theirs = addTestPlayerShot(vs, 0, 2, 0, 0, 0, 10);
    stepSystem(vs, stepCollision, 1);
    expect(vs.playerShots.isAlive(theirs)).toBe(false);
    expect(vs.playerShots.isAlive(own)).toBe(true);
  });
});

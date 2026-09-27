import { describe, expect, it } from 'vitest';
import { vehicleBaseStats } from '../../src/config/vehicles';
import { ARENA, DASH, MOVEMENT, SIM } from '../../src/config/tuning';
import { VERSUS } from '../../src/config/versus';
import { applyPlayerStats, resetPlayersForRound, stepPlayers } from '../../src/entities/players';
import { createIntents } from '../helpers/scriptedIntents';
import { addTestEnemy, createTestWorld, placePlayer, stepSystem } from '../helpers/worldFixture';

function moving(x: number, z: number) {
  const it = createIntents();
  it[0].moveX = x;
  it[0].moveZ = z;
  return it;
}

describe('players: movement', () => {
  it('accelerates at 80 u/s^2 to top speed and decelerates at 100 u/s^2', () => {
    const w = createTestWorld({ mode: 'solo' });
    const p = w.players[0];
    stepSystem(w, stepPlayers, 6, moving(1, 0));
    expect(p.vx).toBeCloseTo(MOVEMENT.ACCEL * 6 * SIM.DT, 6);
    stepSystem(w, stepPlayers, 60, moving(1, 0));
    expect(p.vx).toBeCloseTo(12, 6);
    stepSystem(w, stepPlayers, 6);
    expect(p.vx).toBeCloseTo(12 - MOVEMENT.DECEL * 6 * SIM.DT, 6);
    stepSystem(w, stepPlayers, 60);
    expect(p.vx).toBe(0);
    expect(p.prevX).toBeCloseTo(p.x, 10);
  });

  it('focus slows movement by 30% and locks facing', () => {
    const w = createTestWorld({ mode: 'solo' });
    const p = w.players[0];
    const it = moving(1, 0);
    it[0].focusHeld = true;
    const yaw0 = p.yaw;
    stepSystem(w, stepPlayers, 120, it);
    expect(p.vx).toBeCloseTo(12 * MOVEMENT.FOCUS_MOVE_MUL, 6);
    expect(p.yaw).toBe(yaw0);
  });

  it('facing turns toward the move direction at 720 deg/s', () => {
    const w = createTestWorld({ mode: 'solo' });
    const p = w.players[0]; // yaw PI (facing -Z)
    stepSystem(w, stepPlayers, 1, moving(0, 1));
    expect(Math.abs(Math.abs(p.yaw) - (Math.PI - 4 * Math.PI * SIM.DT))).toBeLessThan(1e-9);
    stepSystem(w, stepPlayers, 60, moving(0, 1));
    expect(p.yaw).toBeCloseTo(0, 9);
  });

  it('clamps to the arena', () => {
    const w = createTestWorld({ mode: 'solo' });
    const p = w.players[0];
    placePlayer(w, 0, ARENA.RADIUS - 1, 0);
    stepSystem(w, stepPlayers, 120, moving(1, 0));
    expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(ARENA.RADIUS - p.radius + 1e-9);
  });

  it('soft-pushes overlapping craft apart', () => {
    const w = createTestWorld();
    placePlayer(w, 0, 0, 0);
    placePlayer(w, 1, 0.5, 0);
    stepSystem(w, stepPlayers, 120);
    const d = Math.hypot(w.players[1].x - w.players[0].x, w.players[1].z - w.players[0].z);
    expect(d).toBeGreaterThan(1.5);
  });
});

describe('players: aim assist', () => {
  it('snaps to the nearest enemy inside the +-10 deg cone within 24 u', () => {
    const w = createTestWorld({ mode: 'solo' });
    const p = w.players[0]; // facing -Z
    addTestEnemy(w, 'shard', Math.tan((8 * Math.PI) / 180) * 10, -10);
    stepSystem(w, stepPlayers, 1);
    expect(p.aimX).toBeGreaterThan(0.1);
    const w2 = createTestWorld({ mode: 'solo' });
    addTestEnemy(w2, 'shard', Math.tan((15 * Math.PI) / 180) * 10, -10);
    addTestEnemy(w2, 'shard', 0, -30);
    stepSystem(w2, stepPlayers, 1);
    expect(w2.players[0].aimX).toBeCloseTo(0, 9);
    expect(w2.players[0].aimZ).toBeCloseTo(-1, 9);
  });

  it('targets the opponent in versus', () => {
    const w = createTestWorld({ mode: 'versus' });
    placePlayer(w, 0, 0, 0);
    placePlayer(w, 1, 1, -10);
    stepSystem(w, stepPlayers, 1);
    expect(w.players[0].aimX).toBeGreaterThan(0.05);
  });
});

describe('players: dash', () => {
  it('covers 7 u in 0.16 s with 0.2 s i-frames, spends a charge and recharges after the cooldown', () => {
    const w = createTestWorld({ mode: 'solo' });
    const p = w.players[0];
    const it = moving(1, 0);
    it[0].dashPressed = true;
    stepSystem(w, stepPlayers, 1, it);
    expect(p.dashCharges).toBe(0);
    expect(p.invulnUntil).toBeCloseTo(DASH.IFRAMES, 10);
    expect(w.events.player.get(0).what).toBe('dash');
    it[0].dashPressed = false;
    stepSystem(w, stepPlayers, 19, it);
    // 20 ticks: the full dash distance, then the rest of the last tick at top speed.
    expect(p.x).toBeCloseTo(DASH.DISTANCE + (20 * SIM.DT - DASH.DURATION) * 12, 6);
    it[0].dashPressed = true;
    stepSystem(w, stepPlayers, 10, it);
    expect(p.dashCharges).toBe(0);
    stepSystem(w, stepPlayers, Math.round(DASH.BASE_COOLDOWN * SIM.HZ));
    expect(p.dashCharges).toBe(1);
  });

  it('Specter has 2 charges; applyPlayerStats clamps charges', () => {
    const w = createTestWorld({ mode: 'solo', vehicles: ['specter', 'specter'] });
    const p = w.players[0];
    expect(p.dashCharges).toBe(2);
    applyPlayerStats(p, vehicleBaseStats('lancer'));
    expect(p.dashCharges).toBe(1);
  });

  it('Bulwark ram deals 40 damage once per dash', () => {
    const w = createTestWorld({ mode: 'solo', vehicles: ['bulwark', 'bulwark'] });
    const e = addTestEnemy(w, 'spiker', 2, 0, { hp: 500, maxHp: 500 });
    const it = moving(1, 0);
    it[0].dashPressed = true;
    stepSystem(w, stepPlayers, 20, it);
    expect(e.hp).toBe(500 - DASH.RAM_DAMAGE);
    const b = w.bosses[0]!;
    Object.assign(b, {
      alive: true,
      hp: 300,
      maxHp: 300,
      radius: 2,
      x: w.players[0].x + 3,
      z: 0,
      introTimer: 0,
    });
    const it2 = moving(1, 0);
    it2[0].dashPressed = true;
    stepSystem(w, stepPlayers, 200, moving(0, 0));
    stepSystem(w, stepPlayers, 20, it2);
    expect(b.hp).toBe(300 - DASH.RAM_DAMAGE);
  });
});

describe('players: stats and round reset', () => {
  it('max HP increases heal by the delta, decreases clamp hp to >= 1', () => {
    const w = createTestWorld({ mode: 'solo' });
    const p = w.players[0];
    p.hp = 50;
    const s = vehicleBaseStats('lancer');
    s.maxHp = 120;
    applyPlayerStats(p, s);
    expect(p.hp).toBe(70);
    const s2 = vehicleBaseStats('lancer');
    s2.maxHp = 40;
    applyPlayerStats(p, s2);
    expect(p.hp).toBe(40);
    p.hp = 0.2;
    applyPlayerStats(p, s2);
    expect(p.hp).toBe(1);
    expect(p.stats).not.toBe(s2);
  });

  it('resetPlayersForRound mirrors spawns and restores hp, charges and meters', () => {
    const w = createTestWorld({ mode: 'versus', vehicles: ['specter', 'lancer'] });
    const [a, b] = w.players;
    a.x = 5;
    a.hp = 3;
    a.life = 'downed';
    a.overdrive = 70;
    a.dashCharges = 0;
    a.special.active = true;
    b.combo = 12;
    resetPlayersForRound(w);
    expect(a.x).toBe(-VERSUS.SPAWN_OFFSET);
    expect(b.x).toBe(VERSUS.SPAWN_OFFSET);
    expect(a.life).toBe('alive');
    expect(a.hp).toBe(75);
    expect(a.overdrive).toBe(0);
    expect(a.dashCharges).toBe(2);
    expect(a.special.active).toBe(false);
    expect(b.combo).toBe(0);
  });
});

describe('players: down states', () => {
  it('downed players crawl at 25% speed; offline ghosts stay inside the view rect', () => {
    const w = createTestWorld();
    const p = w.players[0];
    placePlayer(w, 0, 0, 0);
    placePlayer(w, 1, 0, 20);
    p.life = 'downed';
    stepSystem(w, stepPlayers, 120, moving(1, 0));
    expect(p.x).toBeCloseTo(12 * 0.25, 6);
    p.life = 'offline';
    w.viewRect.minX = -5;
    w.viewRect.maxX = 5;
    w.viewRect.minZ = -5;
    w.viewRect.maxZ = 5;
    stepSystem(w, stepPlayers, 240, moving(1, 0));
    expect(p.x).toBeCloseTo(3.5, 6);
    p.life = 'respawning';
    stepSystem(w, stepPlayers, 10, moving(-1, 0));
    expect(p.x).toBeCloseTo(3.5, 6);
  });
});

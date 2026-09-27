import { describe, expect, it } from 'vitest';
import { PROJECTILE_KINDS } from '../../src/contracts/sim';
import { SPECIALS } from '../../src/config/specials';
import { OVERDRIVE, SIM } from '../../src/config/tuning';
import { VERSUS } from '../../src/config/versus';
import { CARD_BIT } from '../../src/entities/cardBits';
import { addOverdrive, firewallActive, stepSpecials } from '../../src/entities/specials';
import { stepCollision } from '../../src/sim/collision';
import { createIntents } from '../helpers/scriptedIntents';
import {
  addTestEnemy,
  addTestEnemyShot,
  createTestWorld,
  placePlayer,
  stepSystem,
} from '../helpers/worldFixture';

type Vehicle = 'lancer' | 'bulwark' | 'specter' | 'tinker';

function charged(vehicle: Vehicle, mode: 'solo' | 'coop' | 'versus' = 'solo') {
  const w = createTestWorld({ mode, vehicles: [vehicle, vehicle] });
  w.players[0].overdrive = OVERDRIVE.MAX;
  return w;
}

function press() {
  const it = createIntents();
  it[0].specialPressed = true;
  return it;
}

describe('overdrive', () => {
  it('adds meter scaled by specialChargeMul, clamped to 100', () => {
    const w = createTestWorld({ mode: 'solo' });
    w.players[0].stats.specialChargeMul = 1.5;
    addOverdrive(w, 0, 10);
    expect(w.players[0].overdrive).toBe(15);
    addOverdrive(w, 0, 500);
    expect(w.players[0].overdrive).toBe(OVERDRIVE.MAX);
    addOverdrive(w, 1, 10);
    expect(w.players[1].overdrive).toBe(0);
  });

  it('needs a full meter and spends all of it', () => {
    const w = createTestWorld({ mode: 'solo' });
    w.players[0].overdrive = 99;
    stepSystem(w, stepSpecials, 1, press());
    expect(w.players[0].special.active).toBe(false);
    w.players[0].overdrive = 100;
    stepSystem(w, stepSpecials, 1, press());
    expect(w.players[0].special.active).toBe(true);
    expect(w.players[0].overdrive).toBe(0);
    expect(w.events.special.count).toBe(1);
  });
});

describe('Railburst', () => {
  it('hits every enemy on the 40 u rail for 400 and ends after 0.25 s', () => {
    const w = charged('lancer');
    const p = w.players[0];
    p.aimX = 0;
    p.aimZ = -1;
    const a = addTestEnemy(w, 'spiker', 0, -10, { hp: 1000, maxHp: 1000 });
    const b = addTestEnemy(w, 'spiker', 0.5, -30, { hp: 1000, maxHp: 1000 });
    const miss = addTestEnemy(w, 'spiker', 5, -10, { hp: 1000, maxHp: 1000 });
    stepSystem(w, stepSpecials, 1, press());
    expect(a.hp).toBe(600);
    expect(b.hp).toBe(600);
    expect(miss.hp).toBe(1000);
    stepSystem(w, stepSpecials, Math.ceil(SPECIALS.railburst.duration * SIM.HZ));
    expect(p.special.active).toBe(false);
  });

  it('Special Tuning tier II adds 25% damage; SUDO fires a second rail', () => {
    const w = charged('lancer');
    const p = w.players[0];
    p.stats.specialTier = 1;
    p.cardStacks[CARD_BIT.sudo] = 1;
    p.aimX = 1;
    p.aimZ = 0;
    const e = addTestEnemy(w, 'spiker', 10, 0, { hp: 2000, maxHp: 2000 });
    stepSystem(w, stepSpecials, 1, press());
    expect(e.hp).toBe(1500);
    stepSystem(w, stepSpecials, 60);
    expect(e.hp).toBe(1000);
    expect(p.special.pendingCasts).toBe(0);
  });

  it('versus: the rail hits the opponent at 25%', () => {
    const w = charged('lancer', 'versus');
    placePlayer(w, 0, 0, 0);
    placePlayer(w, 1, 0, -10);
    w.players[0].aimX = 0;
    w.players[0].aimZ = -1;
    stepSystem(w, stepSpecials, 1, press());
    expect(w.players[1].hp).toBeCloseTo(100 - 400 * VERSUS.PVP_SPECIAL_DAMAGE_MUL, 10);
  });
});

describe('Firewall', () => {
  it('follows the caster for 3.5 s and deletes enemy bullets inside the dome', () => {
    const w = charged('bulwark');
    const p = w.players[0];
    stepSystem(w, stepSpecials, 1, press());
    expect(firewallActive(p)).toBe(true);
    expect(p.special.radius).toBe(SPECIALS.firewall.radius);
    addTestEnemyShot(w, 2, 0, 0, 0);
    addTestEnemyShot(w, 10, 0, 0, 0);
    stepSystem(w, stepCollision, 1);
    expect(w.enemyShots.count).toBe(1);
    stepSystem(w, stepSpecials, Math.ceil(SPECIALS.firewall.duration * SIM.HZ));
    expect(firewallActive(p)).toBe(false);
  });
});

describe('Blink Swarm', () => {
  it('teleports 8 u and leaves 6 seeker mines', () => {
    const w = charged('specter');
    const p = w.players[0];
    placePlayer(w, 0, 0, 0);
    const it = press();
    it[0].moveX = 1;
    stepSystem(w, stepSpecials, 1, it);
    expect(p.x).toBeCloseTo(SPECIALS.blinkSwarm.distance, 10);
    expect(w.playerShots.count).toBe(SPECIALS.blinkSwarm.mines);
    for (let i = 0; i < w.playerShots.count; i++) {
      const m = w.playerShots.active[i]!;
      expect(m.kind).toBe(PROJECTILE_KINDS.mine);
      expect(Math.hypot(m.x, m.z)).toBeLessThanOrEqual(SPECIALS.blinkSwarm.scatter + 1e-9);
      expect(m.damage).toBe(SPECIALS.blinkSwarm.mineDamage);
    }
    expect(p.invulnUntil).toBeGreaterThan(w.time);
  });
});

describe('Patch Drone', () => {
  it('heals owner and partner within range, runs a turret, and heals only the owner in versus', () => {
    const w = charged('tinker', 'coop');
    placePlayer(w, 0, 0, 0);
    placePlayer(w, 1, 1, 0);
    w.players[0].hp = 50;
    w.players[1].hp = 50;
    addTestEnemy(w, 'spiker', 8, 0, { hp: 1000, maxHp: 1000 });
    stepSystem(w, stepSpecials, 1, press());
    stepSystem(w, stepSpecials, SIM.HZ);
    expect(w.players[0].hp).toBeCloseTo(50 + SPECIALS.patchDrone.healPerS, 0);
    expect(w.players[1].hp).toBeGreaterThan(55);
    let turret = 0;
    for (let i = 0; i < w.playerShots.count; i++) {
      if (w.playerShots.active[i]!.kind === PROJECTILE_KINDS.turret) turret++;
    }
    expect(turret).toBeGreaterThanOrEqual(3);
    const vs = charged('tinker', 'versus');
    placePlayer(vs, 0, 0, 0);
    placePlayer(vs, 1, 1, 0);
    vs.players[0].hp = 50;
    vs.players[1].hp = 50;
    stepSystem(vs, stepSpecials, SIM.HZ, press());
    expect(vs.players[0].hp).toBeGreaterThan(55);
    expect(vs.players[1].hp).toBe(50);
  });

  it('cancels when the caster goes down', () => {
    const w = charged('tinker');
    stepSystem(w, stepSpecials, 1, press());
    w.players[0].life = 'downed';
    stepSystem(w, stepSpecials, 1);
    expect(w.players[0].special.active).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { ENEMY_DEFS } from '../../src/config/enemies';
import { COOP } from '../../src/config/tuning';
import { LINK_TICK_EVERY, stepLinkBeam } from '../../src/entities/linkBeam';
import { stepPlayers } from '../../src/entities/players';
import { createIntents } from '../helpers/scriptedIntents';
import { addTestEnemy, createTestWorld, placePlayer, stepSystem } from '../helpers/worldFixture';

describe('link beam', () => {
  it('activates only inside the 4..14 u band between two living players', () => {
    const w = createTestWorld();
    placePlayer(w, 0, 0, 0);
    placePlayer(w, 1, 3, 0);
    stepSystem(w, stepLinkBeam, 1);
    expect(w.link.active).toBe(false);
    placePlayer(w, 1, 10, 0);
    stepSystem(w, stepLinkBeam, 1);
    expect(w.link.active).toBe(true);
    expect(w.link.length).toBeCloseTo(10, 10);
    placePlayer(w, 1, 15, 0);
    stepSystem(w, stepLinkBeam, 1);
    expect(w.link.active).toBe(false);
    w.players[0].stats.linkRange = 18;
    stepSystem(w, stepLinkBeam, 1);
    expect(w.link.active).toBe(true);
    w.players[1].life = 'downed';
    stepSystem(w, stepLinkBeam, 1);
    expect(w.link.active).toBe(false);
  });

  it('deals linkDps to enemies it crosses as SOURCE_LINK damage', () => {
    const w = createTestWorld();
    placePlayer(w, 0, 0, 0);
    placePlayer(w, 1, 10, 0);
    const e = addTestEnemy(w, 'warden', 5, 0.2, { hp: 1000, maxHp: 1000, yaw: 0 });
    const far = addTestEnemy(w, 'spiker', 5, 5);
    stepSystem(w, stepLinkBeam, 120);
    expect(e.hp).toBeCloseTo(1000 - COOP.LINK_DPS, 6);
    expect(e.lastHitBy).toBe(2);
    expect(far.hp).toBe(ENEMY_DEFS.spiker.hp);
  });

  it('Leeches latch onto the beam and cut it; dashing sheds them', () => {
    const w = createTestWorld();
    placePlayer(w, 0, 0, 0);
    placePlayer(w, 1, 10, 0);
    const leech = addTestEnemy(w, 'leech', 5, 0.5);
    const victim = addTestEnemy(w, 'spiker', 7, 0, { hp: 500, maxHp: 500 });
    stepSystem(w, stepLinkBeam, LINK_TICK_EVERY * 5);
    expect(leech.latched).toBe(1);
    expect(w.link.cut).toBe(true);
    expect(w.link.latchedCount).toBe(1);
    expect(victim.hp).toBe(500);
    const it = createIntents();
    it[0].dashPressed = true;
    stepSystem(w, stepPlayers, 1, it);
    expect(leech.latched).toBe(0);
    expect(Math.abs(leech.z)).toBeGreaterThan(ENEMY_DEFS.leech.params.latchRange + 0.7);
    stepSystem(w, stepLinkBeam, LINK_TICK_EVERY);
    expect(w.link.cut).toBe(false);
    expect(victim.hp).toBeLessThan(500);
  });

  it('killing a latched Leech restores the beam', () => {
    const w = createTestWorld();
    placePlayer(w, 0, 0, 0);
    placePlayer(w, 1, 10, 0);
    const leech = addTestEnemy(w, 'leech', 5, 0.5);
    stepSystem(w, stepLinkBeam, 1);
    expect(w.link.cut).toBe(true);
    leech.dying = true;
    stepSystem(w, stepLinkBeam, 1);
    expect(w.link.cut).toBe(false);
  });

  it('solo: the Echo Drone orbits at 6 u and the beam deals 60% damage', () => {
    const w = createTestWorld({ mode: 'solo' });
    placePlayer(w, 0, 0, 0);
    const e = addTestEnemy(w, 'spiker', 0, 0, { hp: 1000, maxHp: 1000, radius: 7 });
    stepSystem(w, stepLinkBeam, 120);
    expect(w.link.droneActive).toBe(true);
    expect(Math.hypot(w.link.droneX, w.link.droneZ)).toBeCloseTo(COOP.ECHO_ORBIT, 6);
    expect(e.hp).toBeCloseTo(1000 - COOP.LINK_DPS * COOP.ECHO_DAMAGE_MUL, 6);
  });

  it('is disabled in versus', () => {
    const w = createTestWorld({ mode: 'versus' });
    placePlayer(w, 0, 0, 0);
    placePlayer(w, 1, 8, 0);
    stepSystem(w, stepLinkBeam, 10);
    expect(w.link.active).toBe(false);
    expect(w.link.droneActive).toBe(false);
  });
});

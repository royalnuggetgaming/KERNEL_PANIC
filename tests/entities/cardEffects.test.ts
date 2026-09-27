import { describe, expect, it } from 'vitest';
import { PROJECTILE_KINDS } from '../../src/contracts/sim';
import { CARD_PARAMS } from '../../src/config/cards';
import { SIM } from '../../src/config/tuning';
import { CARD_BIT } from '../../src/entities/cardBits';
import { arcChain, chainArcOnHit, stepCardEffects } from '../../src/entities/cardEffects';
import { stepPlayers } from '../../src/entities/players';
import { createIntents } from '../helpers/scriptedIntents';
import { addTestEnemy, createTestWorld, placePlayer, stepSystem } from '../helpers/worldFixture';

function solo() {
  const w = createTestWorld({ mode: 'solo' });
  placePlayer(w, 0, 0, 0);
  return w;
}

describe('card effects', () => {
  it('Overheat flag is on below 30% HP', () => {
    const w = solo();
    const p = w.players[0];
    p.cardStacks[CARD_BIT.overheat] = 1;
    stepSystem(w, stepCardEffects, 1);
    expect(p.cards.overheatActive).toBe(false);
    p.hp = 29;
    stepSystem(w, stepCardEffects, 1);
    expect(p.cards.overheatActive).toBe(true);
  });

  it('Nanoshield recharges every 12 s', () => {
    const w = solo();
    const p = w.players[0];
    p.cardStacks[CARD_BIT.nanoshield] = 1;
    stepSystem(w, stepCardEffects, 12 * SIM.HZ - 2);
    expect(p.cards.nanoshieldReady).toBe(false);
    stepSystem(w, stepCardEffects, 3);
    expect(p.cards.nanoshieldReady).toBe(true);
  });

  it('Orbitals deal about 18 DPS to enemies they touch', () => {
    const w = solo();
    w.players[0].cardStacks[CARD_BIT.orbitals] = 1;
    const e = addTestEnemy(w, 'spiker', 0, 0, { hp: 1000, maxHp: 1000, radius: 3 });
    stepSystem(w, stepCardEffects, SIM.HZ);
    // Both blades overlap the fat test enemy all the time.
    expect(1000 - e.hp).toBeCloseTo(2 * CARD_PARAMS.orbitals.dps, 6);
  });

  it('Micro-Missiles launch 2 per stack every 1.2 s when enemies exist', () => {
    const w = solo();
    w.players[0].cardStacks[CARD_BIT.microMissiles] = 2;
    stepSystem(w, stepCardEffects, 2 * SIM.HZ);
    expect(w.playerShots.count).toBe(0);
    addTestEnemy(w, 'shard', 10, 0);
    stepSystem(w, stepCardEffects, 1);
    expect(w.playerShots.count).toBe(4);
    expect(w.playerShots.active[0]!.kind).toBe(PROJECTILE_KINDS.missile);
    expect(w.playerShots.active[0]!.damage).toBe(CARD_PARAMS.microMissiles.damage);
  });

  it('Afterimage leaves a damaging trail during a dash', () => {
    const w = solo();
    const p = w.players[0];
    p.cardStacks[CARD_BIT.afterimage] = 1;
    const e = addTestEnemy(w, 'spiker', 1, 0, { hp: 1000, maxHp: 1000 });
    const it = createIntents();
    it[0].moveX = 1;
    it[0].dashPressed = true;
    for (let i = 0; i < 20; i++) {
      stepPlayers(w, it, SIM.DT);
      stepCardEffects(w, it, SIM.DT);
      w.tick++;
      w.time = w.tick * SIM.DT;
      it[0].dashPressed = false;
      it[0].moveX = 0;
    }
    expect(p.cards.trailCount).toBeGreaterThan(0);
    stepSystem(w, stepCardEffects, SIM.HZ);
    expect(e.hp).toBeLessThan(1000);
    stepSystem(w, stepCardEffects, SIM.HZ);
    expect(p.cards.trailCount).toBe(0);
  });

  it('Vampire Code heals 1 HP per 12 kills per stack', () => {
    const w = solo();
    const p = w.players[0];
    p.cardStacks[CARD_BIT.vampireCode] = 2;
    p.hp = 50;
    p.cards.vampireKills = 25;
    stepSystem(w, stepCardEffects, 1);
    expect(p.hp).toBe(54);
    expect(p.cards.vampireKills).toBe(1);
  });

  it('arcChain hops to the nearest unhit enemies in range', () => {
    const w = solo();
    const a = addTestEnemy(w, 'spiker', 0, 0);
    const b = addTestEnemy(w, 'spiker', 3, 0);
    const c = addTestEnemy(w, 'spiker', 6, 0);
    const far = addTestEnemy(w, 'spiker', 20, 0);
    expect(arcChain(w, 0, 0, 0, 10, 3, 7, a.slot)).toBe(2);
    expect(b.hp).toBe(50);
    expect(c.hp).toBe(50);
    expect(far.hp).toBe(60);
    expect(a.hp).toBe(60);
    expect(w.events.arc.count).toBe(2);
  });

  it('Chain Arc procs only when owned (15%)', () => {
    const w = solo();
    addTestEnemy(w, 'spiker', 2, 0);
    for (let i = 0; i < 50; i++) chainArcOnHit(w, 0, 0, 0, 10, -1);
    expect(w.events.arc.count).toBe(0);
    w.players[0].cardStacks[CARD_BIT.chainArc] = 1;
    for (let i = 0; i < 200; i++) chainArcOnHit(w, 0, 0, 0, 0.001, -1);
    expect(w.events.arc.count).toBeGreaterThan(10);
    expect(w.events.arc.count).toBeLessThan(60);
  });
});

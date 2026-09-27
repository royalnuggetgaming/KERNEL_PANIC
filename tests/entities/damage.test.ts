import { describe, expect, it } from 'vitest';
import { SOURCE_LINK, SOURCE_WORLD } from '../../src/contracts/simEvents';
import { ENEMY_DEFS } from '../../src/config/enemies';
import { COOP, OVERDRIVE } from '../../src/config/tuning';
import { VERSUS } from '../../src/config/versus';
import { CARD_BIT } from '../../src/entities/cardBits';
import {
  applyBossDamage,
  applyDamage,
  damagePlayer,
  markEnemy,
  wardenBlocks,
} from '../../src/entities/damage';
import { addTestEnemy, createTestWorld } from '../helpers/worldFixture';

function pickupTotal(w: ReturnType<typeof createTestWorld>): number {
  let t = 0;
  for (let i = 0; i < w.pickups.count; i++) t += w.pickups.active[i]!.value;
  return t;
}

describe('applyDamage', () => {
  it('Warden front arc blocks front shots but not flanks', () => {
    const w = createTestWorld();
    // yaw 0 faces +Z.
    const e = addTestEnemy(w, 'warden', 0, 0, { yaw: 0 });
    expect(wardenBlocks(e, 0, 5)).toBe(true);
    expect(applyDamage(w, e, 10, 0, 0, 5, false)).toBe(0);
    expect(e.hp).toBe(ENEMY_DEFS.warden.hp);
    expect(w.events.hit.get(0).target).toBe(2);
    // 60 deg off the facing: outside the 50 deg half arc.
    expect(applyDamage(w, e, 10, 0, 5 * Math.sin(Math.PI / 3), 5 * Math.cos(Math.PI / 3), false)).toBe(10);
    expect(applyDamage(w, e, 10, 0, 0, -5, false)).toBe(10);
    expect(e.hp).toBe(ENEMY_DEFS.warden.hp - 20);
  });

  it('Mark adds +20% while it lasts', () => {
    const w = createTestWorld();
    const e = addTestEnemy(w, 'spiker', 0, 0);
    markEnemy(w, e);
    expect(e.markedUntil).toBeCloseTo(COOP.MARK_DURATION, 10);
    applyDamage(w, e, 10, 0, 0, 0, false);
    expect(e.hp).toBeCloseTo(ENEMY_DEFS.spiker.hp - 12, 10);
    w.time = COOP.MARK_DURATION + 0.1;
    applyDamage(w, e, 10, 0, 0, 0, false);
    expect(e.hp).toBeCloseTo(ENEMY_DEFS.spiker.hp - 22, 10);
  });

  it('credits damage and overdrive, flashes, and emits a hit event', () => {
    const w = createTestWorld();
    const e = addTestEnemy(w, 'spiker', 1, 2);
    expect(applyDamage(w, e, 15, 1, 0, 0, true)).toBe(15);
    expect(e.flash).toBe(1);
    expect(e.lastHitBy).toBe(1);
    expect(w.players[1].damageDealt).toBe(15);
    expect(w.players[1].overdrive).toBeCloseTo(15 * OVERDRIVE.PER_DAMAGE, 10);
    const h = w.events.hit.get(0);
    expect(h.crit).toBe(true);
    expect(h.player).toBe(1);
    expect(h.target).toBe(0);
  });

  it('kills: dying flag, drops, kill event, death record and score; dying enemies take no damage', () => {
    const w = createTestWorld();
    const e = addTestEnemy(w, 'warden', 3, 4, { yaw: Math.PI, elite: true, hp: 5 });
    const dealt = applyDamage(w, e, 50, 0, 3, 10, false);
    expect(dealt).toBe(5);
    expect(e.dying).toBe(true);
    expect(pickupTotal(w)).toBe(ENEMY_DEFS.warden.drop * 3);
    expect(w.events.kill.count).toBe(1);
    const k = w.events.kill.get(0);
    expect(k.kind).toBe('warden');
    expect(k.elite).toBe(true);
    expect(k.combo).toBe(1);
    expect(w.deathQueue.count).toBe(1);
    expect(w.deathQueue.get(0).slot).toBe(e.slot);
    expect(w.players[0].kills).toBe(1);
    expect(w.players[0].score).toBeGreaterThan(0);
    expect(applyDamage(w, e, 50, 0, 3, 10, false)).toBe(0);
    expect(w.deathQueue.count).toBe(1);
  });

  it('link damage splits overdrive between both living players', () => {
    const w = createTestWorld();
    const e = addTestEnemy(w, 'spiker', 0, 0);
    applyDamage(w, e, 20, SOURCE_LINK, 0, 0, false);
    expect(w.players[0].overdrive).toBeCloseTo(20 * OVERDRIVE.PER_DAMAGE * 0.5, 10);
    expect(w.players[1].overdrive).toBeCloseTo(20 * OVERDRIVE.PER_DAMAGE * 0.5, 10);
  });
});

describe('applyBossDamage', () => {
  it('clamps hp at 0, flashes and ignores dead parts', () => {
    const w = createTestWorld();
    const b = w.bosses[0]!;
    Object.assign(b, { alive: true, hp: 30, maxHp: 100 });
    expect(applyBossDamage(w, b, 50, 0, false)).toBe(30);
    expect(b.hp).toBe(0);
    expect(b.flash).toBe(1);
    expect(b.lastHitBy).toBe(0);
    expect(w.events.hit.get(0).target).toBe(3);
    expect(applyBossDamage(w, b, 50, 0, false)).toBe(0);
    b.alive = false;
    b.hp = 10;
    expect(applyBossDamage(w, b, 5, 0, false)).toBe(0);
  });
});

describe('damagePlayer', () => {
  it('respects invulnerability and applies armor to contact only', () => {
    const w = createTestWorld();
    const bw = w.players[1]; // Bulwark, armor 0.2
    bw.invulnUntil = 1;
    expect(damagePlayer(w, bw, 10, SOURCE_WORLD, 0, 0, 'contact')).toBe(0);
    bw.invulnUntil = 0;
    expect(damagePlayer(w, bw, 10, SOURCE_WORLD, 0, 0, 'contact')).toBeCloseTo(8, 10);
    expect(damagePlayer(w, bw, 10, SOURCE_WORLD, 0, 0, 'projectile')).toBe(10);
    expect(bw.hp).toBeCloseTo(150 - 18, 10);
    expect(bw.damageTaken).toBeCloseTo(18, 10);
    expect(w.events.player.get(0).what).toBe('hurt');
  });

  it('halves the combo on hit', () => {
    const w = createTestWorld();
    const p = w.players[0];
    p.combo = 30;
    p.comboTier = 2;
    damagePlayer(w, p, 1, SOURCE_WORLD, 0, 0, 'projectile');
    expect(p.combo).toBe(15);
    expect(p.comboTier).toBe(1);
  });

  it('Nanoshield blocks one hit then recharges', () => {
    const w = createTestWorld();
    const p = w.players[0];
    p.cardStacks[CARD_BIT.nanoshield] = 1;
    p.cards.nanoshieldReady = true;
    expect(damagePlayer(w, p, 40, SOURCE_WORLD, 0, 0, 'projectile')).toBe(0);
    expect(p.cards.nanoshieldReady).toBe(false);
    expect(w.events.player.get(0).what).toBe('shieldBlock');
    expect(damagePlayer(w, p, 40, SOURCE_WORLD, 0, 0, 'projectile')).toBe(40);
  });

  it('co-op: no friendly fire; downing starts a bleed-out that shrinks per repeated down', () => {
    const w = createTestWorld();
    const p = w.players[0];
    expect(damagePlayer(w, p, 50, 1, 0, 0, 'pvp')).toBe(0);
    expect(damagePlayer(w, p, 500, SOURCE_WORLD, 0, 0, 'projectile')).toBe(100);
    expect(p.life).toBe('downed');
    expect(p.hp).toBe(0);
    expect(p.bleedLeft).toBe(COOP.BLEED_OUT);
    expect(w.events.player.get(1).what).toBe('downed');
    p.life = 'alive';
    p.hp = 1;
    damagePlayer(w, p, 5, SOURCE_WORLD, 0, 0, 'projectile');
    expect(p.bleedLeft).toBe(COOP.BLEED_OUT - COOP.BLEED_STEP);
    p.downsThisWave = 10;
    p.life = 'alive';
    p.hp = 1;
    damagePlayer(w, p, 5, SOURCE_WORLD, 0, 0, 'projectile');
    expect(p.bleedLeft).toBe(COOP.BLEED_MIN);
    expect(damagePlayer(w, p, 5, SOURCE_WORLD, 0, 0, 'projectile')).toBe(0);
  });

  it('versus: PvP multipliers, no self damage, elimination event', () => {
    const w = createTestWorld({ mode: 'versus', vehicles: ['lancer', 'lancer'] });
    const q = w.players[1];
    expect(damagePlayer(w, q, 20, 1, 0, 0, 'pvp')).toBe(0);
    expect(damagePlayer(w, q, 20, 0, 0, 0, 'pvp')).toBeCloseTo(20 * VERSUS.PVP_DAMAGE_MUL, 10);
    expect(damagePlayer(w, q, 20, 0, 0, 0, 'pvpSpecial')).toBeCloseTo(20 * VERSUS.PVP_SPECIAL_DAMAGE_MUL, 10);
    damagePlayer(w, q, 1000, SOURCE_WORLD, 0, 0, 'projectile');
    expect(q.life).toBe('downed');
    expect(q.bleedLeft).toBe(0);
    const last = w.events.player.get(w.events.player.count - 1);
    expect(last.what).toBe('eliminated');
  });
});

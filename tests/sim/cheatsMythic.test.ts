import { describe, expect, it } from 'vitest';
import { CARD_IDS, NO_HANDLE } from '../../src/contracts/ids';
import type { RunConfig } from '../../src/contracts/run';
import { PROJECTILE_KINDS, type ProjectileSpec } from '../../src/contracts/sim';
import { SOURCE_WORLD } from '../../src/contracts/simEvents';
import { CARD_PARAMS, cardDef } from '../../src/config/cards';
import { CHEATS, cheatByCode, cheatRunMods } from '../../src/config/cheats';
import { STAT_CAPS } from '../../src/config/tuning';
import { NullLogger } from '../../src/core/logger';
import { stepCardEffects } from '../../src/entities/cardEffects';
import { damagePlayer } from '../../src/entities/damage';
import { spawnProjectile } from '../../src/entities/projectiles';
import { createRunSession } from '../../src/sim/RunSession';
import { testRunConfig } from '../helpers/fakeRun';

function solo(patch: Partial<RunConfig>): RunConfig {
  return testRunConfig({ mode: 'solo', players: [{ player: 0, vehicle: 'lancer' }], ...patch });
}

const MYTHIC_BIT = CARD_IDS.indexOf('rootOfAllEvil');
const NO_INTENTS = [] as never;

describe('cheat definitions', () => {
  it('codes are unique, letters/digits only and matched case-insensitively', () => {
    const codes = CHEATS.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(CHEATS.length).toBeGreaterThanOrEqual(7);
    for (const c of codes) expect(c).toMatch(/^[A-Z0-9]{3,16}$/);
    expect(cheatByCode(' iddqd ')?.id).toBe('god');
    expect(cheatByCode('IdDqD')?.id).toBe('god');
    expect(cheatByCode('')).toBeNull();
    expect(cheatByCode('IDKFA')).toBeNull();
  });

  it('merges run mods, ignores duplicates and unknown ids', () => {
    const m = cheatRunMods(['turbo', 'glassCannon', 'turbo', 'nope' as never]);
    expect(m.any).toBe(true);
    expect(m.caps?.damageMulMax).toBe(20);
    expect(m.caps?.fireRateMax).toBe(40);
    expect(cheatRunMods([]).any).toBe(false);
    expect(cheatRunMods(['nope' as never]).any).toBe(false);
  });
});

describe('cheats in a run', () => {
  it('GLASSCANNON + BITRAIN + FULLCHARGE change the run-start numbers; versus ignores cheats', () => {
    const plain = createRunSession(solo({}), { log: NullLogger });
    const run = createRunSession(solo({ cheats: ['glassCannon', 'bitRain', 'fullCharge'] }), {
      log: NullLogger,
    });
    const p = run.world.players[0];
    expect(p.stats.maxHp).toBe(STAT_CAPS.maxHpMin);
    expect(p.hp).toBe(1);
    expect(p.stats.damageMul).toBeCloseTo(plain.world.players[0].stats.damageMul * 5, 6);
    expect(run.world.run.wallets[0]).toBe(plain.world.run.wallets[0] + 500);
    expect(p.overdrive).toBe(100);
    expect(run.loadout(0).cheats).toEqual(['glassCannon', 'bitRain', 'fullCharge']);
    const vs = createRunSession(testRunConfig({ mode: 'versus', cheats: ['bitRain'] }), { log: NullLogger });
    const vsPlain = createRunSession(testRunConfig({ mode: 'versus' }), { log: NullLogger });
    expect(vs.world.run.wallets[0]).toBe(vsPlain.world.run.wallets[0]);
    expect(vs.loadout(0).cheats).toEqual([]);
    for (const r of [plain, run, vs, vsPlain]) r.dispose();
  });

  it('IDDQD ignores world damage', () => {
    const run = createRunSession(solo({ cheats: ['god'] }), { log: NullLogger });
    const p = run.state.players[0];
    const hp = p.hp;
    expect(damagePlayer(run.state, p, 50, SOURCE_WORLD, 0, 0, 'contact')).toBe(0);
    expect(p.hp).toBe(hp);
    run.dispose();
  });

  it('SUDORMRF starts with the Mythic card owned in the world and the economy (stats included)', () => {
    const run = createRunSession(testRunConfig({ mode: 'coop', cheats: ['mythicStart'] }), {
      log: NullLogger,
    });
    for (const i of [0, 1] as const) {
      expect(run.world.players[i].cardStacks[MYTHIC_BIT]).toBe(1);
      expect(run.loadout(i).cards[MYTHIC_BIT]).toBe(1);
      expect(run.world.players[i].stats.pierce).toBe(STAT_CAPS.pierceMax);
    }
    run.dispose();
  });
});

describe('MYTHIC ROOT OF ALL EVIL', () => {
  it('is a unique Mythic card outside the Legendary Pool', () => {
    const d = cardDef('rootOfAllEvil');
    expect(d.rarity).toBe('M');
    expect(d.unique).toBe(true);
    expect(d.requiresMeta).toBeNull();
  });

  it('its purge field deletes enemy bullets near the craft and keeps far ones; everything stays finite', () => {
    const run = createRunSession(solo({ cheats: ['mythicStart'] }), { log: NullLogger });
    const w = run.state;
    const p = w.players[0];
    const r = CARD_PARAMS.rootOfAllEvil.purgeRadius;
    const spec: ProjectileSpec = {
      side: 'enemy',
      owner: SOURCE_WORLD,
      kind: PROJECTILE_KINDS.enemyOrb,
      x: p.x + r * 0.5,
      z: p.z,
      vx: 0,
      vz: 0,
      damage: 10,
      radius: 0.2,
      life: 5,
      pierce: 0,
      bounces: 0,
      crit: false,
      homing: NO_HANDLE,
    };
    spawnProjectile(w, spec);
    spawnProjectile(w, { ...spec, x: p.x + r * 3 });
    expect(w.enemyShots.count).toBe(2);
    w.tick = 0;
    stepCardEffects(w, NO_INTENTS, 1 / 120);
    expect(w.enemyShots.count).toBe(1);
    expect(Number.isFinite(p.x) && Number.isFinite(p.hp)).toBe(true);
    run.dispose();
  });
});

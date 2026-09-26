import { describe, expect, it } from 'vitest';
import { SOURCE_LINK, SOURCE_WORLD } from '../../src/contracts/simEvents';
import { COMBO, COOP, OVERDRIVE } from '../../src/config/tuning';
import { CARD_BIT } from '../../src/entities/cardBits';
import {
  comboScoreMul,
  comboShardBonus,
  comboTierFor,
  registerKill,
  registerPlayerHit,
  stepCombo,
} from '../../src/entities/combo';
import { createTestWorld, stepSystem } from '../helpers/worldFixture';

function waveEvents(w: ReturnType<typeof createTestWorld>, what: string): number {
  let n = 0;
  for (let i = 0; i < w.events.wave.count; i++) if (w.events.wave.get(i).what === what) n++;
  return n;
}

describe('combo', () => {
  it('extends the chain within the 2 s window and resets after it', () => {
    const w = createTestWorld();
    const p = w.players[0];
    registerKill(w, 0, 0, 0, 10);
    expect(p.combo).toBe(1);
    stepSystem(w, stepCombo, 120 * 1.9);
    registerKill(w, 0, 0, 0, 10);
    expect(p.combo).toBe(2);
    stepSystem(w, stepCombo, 120 * 2 + 1);
    expect(p.combo).toBe(0);
    expect(p.comboTier).toBe(0);
    registerKill(w, 0, 0, 0, 10);
    expect(p.combo).toBe(1);
    expect(p.bestCombo).toBe(2);
  });

  it('tiers at 10/25/50/100 with score and shard multipliers and tier events', () => {
    expect(comboTierFor(9)).toBe(0);
    expect(comboTierFor(10)).toBe(1);
    expect(comboTierFor(25)).toBe(2);
    expect(comboTierFor(50)).toBe(3);
    expect(comboTierFor(100)).toBe(4);
    expect(comboTierFor(1000)).toBe(4);
    const w = createTestWorld();
    const p = w.players[0];
    for (let i = 0; i < 25; i++) registerKill(w, 0, 0, 0, 10);
    expect(p.comboTier).toBe(2);
    expect(comboScoreMul(p)).toBe(COMBO.SCORE_MUL[2]);
    expect(comboShardBonus(p)).toBe(COMBO.SHARD_BONUS[2]);
    expect(waveEvents(w, 'comboTier')).toBe(2);
    expect(p.kills).toBe(25);
    expect(p.overdrive).toBeCloseTo(Math.min(100, 25 * OVERDRIVE.PER_KILL), 10);
  });

  it('ROOT ACCESS adds a tier permanently (clamped to the top tier)', () => {
    const w = createTestWorld();
    const p = w.players[0];
    p.cardStacks[CARD_BIT.rootAccess] = 1;
    expect(comboScoreMul(p)).toBe(COMBO.SCORE_MUL[1]);
    p.comboTier = 4;
    expect(comboScoreMul(p)).toBe(COMBO.SCORE_MUL[4]);
  });

  it('taking a hit halves the chain', () => {
    const w = createTestWorld();
    const p = w.players[0];
    for (let i = 0; i < 27; i++) registerKill(w, 0, 0, 0, 10);
    registerPlayerHit(w, 0);
    expect(p.combo).toBe(13);
    expect(p.comboTier).toBe(1);
    p.combo = 1;
    registerPlayerHit(w, 0);
    expect(p.combo).toBe(0);
    expect(p.comboTimer).toBe(0);
  });

  it('sync kill: both kill within 0.4 s -> +2 Shards and +3 Overdrive each, once per pair', () => {
    const w = createTestWorld();
    registerKill(w, 0, 0, 0, 10);
    w.time = 0.3;
    registerKill(w, 1, 0, 0, 10);
    expect(w.run.wallets).toEqual([COOP.SYNC_SHARDS, COOP.SYNC_SHARDS]);
    expect(w.players[0].overdrive).toBeCloseTo(OVERDRIVE.PER_KILL + COOP.SYNC_OVERDRIVE, 10);
    expect(waveEvents(w, 'sync')).toBe(1);
    // P1's next kill pairs with nothing new: P2's kill was already used.
    w.time = 0.35;
    registerKill(w, 0, 0, 0, 10);
    expect(waveEvents(w, 'sync')).toBe(1);
    // Too late for a new pair.
    w.time = 2;
    registerKill(w, 1, 0, 0, 10);
    expect(waveEvents(w, 'sync')).toBe(1);
  });

  it('sync kills never happen in solo or versus', () => {
    const vs = createTestWorld({ mode: 'versus' });
    registerKill(vs, 0, 0, 0, 10);
    registerKill(vs, 1, 0, 0, 10);
    expect(vs.run.wallets).toEqual([0, 0]);
    const solo = createTestWorld({ mode: 'solo' });
    registerKill(solo, 0, 0, 0, 10);
    expect(waveEvents(solo, 'sync')).toBe(0);
  });

  it('link kills extend both players combos; world kills credit nobody', () => {
    const w = createTestWorld();
    registerKill(w, SOURCE_LINK, 0, 0, 10);
    expect(w.players[0].combo).toBe(1);
    expect(w.players[1].combo).toBe(1);
    expect(w.players[0].score).toBe(5);
    registerKill(w, SOURCE_WORLD, 0, 0, 10);
    expect(w.players[0].combo).toBe(1);
    const vs = createTestWorld({ mode: 'versus' });
    registerKill(vs, SOURCE_LINK, 0, 0, 10);
    expect(vs.players[0].combo).toBe(0);
  });

  it('counts Vampire Code kills', () => {
    const w = createTestWorld();
    w.players[0].cardStacks[CARD_BIT.vampireCode] = 1;
    registerKill(w, 0, 0, 0, 10);
    expect(w.players[0].cards.vampireKills).toBe(1);
  });
});

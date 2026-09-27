/**
 * RunSession (plan section 11): meta snapshot and vehicle base through computeStats, applyShopResults heals by
 * the max-HP delta, flags drive transitions (wave clear -> shop -> next wave, final visit -> EXTRACT / PUSH
 * DEEPER into OVERFLOW, defeat), versus rounds to a match end with a winner, summary, events, dispose.
 */
import { describe, expect, it } from 'vitest';
import { CARD_IDS, type PlayerIndex } from '../../src/contracts/ids';
import type { ShopApi } from '../../src/contracts/run';
import { createMemoryLogger, NullLogger } from '../../src/core/logger';
import { cardDef } from '../../src/config/cards';
import { META_EFFECTS } from '../../src/config/metaCatalog';
import { COOP, SIM } from '../../src/config/tuning';
import { VERSUS } from '../../src/config/versus';
import { WAVES } from '../../src/config/waves';
import { clearBoss } from '../../src/sim/worldRecords';
import { createRunSession, type RunSession } from '../../src/sim/RunSession';
import { computeStats, emptyRowLevels, emptyTeamLevels } from '../../src/upgrades/stats';
import { createIntents } from '../helpers/scriptedIntents';
import { newSession, runConfigFor } from './runDriver';

const IDLE = createIntents();

function tickN(s: RunSession, n: number): void {
  for (let i = 0; i < n; i++) s.tick(IDLE);
}

/** Runs the countdown, then removes every enemy/boss and the remaining budget so the wave clears. */
function forceWaveClear(s: RunSession): void {
  const w = s.state;
  for (
    let i = 0;
    i < 2_000 && !(w.run.phase === 'combat' || (w.run.phase === 'boss' && w.director.bossSpawned));
    i++
  )
    s.tick(IDLE);
  w.enemies.clear();
  w.director.pending.clear();
  w.director.budgetLeft = 0;
  for (const b of w.bosses) clearBoss(b);
  for (let i = 0; i < 2_000 && !s.flags.waveClearReady && !s.flags.defeat; i++) s.tick(IDLE);
}

function readyAll(shop: ShopApi, players: readonly PlayerIndex[]): void {
  shop.update(400);
  for (const p of players) expect(shop.apply({ kind: 'toggleReady', player: p }).ok).toBe(true);
  shop.update(16);
  shop.update(2_000);
}

function finishVisit(s: RunSession, shop: ShopApi): void {
  shop.commit();
  s.applyShopResults();
  s.beginNextWave();
}

describe('RunSession: setup', () => {
  it('validates the config (mode vs players)', () => {
    expect(() =>
      createRunSession(runConfigFor('solo', 1, { players: runConfigFor('coop', 1).players }), {
        log: NullLogger,
      }),
    ).toThrow();
    expect(() =>
      createRunSession(runConfigFor('coop', 1, { players: [{ player: 0, vehicle: 'lancer' }] }), {
        log: NullLogger,
      }),
    ).toThrow();
    expect(() =>
      createRunSession(
        runConfigFor('coop', 1, {
          players: [
            { player: 0, vehicle: 'lancer' },
            { player: 0, vehicle: 'bulwark' },
          ],
        }),
        { log: NullLogger },
      ),
    ).toThrow();
  });

  it('applies the Firmware snapshot and vehicle base through computeStats', () => {
    const meta = { hullFw: 2, bootCache: 2, secondBoot: 1, preCharge: 1, overclockFw: 3 } as const;
    const s = newSession('coop', 7, { meta });
    const w = s.state;
    const expected = computeStats(
      'bulwark',
      meta,
      emptyRowLevels(),
      new Uint8Array(CARD_IDS.length),
      emptyTeamLevels(),
    );
    expect(w.players[1].stats).toEqual(expected);
    expect(w.players[1].hp).toBe(expected.maxHp);
    expect(w.run.wallets).toEqual([2 * META_EFFECTS.bootCacheShards, 2 * META_EFFECTS.bootCacheShards]);
    expect(w.run.spareKernels).toBe(COOP.START_KERNELS + 1);
    expect(w.players[0].overdrive).toBe(META_EFFECTS.preChargeOverdrive);
    expect(s.economy(0).wallet).toBe(50);
    expect(s.team().kernels).toBe(2);
  });

  it('solo leaves P2 absent; versus holds no Spare Kernels', () => {
    const solo = newSession('solo', 1);
    expect(solo.state.players[1].life).toBe('absent');
    expect(solo.world.mode).toBe('solo');
    const vs = newSession('versus', 1, { meta: { secondBoot: 1 } });
    expect(vs.state.run.spareKernels).toBe(0);
  });

  it('beginNextWave starts wave 1 countdown and ticks advance the clock', () => {
    const s = newSession('coop', 3);
    s.beginNextWave();
    expect(s.world.run.wave).toBe(1);
    expect(s.world.run.phase).toBe('countdown');
    let countdowns = 0;
    for (let i = 0; i < s.world.events.wave.count; i++)
      if (s.world.events.wave.get(i).what === 'countdown') countdowns++;
    expect(countdowns).toBe(1);
    tickN(s, 120);
    expect(s.world.tick).toBe(120);
    expect(s.world.time).toBeCloseTo(1, 9);
    expect(s.world.run.elapsed).toBeCloseTo(120 * SIM.DT, 9);
    s.clearEvents();
    expect(s.world.events.wave.count).toBe(0);
  });
});

describe('RunSession: shop results', () => {
  it('applyShopResults heals by the max-HP delta (Plating) and keeps damage taken', () => {
    const s = newSession('coop', 11, { meta: { bootCache: 4 } });
    const w = s.state;
    s.beginNextWave();
    forceWaveClear(s);
    expect(s.flags.waveClearReady).toBe(true);
    w.run.wallets[0] = 5_000;
    const p0 = w.players[0];
    const max0 = p0.stats.maxHp;
    p0.hp = max0 - 60;
    const shop = s.openShop();
    shop.update(400);
    expect(shop.apply({ kind: 'buyRow', player: 0, id: 'plating' }).ok).toBe(true);
    expect(shop.apply({ kind: 'buyRow', player: 0, id: 'plating' }).ok).toBe(true);
    expect(shop.apply({ kind: 'buyRow', player: 0, id: 'payload' }).ok).toBe(true);
    s.applyShopResults();
    expect(p0.stats.maxHp).toBe(max0 + 40);
    expect(p0.hp).toBe(max0 - 60 + 40);
    expect(p0.stats.damageMul).toBeGreaterThan(1);
    expect(s.economy(0).rows.plating).toBe(2);
    expect(w.run.wallets[0]).toBe(s.economy(0).wallet);
    expect(w.run.wallets[0]).toBeLessThan(5_000);
    // P2 bought nothing: stats unchanged, hp unchanged.
    expect(w.players[1].hp).toBe(w.players[1].stats.maxHp);
  });

  it('repair and undo flow through; card purchases reach the world (stacks and mask)', () => {
    const s = newSession('solo', 5);
    const w = s.state;
    s.beginNextWave();
    forceWaveClear(s);
    w.run.wallets[0] = 5_000;
    w.players[0].hp = 10;
    const shop = s.openShop();
    shop.update(400);
    expect(shop.apply({ kind: 'repair', player: 0 }).ok).toBe(true);
    expect(shop.apply({ kind: 'buyRow', player: 0, id: 'thrusters' }).ok).toBe(true);
    expect(shop.apply({ kind: 'undo', player: 0 }).ok).toBe(true);
    const snap = shop.snapshot();
    const slot = snap.players[0].cards.find(
      (c) => c.id !== null && c.id !== 'shardCache' && c.status === 'available',
    );
    expect(slot).toBeDefined();
    expect(shop.apply({ kind: 'buyCard', player: 0, slot: slot!.slot }).ok).toBe(true);
    expect(shop.apply({ kind: 'buyTeam', player: 1, id: 'linkAmp' })).toEqual({
      ok: false,
      reason: 'absent',
    });
    const repairedHp = shop.snapshot().players[0].hp;
    s.applyShopResults();
    const bit = cardDef(slot!.id!).bit;
    expect(w.players[0].cardStacks[bit]).toBe(1);
    expect(w.players[0].cardMask & (1 << bit)).not.toBe(0);
    expect(s.economy(0).rows.thrusters).toBe(0);
    expect(w.players[0].hp).toBe(Math.min(repairedHp, w.players[0].stats.maxHp));
    expect(w.players[0].hp).toBeGreaterThan(10);
    expect(w.players[1].life).toBe('absent');
  });

  it('team purchases update Spare Kernels and both players link stats; locks carry to the next visit', () => {
    const s = newSession('coop', 21);
    const w = s.state;
    s.beginNextWave();
    forceWaveClear(s);
    w.run.wallets[0] = 5_000;
    w.run.wallets[1] = 5_000;
    const dps = w.players[0].stats.linkDps;
    const shop = s.openShop();
    shop.update(400);
    expect(shop.apply({ kind: 'buyTeam', player: 0, id: 'spareKernel' }).ok).toBe(true);
    expect(shop.apply({ kind: 'buyTeam', player: 1, id: 'linkAmp' }).ok).toBe(true);
    expect(shop.apply({ kind: 'lock', player: 1, slot: 2 }).ok).toBe(true);
    const lockedId = shop.snapshot().players[1].cards[2]!.id;
    finishVisit(s, shop);
    expect(w.run.spareKernels).toBe(2);
    expect(w.players[0].stats.linkDps).toBeGreaterThan(dps);
    expect(w.players[1].stats.linkDps).toBe(w.players[0].stats.linkDps);
    expect(s.team().levels.linkAmp).toBe(1);
    forceWaveClear(s);
    const next = s.openShop();
    expect(next.snapshot().players[1].cards[0]).toMatchObject({ id: lockedId, locked: true });
    expect(s.visit).toBe(2);
  });

  it('warns and ignores misuse (apply without a shop, second openShop returns the same visit)', () => {
    const log = createMemoryLogger();
    const s = createRunSession(runConfigFor('coop', 2), { log });
    s.applyShopResults();
    const a = s.openShop();
    expect(s.openShop()).toBe(a);
    expect(log.entries.filter((e) => e.level === 'warn').length).toBeGreaterThanOrEqual(3);
  });
});

describe('RunSession: flags drive transitions', () => {
  it('wave clear -> shop -> next wave; the flag clears on beginNextWave', () => {
    const s = newSession('coop', 31);
    s.beginNextWave();
    forceWaveClear(s);
    expect(s.flags).toMatchObject({ waveClearReady: true, defeat: false, finalVisit: false });
    expect(s.world.run.wavesCleared).toBe(1);
    const shop = s.openShop();
    readyAll(shop, [0, 1]);
    expect(shop.countdownDone).toBe(true);
    finishVisit(s, shop);
    expect(s.flags.waveClearReady).toBe(false);
    expect(s.world.run.wave).toBe(2);
    expect(s.world.run.phase).toBe('countdown');
  });

  it('wave 15 clear sets finalVisit; PUSH DEEPER starts OVERFLOW wave 16', () => {
    const s = newSession('solo', 41);
    s.beginNextWave();
    s.state.run.wave = WAVES.TOTAL - 1;
    forceWaveClear(s);
    const shop0 = s.openShop();
    finishVisit(s, shop0);
    expect(s.world.run.wave).toBe(WAVES.TOTAL);
    forceWaveClear(s);
    expect(s.flags.finalVisit).toBe(true);
    expect(s.world.run.victoryAchieved).toBe(true);
    const shop = s.openShop();
    expect(shop.finalVisit).toBe(true);
    shop.update(400);
    expect(shop.apply({ kind: 'choose', player: 0, choice: 'pushDeeper' }).ok).toBe(true);
    readyAll(shop, [0]);
    expect(shop.countdownDone).toBe(true);
    finishVisit(s, shop);
    expect(s.finalChoice).toBe('pushDeeper');
    expect(s.world.run.wave).toBe(WAVES.TOTAL + 1);
    expect(s.world.run.overflow).toBe(true);
    expect(s.flags.finalVisit).toBe(false);
    expect(s.summary('victory').victoryAchieved).toBe(true);
  });

  it('EXTRACT ends the run: beginNextWave refuses to start wave 16', () => {
    const s = newSession('solo', 43);
    s.beginNextWave();
    s.state.run.wave = WAVES.TOTAL;
    s.state.run.phase = 'countdown';
    forceWaveClear(s);
    expect(s.flags.finalVisit).toBe(true);
    const shop = s.openShop();
    shop.update(400);
    shop.apply({ kind: 'choose', player: 0, choice: 'extract' });
    finishVisit(s, shop);
    expect(s.finalChoice).toBe('extract');
    expect(s.world.run.wave).toBe(WAVES.TOTAL);
    const sum = s.summary('victory');
    expect(sum).toMatchObject({ outcome: 'victory', victoryAchieved: true, wavesCleared: 1, winner: null });
  });

  it('a team wipe raises defeat after the grace; beginNextWave is then a no-op', () => {
    const s = newSession('coop', 51);
    const w = s.state;
    s.beginNextWave();
    tickN(s, 400);
    w.run.spareKernels = 0;
    w.players[0].life = 'offline';
    w.players[1].life = 'offline';
    for (let i = 0; i < 400 && !s.flags.defeat; i++) s.tick(IDLE);
    expect(s.flags.defeat).toBe(true);
    const wave = w.run.wave;
    s.beginNextWave();
    expect(w.run.wave).toBe(wave);
    expect(s.summary('defeat')).toMatchObject({ outcome: 'defeat', mode: 'coop', winner: null });
  });
});

describe('RunSession: versus', () => {
  function eliminate(s: RunSession, loser: PlayerIndex): void {
    const w = s.state;
    for (let i = 0; i < 1_000 && w.run.phase !== 'combat'; i++) s.tick(IDLE);
    w.players[loser].life = 'downed';
    w.players[loser].hp = 0;
    for (let i = 0; i < 1_000 && !s.flags.roundOver && !s.flags.matchOver; i++) s.tick(IDLE);
  }

  it('plays rounds with shops in between until the match ends with a winner', () => {
    const s = newSession('versus', 61);
    s.beginNextWave();
    expect(s.world.run.round).toBe(1);
    let rounds = 0;
    while (!s.flags.matchOver && rounds < 10) {
      eliminate(s, 1);
      rounds++;
      if (s.flags.roundOver) {
        const shop = s.openShop();
        const snap = shop.snapshot();
        expect(snap.teamVisible).toBe(false);
        expect(snap.round).toBe(rounds);
        shop.update(400);
        expect(shop.apply({ kind: 'buyTeam', player: 0, id: 'linkAmp' })).toEqual({
          ok: false,
          reason: 'unavailable',
        });
        readyAll(shop, [0, 1]);
        finishVisit(s, shop);
        expect(s.flags.roundOver).toBe(false);
        expect(s.world.run.round).toBe(rounds + 1);
        expect(s.state.players[1].life).toBe('alive');
      }
    }
    expect(rounds).toBe(VERSUS.ROUNDS_TO_WIN);
    expect(s.flags.matchOver).toBe(true);
    s.beginNextWave();
    expect(s.world.run.round).toBe(VERSUS.ROUNDS_TO_WIN);
    const sum = s.summary('victory');
    expect(sum).toMatchObject({ mode: 'versus', winner: 0, roundsPlayed: 3, roundWins: [3, 0], mvp: 0 });
    expect(sum.players.map((p) => p.roundWins)).toEqual([3, 0]);
    expect(s.summary('abandoned').winner).toBeNull();
    // Round shards: the loser gets the catch-up payout.
    expect(s.state.run.shardsEarned[1]).toBeGreaterThanOrEqual(2 * VERSUS.ROUND_LOSS_SHARDS);
  });

  it('counts only decided rounds when abandoned mid-round', () => {
    const s = newSession('versus', 62);
    s.beginNextWave();
    eliminate(s, 0);
    const shop = s.openShop();
    finishVisit(s, shop);
    tickN(s, 10);
    expect(s.summary('abandoned')).toMatchObject({ roundsPlayed: 1, roundWins: [0, 1], winner: null });
  });
});

describe('RunSession: view rect, summary and dispose', () => {
  it('setViewRect writes a normalised rect and ignores non-finite input', () => {
    const s = newSession('coop', 1);
    s.setViewRect(10, -10, 5, -6);
    expect(s.world.viewRect).toEqual({ minX: -10, maxX: 10, minZ: -6, maxZ: 5 });
    s.setViewRect(Number.NaN, 1, 2, 3);
    expect(s.world.viewRect.minX).toBe(-10);
  });

  it('summary reports per-player stats and the MVP', () => {
    const s = newSession('coop', 71);
    s.state.players[1].score = 500;
    s.state.players[0].score = 100;
    s.state.run.shardsEarned[0] = 40;
    s.state.run.shardsEarned[1] = 60;
    const sum = s.summary('abandoned');
    expect(sum).toMatchObject({ runId: 'run-coop-71', totalScore: 600, shardsEarnedTotal: 100, mvp: 1 });
    expect(sum.players.map((p) => p.vehicle)).toEqual(['lancer', 'bulwark']);
    expect(newSession('solo', 1).summary('defeat').mvp).toBeNull();
  });

  it('dispose returns every pooled entity and forbids further ticks', () => {
    const s = newSession('coop', 81);
    s.beginNextWave();
    tickN(s, 1_500);
    const w = s.state;
    expect(w.enemies.count + w.director.pending.count).toBeGreaterThan(0);
    s.dispose();
    expect(s.disposed).toBe(true);
    expect(w.enemies.count).toBe(0);
    expect(w.playerShots.count).toBe(0);
    expect(w.enemyShots.count).toBe(0);
    expect(w.pickups.count).toBe(0);
    expect(w.lasers.count).toBe(0);
    expect(w.director.pending.count).toBe(0);
    expect(w.bosses.some((b) => b.alive)).toBe(false);
    expect(w.events.shot.count).toBe(0);
    expect(() => {
      s.tick(IDLE);
    }).toThrow();
    s.dispose();
  });
});

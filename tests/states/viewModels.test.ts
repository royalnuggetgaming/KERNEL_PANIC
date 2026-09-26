import { describe, expect, it } from 'vitest';
import type { RunSummary } from '../../src/contracts/run';
import { HudVmWriter, clockText } from '../../src/states/hudViewModel';
import { cardSlotOfItem, shopLayoutOf, statRowOfItem, teamOfItem } from '../../src/states/shopViewModel';
import { failureText } from '../../src/states/midrunShop';
import {
  buildCharacterSelectVM,
  buildGameOverVM,
  buildHangarVM,
  buildHudVM,
  buildShopVM,
  vehicleStatBars,
} from '../../src/states/viewModels';
import { computeRunRewards } from '../../src/upgrades/rewards';
import { KERNEL_PANIC } from '../../src/themes/kernelPanic';
import { FakeShop } from '../helpers/fakeRun';
import { createTestSaveData } from '../helpers/fakeSave';
import { createTestWorld } from '../helpers/worldFixture';

function summary(patch: Partial<RunSummary> = {}): RunSummary {
  return {
    runId: 'r',
    mode: 'coop',
    outcome: 'defeat',
    winner: null,
    waveReached: 7,
    wavesCleared: 6,
    bossesKilled: 1,
    victoryAchieved: false,
    shardsEarnedTotal: 300,
    roundsPlayed: 0,
    roundWins: [0, 0],
    durationS: 125,
    totalScore: 900,
    players: [
      {
        player: 0,
        vehicle: 'lancer',
        score: 400,
        kills: 10,
        damage: 1234.6,
        shards: 150,
        revives: 1,
        bestCombo: 12,
        roundWins: 0,
      },
      {
        player: 1,
        vehicle: 'tinker',
        score: 500,
        kills: 12,
        damage: 999,
        shards: 150,
        revives: 2,
        bestCombo: 30,
        roundWins: 0,
      },
    ],
    mvp: 1,
    ...patch,
  };
}

describe('HUD view model', () => {
  it('maps players, labels, timer and banners', () => {
    const w = createTestWorld({ mode: 'coop' });
    w.run.wave = 7;
    w.run.sector = 2;
    w.run.phase = 'countdown';
    w.run.phaseTimer = 2.4;
    w.run.waveDuration = 58;
    w.run.spareKernels = 2;
    w.players[0].hp = 50;
    w.players[1].life = 'downed';
    w.players[1].bleedLeft = 6;
    w.players[1].downsThisWave = 1;
    w.players[1].reviveProgress = 0.25;
    w.players[0].dashCharges = 0;
    w.players[0].dashCooldownLeft = 0.7;
    const writer = new HudVmWriter(KERNEL_PANIC);
    const vm = writer.write(w, '120 FPS');
    expect(vm.waveLabel).toBe('SECTOR 2 / CYCLE 7');
    expect(vm.timer).toBe('0:58');
    expect(vm.banner).toEqual({ visible: true, text: 'CYCLE 7', sub: '3' });
    expect(vm.players[0].hpFrac).toBe(0.5);
    expect(vm.players[0].dashFrac).toBeCloseTo(0.5);
    expect(vm.players[1].bleedFrac).toBe(0.5);
    expect(vm.players[1].reviveFrac).toBe(0.25);
    expect(vm.kernels).toBe(2);
    expect(vm.livesLabel).toBe('SPARE KERNELS');
    expect(vm.fps).toBe('120 FPS');
    // Alternating buffers: a new identity every frame, no allocation of new VMs.
    const vm2 = writer.write(w, null);
    const vm3 = writer.write(w, null);
    expect(vm2).not.toBe(vm);
    expect(vm3).toBe(vm);
    w.run.phase = 'combat';
    w.run.waveTimer = 61.2;
    expect(writer.write(w, null).timer).toBe('1:02');
    expect(writer.write(w, null).banner.visible).toBe(false);
    for (const [phase, text] of [
      ['purge', 'PURGE'],
      ['clearOutro', 'CYCLE 7 CLEARED'],
    ] as const) {
      w.run.phase = phase;
      expect(writer.write(w, null).banner.text).toBe(text);
    }
    w.run.phase = 'combat';
    w.run.overflow = true;
    w.run.wave = 17;
    expect(writer.write(w, null).waveLabel).toBe('OVERFLOW / CYCLE 17');
    w.run.wipeGrace = 0.5;
    expect(writer.write(w, null).banner.text).toBe('SYSTEM FAILURE');
    w.run.wipeGrace = -1;
    const boss = w.bosses[0]!;
    boss.alive = true;
    boss.id = 'kernel';
    boss.introTimer = 1;
    boss.hp = 100;
    boss.maxHp = 400;
    const bvm = writer.write(w, null);
    expect(bvm.banner.text).toBe('THE KERNEL');
    expect(bvm.boss).toEqual({ visible: true, name: 'THE KERNEL', hpFrac: 0.25 });
  });

  it('versus: round label, eliminated players, round-end and sudden death banners', () => {
    const w = createTestWorld({ mode: 'versus' });
    w.run.round = 3;
    w.run.roundWins[0] = 2;
    w.run.roundWins[1] = 1;
    w.run.phase = 'roundOutro';
    w.run.roundWinner = 1;
    w.players[0].life = 'downed';
    const vm = buildHudVM(w, KERNEL_PANIC, null);
    expect(vm.waveLabel).toBe('ROUND 3');
    expect(vm.players[0].life).toBe('eliminated');
    expect(vm.players[0].bleedFrac).toBe(0);
    expect(vm.banner.text).toBe('P2 TAKES THE ROUND');
    expect(vm.banner.sub).toBe('2 : 1');
    expect(vm.versus).toEqual({ visible: true, round: 3, roundWins: [2, 1], suddenDeath: false });
    w.run.phase = 'combat';
    w.run.suddenDeath = true;
    expect(buildHudVM(w, KERNEL_PANIC, null).banner.text).toBe('SUDDEN DEATH');
    w.run.suddenDeath = false;
    w.run.phase = 'roundOutro';
    w.run.roundWinner = -1;
    expect(buildHudVM(w, KERNEL_PANIC, null).banner.text).toBe('ROUND DRAWN');
  });

  it('a sync-kill event shows a transient banner', () => {
    const w = createTestWorld();
    w.run.phase = 'combat';
    const writer = new HudVmWriter(KERNEL_PANIC);
    const ev = w.events.wave.push();
    ev.what = 'sync';
    ev.wave = 1;
    ev.value = 0;
    ev.player = 0;
    writer.noteEvents(w.events, 1 / 60);
    expect(writer.write(w, null).banner.text).toBe('SYNC KILL');
    w.events.wave.clear();
    for (let i = 0; i < 60; i++) writer.noteEvents(w.events, 1 / 60);
    expect(writer.write(w, null).banner.visible).toBe(false);
  });

  it('clockText formats m:ss and clamps', () => {
    expect(clockText(0)).toBe('0:00');
    expect(clockText(-3)).toBe('0:00');
    expect(clockText(Number.NaN)).toBe('0:00');
    expect(clockText(599.2)).toBe('10:00');
  });
});

describe('Shop view model', () => {
  it('builds both panels with ids, layout and final choice', () => {
    const w = createTestWorld({ mode: 'coop' });
    w.run.wave = 15;
    const shop = new FakeShop(w);
    shop.finalVisit = true;
    const snap = shop.snapshot();
    const vm = buildShopVM(
      snap,
      [
        { row: 18, col: 0 },
        { row: 9, col: 1 },
      ],
      KERNEL_PANIC,
      ['hi', null],
    );
    expect(vm.title).toBe('PATCH BAY');
    expect(vm.finalChoice.visible).toBe(true);
    expect(vm.panels[0].rows[0]?.id).toBe('row:thrusters');
    expect(vm.panels[0].cards.map((c) => c.id)).toEqual(['card:0', 'card:1', 'card:2']);
    expect(vm.panels[0].team[0]?.id).toBe('team:spareKernel');
    expect(vm.panels[0].gift?.label).toBe('GIFT 10 BITS');
    expect(vm.panels[0].toast).toBe('hi');
    expect(vm.panels[1].cursor).toEqual({ row: 9, col: 1 });
    const l = shopLayoutOf(snap.players[0], true, true);
    expect(l).toMatchObject({ repair: 8, cardsStart: 9, teamStart: 12, reroll: 16, gift: 17, ready: 18 });
    expect(shopLayoutOf(snap.players[0], false, false)).toMatchObject({ reroll: 12, gift: -1, ready: 13 });
    expect(statRowOfItem('row:magnet', snap.players[0])).toBe('magnet');
    expect(statRowOfItem('row:nope', snap.players[0])).toBeNull();
    expect(teamOfItem('team:linkRange', snap.players[0])).toBe('linkRange');
    expect(teamOfItem('card:0', snap.players[0])).toBeNull();
    expect(cardSlotOfItem('lock:card:1')).toBe(1);
    expect(cardSlotOfItem('card:9')).toBeNull();
  });

  it('shows bought cards as sold and free rerolls; versus subtitle', () => {
    const w = createTestWorld({ mode: 'versus' });
    w.run.round = 2;
    const snap = new FakeShop(w).snapshot();
    const p0 = snap.players[0];
    const patched = {
      ...snap,
      players: [
        {
          ...p0,
          cards: [{ ...p0.cards[0]!, id: null }, p0.cards[1]!, p0.cards[2]!],
          reroll: { price: 5, freeLeft: 1 },
        },
        snap.players[1],
      ] as const,
    };
    const vm = buildShopVM(
      patched,
      [
        { row: 0, col: 0 },
        { row: 0, col: 0 },
      ],
      KERNEL_PANIC,
    );
    expect(vm.panels[0].cards[0]?.label).toBe('SOLD');
    expect(vm.panels[0].cards[0]?.status).toBe('soldOut');
    expect(vm.panels[0].reroll.label).toBe('REROLL (1 FREE)');
    expect(vm.panels[0].reroll.price).toBe(0);
    expect(vm.subtitle).toContain('ROUND 2');
    expect(vm.teamVisible).toBe(false);
  });

  it('failure texts cover every reason', () => {
    const tx = { kind: 'buyRow', player: 0, id: 'thrusters' } as const;
    const reasons = [
      'funds',
      'maxLevel',
      'capped',
      'soldOut',
      'unavailable',
      'absent',
      'fullHp',
      'visitLimit',
      'heldCap',
      'alreadyOwned',
      'nothingToUndo',
      'teamDependency',
      'guard',
      'invalid',
    ] as const;
    for (const r of reasons) failureText(r, tx, 'Bits');
    expect(failureText('invalid', { kind: 'reroll', player: 0 }, 'Bits')).toBe('Not possible');
    expect(failureText('guard', tx, 'Bits')).toBeNull();
  });
});

describe('Hangar, CharacterSelect and GameOver view models', () => {
  it('hangar statuses follow Cores, levels and unlocks', () => {
    const save = createTestSaveData({
      cores: 30,
      meta: { hullFw: 5, magnetFw: 1 },
      firmwareSpent: { hullFw: 300, magnetFw: 15 },
      unlocks: ['lancer', 'bulwark', 'specter'],
    });
    const vm = buildHangarVM(save, 99, KERNEL_PANIC, 'msg');
    const by = (id: string) => vm.items.find((i) => i.id === id);
    expect(by('meta:hullFw')?.status).toBe('maxed');
    expect(by('meta:magnetFw')?.status).toBe('available');
    expect(by('meta:rerollCache')?.status).toBe('unaffordable');
    expect(by('unlock:specter')?.status).toBe('owned');
    expect(by('unlock:tinker')?.price).toBe(90);
    expect(by('respec')?.status).toBe('available');
    expect(vm.respecRefund).toBe(315);
    expect(vm.cursor).toBe(vm.items.length - 1);
    const empty = buildHangarVM(createTestSaveData(), 0, KERNEL_PANIC, '');
    expect(empty.items.find((i) => i.id === 'respec')?.status).toBe('unavailable');
  });

  it('character select VM: stat bars, join hint, mode label', () => {
    const vm = buildCharacterSelectVM(
      {
        joined: [true, false],
        picks: ['tinker', 'lancer'],
        ready: [false, false],
        cursorRows: ['mode', 'vehicle'],
        mode: 'versus',
        countdown: null,
        message: '',
      },
      createTestSaveData({ cores: 12 }),
      KERNEL_PANIC,
    );
    expect(vm.mode).toBe('solo');
    expect(vm.modeLabel).toBe('SOLO');
    expect(vm.modeRowVisible).toBe(false);
    expect(vm.slots[0].cursorRow).toBe('vehicle');
    expect(vm.slots[0].specialName).toBe('PATCH DRONE');
    expect(vm.slots[1].joinHint).toBe('PRESS . TO JOIN');
    expect(vm.cores).toBe(12);
    const bars = vehicleStatBars('bulwark');
    expect(bars[0]?.fraction).toBe(1);
    for (const b of bars) expect(b.fraction).toBeLessThanOrEqual(1);
  });

  it('game over VM: MVP, rounded damage, duration, titles per outcome', () => {
    const s = summary();
    const vm = buildGameOverVM(s, computeRunRewards(s), KERNEL_PANIC, 5, true);
    expect(vm.title).toBe('SYSTEM FAILURE');
    expect(vm.subtitle).toBe('Purged at CYCLE 7');
    expect(vm.players[1]?.mvp).toBe(true);
    expect(vm.players[0]?.damage).toBe(1235);
    expect(vm.duration).toBe('2:05');
    expect(vm.cursor).toBe(1);
    expect(vm.cores.map((l) => l.label)).toEqual(['Bits earned', 'Cycles cleared', 'Bosses purged']);
    const win = summary({ outcome: 'victory', victoryAchieved: true, waveReached: 18 });
    expect(buildGameOverVM(win, computeRunRewards(win), KERNEL_PANIC, 0, false).subtitle).toContain(
      'OVERFLOW',
    );
    const ab = summary({ outcome: 'abandoned' });
    expect(buildGameOverVM(ab, computeRunRewards(ab), KERNEL_PANIC, 0, false).title).toBe(
      'PROCESS ABANDONED',
    );
    const vs = summary({ mode: 'versus', outcome: 'victory', winner: 0, roundWins: [3, 2] });
    const vvm = buildGameOverVM(vs, computeRunRewards(vs), KERNEL_PANIC, 0, false);
    expect(vvm.winner).toBe(0);
    expect(vvm.players[0]?.mvp).toBe(false);
    expect(vvm.cores.map((l) => l.label)).toEqual(['Rounds won', 'Match decided']);
    const vsa = summary({ mode: 'versus', outcome: 'abandoned', winner: 0 });
    const avm = buildGameOverVM(vsa, computeRunRewards(vsa), KERNEL_PANIC, 0, false);
    expect(avm.winner).toBeNull();
    expect(avm.title).toBe('MATCH ABANDONED');
  });
});

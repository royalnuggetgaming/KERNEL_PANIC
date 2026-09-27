import { describe, expect, it } from 'vitest';
import type { ShopApi } from '../../src/contracts/run';
import { createRng } from '../../src/core/rng';
import { createUpgradesShopState } from '../../src/states/UpgradesShopState';
import { createShopModel } from '../../src/upgrades/ShopModel';
import { emptyRowLevels, emptyTeamLevels } from '../../src/upgrades/stats';
import { FakeRunSession, testRunConfig } from '../helpers/fakeRun';
import { createFakeServices } from '../helpers/fakeServices';

class RealShopRun extends FakeRunSession {
  model: ShopApi | null = null;

  override openShop(): ShopApi {
    const player = () => ({
      wallet: 400,
      hp: 50,
      maxHp: 100,
      rows: emptyRowLevels(),
      cards: new Uint8Array(18),
      repairsThisVisit: 0,
    });
    this.model = createShopModel({
      mode: this.config.mode,
      wave: 3,
      visit: 3,
      round: 0,
      finalVisit: false,
      joined: [true, this.config.mode !== 'solo'],
      vehicles: ['lancer', 'bulwark'],
      players: [player(), player()],
      team: {
        kernels: 1,
        kernelsBoughtThisRun: 0,
        levels: emptyTeamLevels(),
        boughtThisVisit: { spareKernel: 0, linkAmp: 0, linkRange: 0, reviveProtocol: 0 },
      },
      meta: {},
      locked: [null, null],
      rng: createRng(7),
    });
    return this.model;
  }
}

function rig() {
  const set = createFakeServices();
  set.fsm.stack = ['Playing', 'UpgradesShop'];
  const run = new RealShopRun(testRunConfig());
  set.services.session.current = run;
  const state = createUpgradesShopState(set.services);
  state.enter({ mode: 'midrun' }, 'Playing');
  const frame = (): void => {
    state.update(1 / 60);
  };
  return { set, run, state, frame };
}

describe('UpgradesShop{midrun} over the real ShopModel', () => {
  it('ignores presses during the open guard, then P1 wins the contested team item', () => {
    const { set, frame } = rig();
    // Rows 12.. are the team row: go up from 0 past ready/gift/reroll to Spare Kernel (row 12).
    for (let i = 0; i < 7; i++) set.input.queueMenu({ player: 0, kind: 'up' }, { player: 1, kind: 'up' });
    set.input.queueMenu({ player: 0, kind: 'confirm' });
    frame();
    const guarded = set.ui.vm('shop');
    expect(guarded?.panels[0].cursor.row).toBe(12);
    expect(guarded?.panels[0].wallet).toBe(400);
    expect(guarded?.panels[0].toast).toBeNull();
    for (let i = 0; i < 25; i++) frame();
    set.input.queueMenu({ player: 1, kind: 'confirm' }, { player: 0, kind: 'confirm' });
    frame();
    const vm = set.ui.vm('shop');
    expect(vm?.panels[0].wallet).toBe(250);
    expect(vm?.panels[1].wallet).toBe(400);
    expect(vm?.panels[1].toast).toBe('Partner bought it');
    expect(vm?.kernels).toBe(2);
    expect(vm?.panels[0].canUndo).toBe(true);
    // Undo refunds the exact price.
    set.input.queueMenu({ player: 0, kind: 'back' });
    frame();
    expect(set.ui.vm('shop')?.panels[0].wallet).toBe(400);
  });

  it('both Ready -> 1.5 s countdown -> pop; un-ready cancels; exit commits', () => {
    const { set, frame, state, run } = rig();
    for (let i = 0; i < 25; i++) frame();
    set.input.queueMenu({ player: 0, kind: 'ready' }, { player: 1, kind: 'ready' });
    frame();
    expect(set.ui.vm('shop')?.countdown).not.toBeNull();
    set.input.queueMenu({ player: 1, kind: 'ready' });
    frame();
    expect(set.ui.vm('shop')?.countdown).toBeNull();
    // Buying while ready is refused with a hint.
    set.input.queueMenu({ player: 0, kind: 'confirm' });
    frame();
    expect(set.ui.vm('shop')?.panels[0].toast).toBe('Un-ready first');
    set.input.queueMenu({ player: 1, kind: 'ready' });
    for (let i = 0; i < 100; i++) frame();
    expect(set.fsm.requests).toEqual([{ to: 'pop', payload: undefined }]);
    state.exit('Playing');
    expect(run.model?.snapshot().players[0].canUndo).toBe(false);
    expect(set.ui.visible.has('shop')).toBe(false);
  });

  it('solo: the P2 panel is absent and P2 keys do nothing', () => {
    const set = createFakeServices();
    set.fsm.stack = ['Playing', 'UpgradesShop'];
    set.services.session.current = new RealShopRun(
      testRunConfig({ mode: 'solo', players: [{ player: 0, vehicle: 'lancer' }] }),
    );
    const state = createUpgradesShopState(set.services);
    state.enter({ mode: 'midrun' }, 'Playing');
    for (let i = 0; i < 25; i++) state.update(1 / 60);
    set.input.queueMenu({ player: 1, kind: 'confirm' }, { player: 1, kind: 'down' });
    state.update(1 / 60);
    const vm = set.ui.vm('shop');
    expect(vm?.panels[1].present).toBe(false);
    expect(vm?.panels[1].cursor.row).toBe(0);
    expect(vm?.panels[0].gift).toBeNull();
    state.onCovered?.('Paused');
    expect(set.audio.ducked).toBe(true);
    state.onUncovered?.('Paused');
    expect(set.audio.ducked).toBe(false);
  });

  it('entering without a run logs an error and does nothing', () => {
    const set = createFakeServices();
    const state = createUpgradesShopState(set.services);
    state.enter({ mode: 'midrun' }, 'Playing');
    state.update(1 / 60);
    state.exit('Playing');
    expect(set.log.entries.some((e) => e.level === 'error')).toBe(true);
    expect(set.ui.visible.has('shop')).toBe(false);
  });
});

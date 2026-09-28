import { describe, expect, it } from 'vitest';
import type { RunConfig } from '../../src/contracts/run';
import type { DifficultyId } from '../../src/contracts/save';
import { createCharacterSelectState } from '../../src/states/CharacterSelectState';
import {
  applyPlayerIntent,
  createSelectModel,
  tickCountdown,
  type SelectRules,
} from '../../src/states/characterSelectModel';
import { FakeSaveStore, createTestSaveData } from '../helpers/fakeSave';
import { createFakeServices } from '../helpers/fakeServices';

function rig(
  o: {
    cores?: number;
    seedOverride?: number | null;
    unlocks?: ('specter' | 'tinker')[];
    difficulty?: DifficultyId;
  } = {},
) {
  const base = createTestSaveData({});
  const save = new FakeSaveStore(
    createTestSaveData({
      settings: o.difficulty === undefined ? base.settings : { ...base.settings, difficulty: o.difficulty },
      cores: o.cores ?? 0,
      meta: { hullFw: 2 },
      unlocks: ['lancer', 'bulwark', ...(o.unlocks ?? [])],
      lastLoadout: [{ player: 0, vehicle: 'bulwark' }],
    }),
  );
  const set = createFakeServices({ save });
  const services = { ...set.services, env: { ...set.services.env, seedOverride: o.seedOverride ?? null } };
  set.fsm.stack = ['CharacterSelect'];
  const state = createCharacterSelectState(services);
  const frame = (): void => {
    state.update(1 / 60);
  };
  return { set, state, frame, services };
}

describe('CharacterSelectState', () => {
  it('uses the last loadout, shows locked vehicles with their price and refuses Ready on them', () => {
    const { set, state, frame } = rig();
    state.enter({ prefill: null, mode: null }, 'MainMenu');
    expect(set.render.cameraMode).toBe('select');
    expect(set.audio.mood).toBe('select');
    expect(set.ui.vm('characterSelect')?.slots[0].vehicle).toBe('bulwark');
    expect(set.render.rec.last('showVehiclePreviews')?.args[0]).toEqual(['bulwark', null]);
    set.input.queueMenu({ player: 0, kind: 'right' });
    frame();
    const vm = set.ui.vm('characterSelect');
    expect(vm?.slots[0].vehicle).toBe('specter');
    expect(vm?.slots[0].locked).toBe(true);
    expect(vm?.slots[0].unlockPrice).toBe(60);
    set.input.queueMenu({ player: 0, kind: 'ready' });
    frame();
    expect(set.ui.vm('characterSelect')?.slots[0].ready).toBe(false);
    expect(set.ui.vm('characterSelect')?.message).toContain('locked');
    expect(set.audio.rec.last('play')?.args[0]).toBe('uiDeny');
  });

  it('builds the RunConfig after the 0.6 s countdown (seed override, Firmware snapshot, fire modes)', () => {
    const { set, state, frame } = rig({ seedOverride: 42 });
    state.enter({ prefill: null, mode: null }, 'MainMenu');
    set.input.queueMenu({ player: 0, kind: 'confirm' });
    frame();
    expect(set.ui.vm('characterSelect')?.countdown).toBeCloseTo(0.6 - 1 / 60);
    for (let i = 0; i < 40; i++) frame();
    const req = set.fsm.lastRequest();
    expect(req?.to).toBe('Playing');
    const config = (req?.payload as { config: RunConfig }).config;
    expect(config).toEqual({
      runId: 'run-1',
      seed: 42,
      mode: 'solo',
      players: [{ player: 0, vehicle: 'bulwark' }],
      meta: { hullFw: 2 },
      autofire: [true, true],
      focusToggle: [false, false],
      themeId: 'kernelPanic',
      // v2: the difficulty is snapshotted at launch; saves without the setting launch NORMAL.
      difficulty: 'normal',
    });
    expect(set.fsm.requests).toHaveLength(1);
    state.exit('Playing');
    const delta = set.save.rec.last('commitDebounced')?.args[0];
    expect(delta).toEqual({ lastLoadout: [{ player: 0, vehicle: 'bulwark' }], lastMode: 'solo' });
    expect(set.render.rec.last('showVehiclePreviews')?.args[0]).toEqual([null, null]);
  });

  it('snapshots the saved difficulty into the RunConfig', () => {
    const { set, state, frame } = rig({ difficulty: 'hard' });
    state.enter({ prefill: null, mode: null }, 'MainMenu');
    expect(set.ui.vm('characterSelect')?.difficulty).toBe('HARD');
    set.input.queueMenu({ player: 0, kind: 'confirm' });
    for (let i = 0; i < 41; i++) frame();
    const config = (set.fsm.lastRequest()?.payload as { config: RunConfig }).config;
    expect(config.difficulty).toBe('hard');
  });

  it('shows NORMAL for saves without a difficulty and CASUAL when chosen', () => {
    const a = rig();
    a.state.enter({ prefill: null, mode: null }, 'MainMenu');
    expect(a.set.ui.vm('characterSelect')?.difficulty).toBe('NORMAL');
    const b = rig({ difficulty: 'casual' });
    b.state.enter({ prefill: null, mode: null }, 'MainMenu');
    expect(b.set.ui.vm('characterSelect')?.difficulty).toBe('CASUAL');
  });

  it('un-readying cancels the countdown; P2 joins by click and leaves with dash', () => {
    const { set, state, frame } = rig({ unlocks: ['tinker'] });
    state.enter({ prefill: null, mode: null }, 'MainMenu');
    set.ui.click({ screen: 'characterSelect', kind: 'confirm', player: 1, itemId: 'join' });
    frame();
    expect(set.ui.vm('characterSelect')?.slots[1].joined).toBe(true);
    set.ui.click({ screen: 'characterSelect', kind: 'left', player: 1, itemId: 'vehicle' });
    frame();
    expect(set.ui.vm('characterSelect')?.slots[1].vehicle).toBe('lancer');
    set.input.queueMenu({ player: 0, kind: 'ready' }, { player: 1, kind: 'ready' });
    frame();
    expect(set.ui.vm('characterSelect')?.countdown).not.toBeNull();
    set.ui.click({ screen: 'characterSelect', kind: 'ready', player: 1, itemId: 'ready' });
    frame();
    expect(set.ui.vm('characterSelect')?.countdown).toBeNull();
    set.input.queueMenu({ player: 1, kind: 'back' });
    frame();
    expect(set.ui.vm('characterSelect')?.slots[1].joined).toBe(false);
    expect(set.ui.vm('characterSelect')?.countdown).not.toBeNull();
  });

  it('P1 dash (not ready) and the shared back leave to the menu', () => {
    const a = rig();
    a.state.enter({ prefill: null, mode: null }, 'MainMenu');
    a.set.input.queueMenu({ player: 0, kind: 'back' });
    a.frame();
    expect(a.set.fsm.lastRequest()?.to).toBe('MainMenu');
    const b = rig();
    b.state.enter({ prefill: null, mode: null }, 'MainMenu');
    b.set.ui.click({ screen: 'characterSelect', kind: 'back', player: 'any', itemId: 'back' });
    b.frame();
    expect(b.set.fsm.lastRequest()?.to).toBe('MainMenu');
  });

  it('an other-tab unlock refreshes the VM', () => {
    const { set, state, frame } = rig();
    state.enter({ prefill: [{ player: 0, vehicle: 'tinker' }], mode: null }, 'GameOver');
    expect(set.ui.vm('characterSelect')?.slots[0].locked).toBe(true);
    set.save.emitExternal({ ...set.save.data, unlocks: [...set.save.data.unlocks, 'tinker'] });
    frame();
    expect(set.ui.vm('characterSelect')?.slots[0].locked).toBe(false);
  });
});

describe('characterSelectModel', () => {
  const rules: SelectRules = { isUnlocked: () => true, lockedMessage: () => 'locked' };

  it('ignores intents from an absent player except a join', () => {
    const m = createSelectModel(null, null, []);
    expect(applyPlayerIntent(m, 1, 'ready', rules)).toBe('none');
    expect(applyPlayerIntent(m, 1, 'confirm', rules)).toBe('changed');
    expect(applyPlayerIntent(m, 1, 'confirm', rules)).toBe('changed');
    expect(m.ready[1]).toBe(true);
    expect(applyPlayerIntent(m, 0, 'pause', rules)).toBe('none');
  });

  it('confirm on the mode row toggles the mode; a ready player cannot change vehicle', () => {
    const m = createSelectModel(
      [
        { player: 0, vehicle: 'lancer' },
        { player: 1, vehicle: 'tinker' },
      ],
      'versus',
      [],
    );
    expect(m.mode).toBe('versus');
    applyPlayerIntent(m, 0, 'down', rules);
    applyPlayerIntent(m, 0, 'confirm', rules);
    expect(m.mode).toBe('coop');
    applyPlayerIntent(m, 1, 'ready', rules);
    expect(applyPlayerIntent(m, 1, 'left', rules)).toBe('none');
    expect(tickCountdown(m, 1)).toBe(false);
    applyPlayerIntent(m, 0, 'up', rules);
    applyPlayerIntent(m, 0, 'ready', rules);
    expect(tickCountdown(m, 0.3)).toBe(false);
    expect(tickCountdown(m, 0.3)).toBe(true);
  });
});

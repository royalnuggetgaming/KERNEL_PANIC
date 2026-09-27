import { describe, expect, it } from 'vitest';
import { createPlayingState, musicIntensity } from '../../src/states/PlayingState';
import { FakeSaveStore, TEST_SETTINGS, createTestSaveData } from '../helpers/fakeSave';
import { testRunConfig } from '../helpers/fakeRun';
import { createFakeServices } from '../helpers/fakeServices';
import { addTestEnemy } from '../helpers/worldFixture';

function rig(mode: 'solo' | 'coop' | 'versus' = 'coop', showFps = false) {
  const save = new FakeSaveStore(createTestSaveData({ settings: { ...TEST_SETTINGS, showFps } }));
  const set = createFakeServices({ save });
  set.fsm.stack = ['Playing'];
  const state = createPlayingState(set.services);
  const config = testRunConfig(
    mode === 'solo'
      ? { mode, players: [{ player: 0, vehicle: 'specter' }], autofire: [false, true] }
      : { mode },
  );
  state.enter({ config }, 'CharacterSelect');
  const run = set.sessions[0]!;
  return { set, state, run };
}

describe('PlayingState', () => {
  it('enter creates the run, attaches the world, shows the HUD and starts wave 1', () => {
    const { set, run } = rig('solo');
    expect(set.services.session.current).toBe(run);
    expect(set.render.world).toBe(run.world);
    expect(set.render.cameraMode).toBe('follow');
    expect(set.input.context).toBe('gameplay');
    expect(set.input.solo).toBe(true);
    expect(set.input.rec.last('setFireModes')?.args[0]).toEqual([false, true]);
    expect(run.rec.count('beginNextWave')).toBe(1);
    expect(set.ui.visible.has('hud')).toBe(true);
    expect(set.audio.mood).toBe('combat');
    expect(set.perf.playing).toBe(true);
    expect(set.render.rec.count('setSector')).toBe(1);
  });

  it('fixedUpdate samples both players and ticks; update drains events once and clears', () => {
    const { set, state, run } = rig();
    set.input.next[0] = { moveX: 1, fireHeld: true };
    state.fixedUpdate?.(1 / 120);
    state.fixedUpdate?.(1 / 120);
    expect(run.rec.count('tick')).toBe(2);
    state.update(1 / 60);
    const order = [
      ...set.render.rec.methods().filter((m) => m === 'consumeEvents'),
      ...set.audio.rec.methods().filter((m) => m === 'consumeEvents'),
    ];
    expect(order).toHaveLength(2);
    expect(run.rec.count('clearEvents')).toBe(1);
    state.render?.(0.25, 1 / 60);
    expect(set.render.rec.last('frame')?.args).toEqual([0.25, 1 / 60]);
    expect(set.render.rec.count('setBeat')).toBe(1);
  });

  it('forwards the requested time scale and the view rect', () => {
    const { set, state, run } = rig();
    run.world.run.timeScaleRequest = 0.35;
    state.fixedUpdate?.(1 / 120);
    expect(set.loop.timeScale).toBe(0.35);
    set.render.viewRectSink?.(-1, 1, -2, 2);
    expect(run.rec.last('setViewRect')?.args).toEqual([-1, 1, -2, 2]);
  });

  it('flags request the shop / GameOver once and stop the sim until applied', () => {
    const { set, state, run } = rig();
    run.setFlags({ waveClearReady: true });
    state.fixedUpdate?.(1 / 120);
    state.fixedUpdate?.(1 / 120);
    expect(set.fsm.requests).toEqual([{ to: 'UpgradesShop', payload: { mode: 'midrun' } }]);
    expect(run.rec.count('tick')).toBe(1);
    const other = rig();
    other.run.setFlags({ defeat: true });
    other.state.fixedUpdate?.(1 / 120);
    expect(other.set.fsm.lastRequest()).toEqual({ to: 'GameOver', payload: { outcome: 'defeat' } });
  });

  it('versus: roundOver pushes the shop, matchOver replaces with GameOver victory', () => {
    const a = rig('versus');
    a.run.setFlags({ roundOver: true });
    a.state.fixedUpdate?.(1 / 120);
    expect(a.set.fsm.lastRequest()).toEqual({ to: 'UpgradesShop', payload: { mode: 'midrun' } });
    const b = rig('versus');
    b.run.setFlags({ matchOver: true, roundOver: true });
    b.state.fixedUpdate?.(1 / 120);
    expect(b.set.fsm.lastRequest()).toEqual({ to: 'GameOver', payload: { outcome: 'victory' } });
  });

  it('pause intents request Paused; covered state freezes, ducks and stops ticking', () => {
    const { set, state, run } = rig();
    set.input.queueMenu({ player: 'any', kind: 'pause' }, { player: 'any', kind: 'pause' });
    state.update(1 / 60);
    expect(set.fsm.requests).toEqual([{ to: 'Paused', payload: { reason: 'user' } }]);
    set.fsm.stack = ['Playing', 'Paused'];
    state.onCovered?.('Paused');
    expect(set.render.frozenFrames).toBe(1);
    expect(set.audio.ducked).toBe(true);
    expect(set.perf.playing).toBe(false);
    const ticks = run.rec.count('tick');
    state.fixedUpdate?.(1 / 120);
    state.render?.(0.5, 1 / 60);
    expect(run.rec.count('tick')).toBe(ticks);
    expect(set.render.frames).toBe(0);
    state.onUncovered?.('Paused');
    expect(set.audio.ducked).toBe(false);
    expect(set.loop.rec.count('resetAccumulator')).toBe(2);
    expect(run.rec.count('beginNextWave')).toBe(1);
    state.fixedUpdate?.(1 / 120);
    expect(run.rec.count('tick')).toBe(ticks + 1);
  });

  it('after the shop: applyShopResults then beginNextWave', () => {
    const { state, run } = rig();
    state.onCovered?.('UpgradesShop');
    state.onUncovered?.('UpgradesShop');
    const m = run.rec.methods();
    expect(m.indexOf('applyShopResults')).toBeLessThan(m.lastIndexOf('beginNextWave'));
    expect(run.rec.count('beginNextWave')).toBe(2);
  });

  it('music follows boss presence, sector and intensity; FPS text when enabled', () => {
    const { set, state, run } = rig('coop', true);
    run.world.run.phase = 'combat';
    for (let i = 0; i < 40; i++) addTestEnemy(run.world, 'shard', i % 10, Math.floor(i / 10));
    state.update(1 / 60);
    expect(set.audio.rec.count('setIntensity')).toBeGreaterThanOrEqual(1);
    const boss = run.world.bosses[0]!;
    boss.alive = true;
    boss.hp = 50;
    boss.maxHp = 100;
    run.world.run.sector = 2;
    state.update(1 / 60);
    expect(set.audio.mood).toBe('boss');
    expect(set.audio.rec.last('setSector')?.args[0]).toBe(2);
    const hud = set.ui.vm('hud');
    expect(hud?.boss.visible).toBe(true);
    expect(hud?.boss.hpFrac).toBe(0.5);
    expect(hud?.fps).toBe('60 FPS');
    expect(musicIntensity(run.world)).toBeGreaterThan(0.5);
  });

  it('exit keeps the session for GameOver and hides the HUD', () => {
    const { set, state, run } = rig();
    state.exit('GameOver');
    expect(set.services.session.current).toBe(run);
    expect(set.ui.visible.has('hud')).toBe(false);
    expect(set.input.context).toBe('menu');
    expect(set.perf.playing).toBe(false);
    state.update(1 / 60);
    state.fixedUpdate?.(1 / 120);
    expect(run.disposed).toBe(false);
  });
});

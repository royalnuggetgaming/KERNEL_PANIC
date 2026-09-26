import { describe, expect, it } from 'vitest';
import { bootToMenu, createHarness, menuToPlaying } from './harness';

describe('states flow (real FSM, fake ports)', () => {
  it('Boot -> Menu -> Select (P2 joins) -> Playing -> Shop -> Playing -> Pause -> Resume -> Pause -> Abandon -> GameOver -> Retry -> Menu', async () => {
    const h = createHarness();
    const { input, audio, render, ui, save } = h.set;

    await bootToMenu(h);
    expect(audio.unlocked).toBe(true);
    expect(h.stack).toEqual(['MainMenu']);
    expect(render.cameraMode).toBe('attract');
    expect(audio.mood).toBe('menu');
    expect(ui.visible.has('boot')).toBe(false);
    expect(ui.vm('mainMenu')?.items[0]?.id).toBe('play');

    menuToPlaying(h, { p2: true });
    expect(h.stack).toEqual(['Playing']);
    const run = h.session(0);
    expect(run.config.mode).toBe('coop');
    expect(run.config.players.map((p) => p.vehicle)).toEqual(['lancer', 'bulwark']);
    expect(run.config.runId).toBe('run-1');
    expect(h.services.session.current).toBe(run);
    expect(run.rec.count('beginNextWave')).toBe(1);
    expect(run.rec.count('tick')).toBeGreaterThan(0);
    expect(input.context).toBe('gameplay');
    expect(render.world).toBe(run.world);
    expect(ui.visible.has('hud')).toBe(true);
    expect(save.rec.count('commitDebounced')).toBeGreaterThan(0);

    // Wave clear -> Patch Bay pushed over Playing.
    run.setFlags({ waveClearReady: true });
    h.frame();
    h.frame();
    expect(h.stack).toEqual(['Playing', 'UpgradesShop']);
    expect(render.frozenFrames).toBe(1);
    expect(audio.mood).toBe('shop');
    const ticksCovered = run.rec.count('tick');
    h.press({ player: 0, kind: 'ready' });
    h.press({ player: 1, kind: 'ready' });
    expect(run.rec.count('tick')).toBe(ticksCovered);
    const shop = h.shop();
    expect(shop.txs.filter((t) => t.kind === 'toggleReady')).toHaveLength(2);
    shop.countdownDone = true;
    h.frame();
    h.frame();
    expect(h.stack).toEqual(['Playing']);
    expect(shop.committed).toBe(true);
    expect(run.rec.count('applyShopResults')).toBe(1);
    expect(run.rec.count('beginNextWave')).toBe(2);
    expect(h.set.loop.rec.count('resetAccumulator')).toBeGreaterThanOrEqual(2);

    // Pause -> Resume.
    h.press({ player: 'any', kind: 'pause' });
    h.frame();
    expect(h.stack).toEqual(['Playing', 'Paused']);
    expect(input.rec.count('releaseAll')).toBeGreaterThan(0);
    expect(audio.ducked).toBe(true);
    h.press({ player: 'any', kind: 'confirm' });
    h.frame();
    expect(h.stack).toEqual(['Playing']);
    expect(audio.ducked).toBe(false);

    // Pause -> Abandon (hold confirm 600 ms).
    h.press({ player: 'any', kind: 'pause' });
    h.frame();
    expect(h.top).toBe('Paused');
    h.press({ player: 'any', kind: 'up' });
    input.held.add('Enter');
    h.press({ player: 'any', kind: 'confirm' });
    h.frames(20);
    expect(h.top).toBe('Paused');
    expect(ui.vm('pause')?.abandonHold).toBeGreaterThan(0.3);
    h.frames(30);
    input.held.clear();
    expect(h.stack).toEqual(['GameOver']);
    expect(ui.vm('gameOver')?.outcome).toBe('abandoned');
    expect(save.rec.count('commitRun')).toBe(1);
    expect(save.data.lastCommittedRunId).toBe('run-1');
    expect(save.data.records.runs).toBe(1);

    // Retry keeps the picks and the mode.
    h.press({ player: 'any', kind: 'confirm' });
    h.frame();
    expect(h.stack).toEqual(['CharacterSelect']);
    expect(run.disposed).toBe(true);
    expect(h.services.session.current).toBeNull();
    expect(render.world).toBeNull();
    const vm = ui.vm('characterSelect');
    expect(vm?.slots[1].joined).toBe(true);
    expect(vm?.slots[0].vehicle).toBe('lancer');
    expect(vm?.slots[1].vehicle).toBe('bulwark');
    expect(vm?.mode).toBe('coop');

    // Back to the menu.
    h.press({ player: 'any', kind: 'back' });
    h.frame();
    expect(h.stack).toEqual(['MainMenu']);
  });

  it('solo when P2 never joins; defeat goes to GameOver', async () => {
    const h = createHarness();
    await bootToMenu(h);
    menuToPlaying(h);
    const run = h.session();
    expect(run.config.mode).toBe('solo');
    expect(run.config.players).toHaveLength(1);
    expect(h.set.input.solo).toBe(true);
    run.setFlags({ defeat: true });
    h.frame();
    h.frame();
    expect(h.stack).toEqual(['GameOver']);
    expect(h.set.ui.vm('gameOver')?.outcome).toBe('defeat');
    expect(h.set.audio.mood).toBe('gameover');
    expect(h.set.render.cameraMode).toBe('gameover');
  });

  it('Retry after a solo run does not join P2', async () => {
    const h = createHarness();
    await bootToMenu(h);
    menuToPlaying(h);
    h.session().setFlags({ defeat: true });
    h.frames(2);
    h.press({ player: 'any', kind: 'confirm' });
    h.frame();
    const vm = h.set.ui.vm('characterSelect');
    expect(vm?.slots[1].joined).toBe(false);
    expect(vm?.mode).toBe('solo');
  });

  it('GameOver Menu item goes to the main menu and disposes the run', async () => {
    const h = createHarness();
    await bootToMenu(h);
    menuToPlaying(h);
    const run = h.session();
    run.setFlags({ defeat: true });
    h.frames(2);
    h.press({ player: 'any', kind: 'right' });
    h.press({ player: 'any', kind: 'confirm' });
    h.frame();
    expect(h.stack).toEqual(['MainMenu']);
    expect(run.disposed).toBe(true);
  });
});

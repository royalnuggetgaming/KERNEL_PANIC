import { describe, expect, it } from 'vitest';
import { bootToMenu, createHarness, menuToPlaying } from './harness';

describe('versusFlow', () => {
  it('mode picker -> rounds -> shop between rounds -> GameOver with the winner', async () => {
    const h = await (async () => {
      const x = createHarness();
      await bootToMenu(x);
      return x;
    })();
    const { ui, save } = h.set;

    // Mode row appears once P2 joins; P2 toggles it to VERSUS.
    h.press({ player: 'any', kind: 'confirm' });
    h.frame();
    expect(ui.vm('characterSelect')?.modeRowVisible).toBe(false);
    h.press({ player: 1, kind: 'confirm' });
    expect(ui.vm('characterSelect')?.modeRowVisible).toBe(true);
    expect(ui.vm('characterSelect')?.mode).toBe('coop');
    h.press({ player: 1, kind: 'down' });
    expect(ui.vm('characterSelect')?.slots[1].cursorRow).toBe('mode');
    h.press({ player: 1, kind: 'right' });
    expect(ui.vm('characterSelect')?.mode).toBe('versus');
    expect(ui.vm('characterSelect')?.modeLabel).toBe('VERSUS');
    h.press({ player: 0, kind: 'ready' }, { player: 1, kind: 'ready' });
    expect(ui.vm('characterSelect')?.countdown).not.toBeNull();
    h.frames(45);
    expect(h.stack).toEqual(['Playing']);
    const run = h.session();
    expect(run.config.mode).toBe('versus');
    expect(h.services.session.lastMode).toBe('versus');
    expect(ui.vm('hud')?.versus.visible).toBe(true);
    expect(ui.vm('hud')?.waveLabel).toBe('ROUND 1');

    // Round over -> shop (team row and gift hidden) -> next round.
    run.world.run.roundWins[0] = 1;
    run.setFlags({ roundOver: true });
    h.frames(2);
    expect(h.stack).toEqual(['Playing', 'UpgradesShop']);
    const shopVm = ui.vm('shop');
    expect(shopVm?.teamVisible).toBe(false);
    expect(shopVm?.panels[0].team).toHaveLength(0);
    expect(shopVm?.panels[0].gift).toBeNull();
    expect(shopVm?.subtitle).toContain('ROUND 1');
    h.press({ player: 0, kind: 'ready' }, { player: 1, kind: 'ready' });
    h.shop().countdownDone = true;
    h.frames(2);
    expect(h.stack).toEqual(['Playing']);
    expect(run.rec.count('beginNextWave')).toBe(2);
    expect(run.world.run.round).toBe(2);
    expect(run.flags.roundOver).toBe(false);

    // Match decided -> GameOver{victory} with the winner.
    run.world.run.roundWins[0] = 1;
    run.world.run.roundWins[1] = 3;
    run.winner = 1;
    run.setFlags({ matchOver: true });
    h.frames(2);
    expect(h.stack).toEqual(['GameOver']);
    const vm = ui.vm('gameOver');
    expect(vm?.mode).toBe('versus');
    expect(vm?.winner).toBe(1);
    expect(vm?.players.find((p) => p.player === 1)?.winner).toBe(true);
    expect(vm?.players.find((p) => p.player === 0)?.winner).toBe(false);
    // 5 x (1 + 3) + 10 = 30 Cores.
    expect(vm?.coresTotal).toBe(30);
    expect(save.data.cores).toBe(30);
    expect(save.data.records.versusMatches).toBe(1);
    expect(save.data.records.victories).toBe(0);
    expect(h.set.audio.mood).toBe('victory');

    // Retry keeps versus.
    h.press({ player: 'any', kind: 'confirm' });
    h.frame();
    expect(ui.vm('characterSelect')?.mode).toBe('versus');
  });

  it('a P2 leaving CharacterSelect returns the mode to solo; mode changes clear Ready', async () => {
    const h = createHarness();
    await bootToMenu(h);
    h.press({ player: 'any', kind: 'confirm' });
    h.frame();
    h.press({ player: 1, kind: 'confirm' });
    h.press({ player: 0, kind: 'ready' });
    expect(h.set.ui.vm('characterSelect')?.slots[0].ready).toBe(true);
    h.set.ui.click({ screen: 'characterSelect', kind: 'right', player: 'any', itemId: 'mode' });
    h.frame();
    const vm = h.set.ui.vm('characterSelect');
    expect(vm?.mode).toBe('versus');
    expect(vm?.slots[0].ready).toBe(false);
    h.press({ player: 1, kind: 'back' });
    expect(h.set.ui.vm('characterSelect')?.slots[1].joined).toBe(false);
    expect(h.set.ui.vm('characterSelect')?.mode).toBe('solo');
  });

  it('the versus flow is reachable with the menuToPlaying helper too', async () => {
    const h = createHarness();
    await bootToMenu(h);
    menuToPlaying(h, { p2: true, versus: true });
    expect(h.session().config.mode).toBe('versus');
  });
});

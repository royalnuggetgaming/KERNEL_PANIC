import { describe, expect, it } from 'vitest';
import { bootToMenu, createHarness, menuToPlaying, type Harness } from './harness';

async function toFinalShop(): Promise<Harness> {
  const h = createHarness();
  await bootToMenu(h);
  menuToPlaying(h, { p2: true });
  h.session().setFlags({ waveClearReady: true, finalVisit: true });
  h.frame();
  h.frame();
  return h;
}

describe('shopFlow', () => {
  it('final visit shows EXTRACT / PUSH DEEPER; EXTRACT goes to GameOver victory', async () => {
    const h = await toFinalShop();
    expect(h.stack).toEqual(['Playing', 'UpgradesShop']);
    const vm = h.set.ui.vm('shop');
    expect(vm?.finalChoice.visible).toBe(true);
    expect(vm?.finalChoice.extractLabel).toBe('EXTRACT');
    // P1 wraps up to the READY row and picks EXTRACT with left.
    h.press({ player: 0, kind: 'up' });
    expect(h.set.ui.vm('shop')?.panels[0].cursor.row).toBe(18);
    h.press({ player: 0, kind: 'left' });
    const shop = h.shop();
    expect(shop.choice).toBe('extract');
    expect(h.set.ui.vm('shop')?.finalChoice.selected).toBe('extract');
    h.press({ player: 0, kind: 'ready' }, { player: 1, kind: 'ready' });
    shop.countdownDone = true;
    h.frame();
    h.frame();
    expect(h.stack).toEqual(['GameOver']);
    expect(shop.committed).toBe(true);
    const run = h.session();
    expect(run.rec.last('summary')?.args[0]).toBe('victory');
    expect(h.set.ui.vm('gameOver')?.outcome).toBe('victory');
    expect(h.set.audio.mood).toBe('victory');
    expect(h.set.save.rec.count('commitRun')).toBe(1);
  });

  it('PUSH DEEPER (mouse) pops back to Playing and starts the next (OVERFLOW) wave', async () => {
    const h = await toFinalShop();
    h.set.ui.click({ screen: 'shop', kind: 'confirm', player: 'any', itemId: 'pushDeeper' });
    h.frame();
    const shop = h.shop();
    expect(shop.choice).toBe('pushDeeper');
    shop.countdownDone = true;
    h.frame();
    h.frame();
    expect(h.stack).toEqual(['Playing']);
    const run = h.session();
    expect(run.rec.count('applyShopResults')).toBe(1);
    expect(run.rec.count('beginNextWave')).toBe(2);
    expect(run.rec.methods().lastIndexOf('applyShopResults')).toBeLessThan(
      run.rec.methods().lastIndexOf('beginNextWave'),
    );
    expect(h.set.save.rec.count('commitRun')).toBe(0);
  });

  it('keys drive only their own cursor; fire buys, dash undoes, Lock column on cards', async () => {
    const h = await toFinalShop();
    const shop = h.shop();
    h.press({ player: 1, kind: 'down' });
    h.press({ player: 1, kind: 'down' });
    const vm = h.set.ui.vm('shop');
    expect(vm?.panels[0].cursor.row).toBe(0);
    expect(vm?.panels[1].cursor.row).toBe(2);
    h.press({ player: 0, kind: 'confirm' }, { player: 1, kind: 'confirm' });
    expect(shop.txs.slice(-2)).toEqual([
      { kind: 'buyRow', player: 0, id: 'thrusters' },
      { kind: 'buyRow', player: 1, id: 'overclock' },
    ]);
    // P2's intents queued first are still applied after P1's.
    h.press({ player: 1, kind: 'back' }, { player: 0, kind: 'back' });
    expect(shop.txs.slice(-2)).toEqual([
      { kind: 'undo', player: 0 },
      { kind: 'undo', player: 1 },
    ]);
    // P1 to the first card (row 9), Lock column with right.
    for (let i = 0; i < 9; i++) h.press({ player: 0, kind: 'down' });
    h.press({ player: 0, kind: 'right' });
    expect(h.set.ui.vm('shop')?.panels[0].cursor).toEqual({ row: 9, col: 1 });
    h.press({ player: 0, kind: 'confirm' });
    expect(shop.txs[shop.txs.length - 1]).toEqual({ kind: 'lock', player: 0, slot: 0 });
    h.press({ player: 0, kind: 'left' }, { player: 0, kind: 'confirm' });
    expect(shop.txs[shop.txs.length - 1]).toEqual({ kind: 'buyCard', player: 0, slot: 0 });
  });

  it('mouse clicks map to the same transactions', async () => {
    const h = await toFinalShop();
    const shop = h.shop();
    const click = (player: 0 | 1, kind: 'confirm' | 'ready' | 'back', itemId: string): void => {
      h.set.ui.click({ screen: 'shop', kind, player, itemId });
      h.frame();
    };
    click(0, 'confirm', 'row:payload');
    click(1, 'confirm', 'team:linkAmp');
    click(0, 'confirm', 'lock:card:2');
    click(0, 'confirm', 'card:1');
    click(1, 'confirm', 'repair');
    click(1, 'confirm', 'reroll');
    click(0, 'confirm', 'gift');
    click(1, 'back', 'undo');
    click(0, 'ready', 'ready');
    click(0, 'confirm', 'nonsense');
    expect(shop.txs).toEqual([
      { kind: 'buyRow', player: 0, id: 'payload' },
      { kind: 'buyTeam', player: 1, id: 'linkAmp' },
      { kind: 'lock', player: 0, slot: 2 },
      { kind: 'buyCard', player: 0, slot: 1 },
      { kind: 'repair', player: 1 },
      { kind: 'reroll', player: 1 },
      { kind: 'gift', player: 0 },
      { kind: 'undo', player: 1 },
      { kind: 'toggleReady', player: 0 },
    ]);
    expect(h.set.ui.vm('shop')?.panels[0].cursor.row).toBe(17);
  });

  it('a failed purchase shows a toast and plays the deny sound; toasts expire', async () => {
    const h = await toFinalShop();
    const shop = h.shop();
    shop.nextResult = { ok: false, reason: 'funds' };
    h.press({ player: 0, kind: 'confirm' });
    expect(h.set.ui.vm('shop')?.panels[0].toast).toBe('Not enough Bits');
    expect(h.set.audio.rec.last('play')?.args[0]).toBe('uiDeny');
    shop.nextResult = { ok: false, reason: 'soldOut' };
    h.set.ui.click({ screen: 'shop', kind: 'confirm', player: 1, itemId: 'team:spareKernel' });
    h.frame();
    expect(h.set.ui.vm('shop')?.panels[1].toast).toBe('Partner bought it');
    h.frames(120);
    expect(h.set.ui.vm('shop')?.panels[0].toast).toBeNull();
  });

  it('Escape in the shop opens Pause over it; resuming returns to the shop', async () => {
    const h = await toFinalShop();
    h.press({ player: 'any', kind: 'back' });
    h.frame();
    expect(h.stack).toEqual(['Playing', 'UpgradesShop', 'Paused']);
    expect(h.set.audio.ducked).toBe(true);
    h.press({ player: 'any', kind: 'back' });
    h.frame();
    expect(h.stack).toEqual(['Playing', 'UpgradesShop']);
    expect(h.set.audio.ducked).toBe(false);
  });
});

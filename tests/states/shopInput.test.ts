/**
 * Mid-run shop keyboard routing (plan 5):
 * - "Pause: Escape or KeyP, from either player": the 'pause' intent opens Paused from the shop, and KeyP in
 *   Paused resumes (toggle).
 * - "SOLO: both binding sets drive P1": with P2 not joined, P2-tagged keys (arrows, Period, Slash, Comma) act
 *   for P1 in the shop; in co-op they stay P2's.
 */
import { describe, expect, it } from 'vitest';
import { bootToMenu, createHarness, menuToPlaying, type Harness } from './harness';

async function toShop(p2: boolean): Promise<Harness> {
  const h = createHarness();
  await bootToMenu(h);
  menuToPlaying(h, { p2 });
  h.session().setFlags({ waveClearReady: true });
  h.frame();
  h.frame();
  return h;
}

describe('mid-run shop input', () => {
  it('KeyP (pause intent) in the shop opens Paused like Escape, and KeyP in Paused resumes', async () => {
    const h = await toShop(true);
    expect(h.stack).toEqual(['Playing', 'UpgradesShop']);
    h.press({ player: 'any', kind: 'pause' });
    h.frame();
    expect(h.stack).toEqual(['Playing', 'UpgradesShop', 'Paused']);
    h.press({ player: 'any', kind: 'pause' });
    h.frame();
    expect(h.stack).toEqual(['Playing', 'UpgradesShop']);
  });

  it('solo shop: the P2 key set (arrows) moves the P1 cursor and Period buys for P1', async () => {
    const h = await toShop(false);
    expect(h.stack).toEqual(['Playing', 'UpgradesShop']);
    const shop = h.shop();
    h.press({ player: 1, kind: 'down' });
    expect(h.set.ui.vm('shop')?.panels[0].cursor.row).toBe(1);
    const before = shop.txs.length;
    h.press({ player: 1, kind: 'confirm' });
    expect(shop.txs.length).toBe(before + 1);
    expect(shop.txs[shop.txs.length - 1]).toMatchObject({ player: 0 });
  });

  it('co-op shop: P2-tagged keys stay with P2', async () => {
    const h = await toShop(true);
    h.press({ player: 1, kind: 'down' });
    expect(h.set.ui.vm('shop')?.panels[0].cursor.row).toBe(0);
    expect(h.set.ui.vm('shop')?.panels[1].cursor.row).toBe(1);
  });
});

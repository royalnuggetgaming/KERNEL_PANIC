/**
 * INPUT critic reproductions (should FAIL on the current code).
 * - INPUT-1: KeyP (the 'pause' MenuIntent, plan 5 "Pause: Escape or KeyP, from either player") is ignored in the
 *   mid-run shop; only Escape/Backspace reach Paused.
 * - INPUT-2: solo merge (plan 5 "SOLO: both binding sets drive P1") does not apply in the shop: P2-tagged keys
 *   (arrows, Period, Slash, Comma) are dropped because P2 is not joined.
 */
import { describe, expect, it } from 'vitest';
import { bootToMenu, createHarness, menuToPlaying, type Harness } from '../../states/harness';

async function toShop(p2: boolean): Promise<Harness> {
  const h = createHarness();
  await bootToMenu(h);
  menuToPlaying(h, { p2 });
  h.session().setFlags({ waveClearReady: true });
  h.frame();
  h.frame();
  return h;
}

describe('critic/input: mid-run shop input', () => {
  it('INPUT-1: KeyP (pause intent) in the shop opens Paused, like Escape does', async () => {
    const h = await toShop(true);
    expect(h.stack).toEqual(['Playing', 'UpgradesShop']);
    h.press({ player: 'any', kind: 'pause' });
    h.frame();
    expect(h.stack).toEqual(['Playing', 'UpgradesShop', 'Paused']);
  });

  it('INPUT-2: solo shop, the P2 key set (arrows) moves P1 cursor and Period buys', async () => {
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
});

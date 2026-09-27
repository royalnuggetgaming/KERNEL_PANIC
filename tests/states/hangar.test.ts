import { describe, expect, it } from 'vitest';
import { FakeSaveStore, createTestSaveData } from '../helpers/fakeSave';
import { bootToMenu, createHarness, type Harness } from './harness';

async function toHangar(cores: number): Promise<Harness> {
  const h = createHarness({ save: new FakeSaveStore(createTestSaveData({ cores })) });
  await bootToMenu(h);
  h.press({ player: 'any', kind: 'down' });
  h.press({ player: 'any', kind: 'confirm' });
  h.frame();
  return h;
}

describe('UpgradesShop{meta} (Firmware hangar)', () => {
  it('buys Firmware and unlocks with immediate save commits', async () => {
    const h = await toHangar(100);
    const { save, ui } = h.set;
    expect(h.stack).toEqual(['UpgradesShop']);
    expect(ui.vm('hangar')?.title).toBe('FIRMWARE');
    h.press({ player: 'any', kind: 'confirm' });
    expect(save.rec.count('commit')).toBe(1);
    expect(save.data.cores).toBe(80);
    expect(save.data.meta.hullFw).toBe(1);
    expect(save.data.firmwareSpent.hullFw).toBe(20);
    expect(ui.vm('hangar')?.message).toContain('level 1');
    ui.click({ screen: 'hangar', kind: 'confirm', player: 'any', itemId: 'unlock:specter' });
    h.frame();
    expect(save.data.unlocks).toContain('specter');
    expect(save.data.cores).toBe(20);
    expect(ui.vm('hangar')?.items.find((i) => i.id === 'unlock:specter')?.status).toBe('owned');
    ui.click({ screen: 'hangar', kind: 'confirm', player: 'any', itemId: 'unlock:tinker' });
    h.frame();
    expect(ui.vm('hangar')?.message).toBe('Not enough Cores');
    expect(save.data.cores).toBe(20);
  });

  it('respec needs a second confirm, refunds the recorded spend and keeps unlocks', async () => {
    const h = await toHangar(100);
    const { save, ui } = h.set;
    h.press({ player: 'any', kind: 'confirm' });
    ui.click({ screen: 'hangar', kind: 'confirm', player: 'any', itemId: 'unlock:specter' });
    h.frame();
    expect(save.data.cores).toBe(20);
    h.press({ player: 'any', kind: 'down' }, { player: 'any', kind: 'down' });
    expect(ui.vm('hangar')?.items[ui.vm('hangar')?.cursor ?? 0]?.kind).toBe('respec');
    expect(ui.vm('hangar')?.respecRefund).toBe(20);
    ui.click({ screen: 'hangar', kind: 'confirm', player: 'any', itemId: 'respec' });
    h.frame();
    expect(save.data.cores).toBe(20);
    expect(ui.vm('hangar')?.message).toContain('Confirm again');
    h.press({ player: 'any', kind: 'confirm' });
    expect(save.data.cores).toBe(40);
    expect(save.data.meta.hullFw ?? 0).toBe(0);
    expect(save.data.unlocks).toContain('specter');
    h.press({ player: 'any', kind: 'confirm' });
    expect(ui.vm('hangar')?.message).toBe('Nothing to refund');
  });

  it('moving the cursor disarms a pending respec', async () => {
    const h = await toHangar(100);
    h.press({ player: 'any', kind: 'confirm' });
    h.press({ player: 'any', kind: 'up' });
    h.press({ player: 'any', kind: 'confirm' });
    h.press({ player: 'any', kind: 'up' }, { player: 'any', kind: 'down' });
    h.press({ player: 'any', kind: 'confirm' });
    expect(h.set.save.data.cores).toBe(80);
  });

  it('within one frame P1 buys before P2', async () => {
    const h = await toHangar(20);
    h.press({ player: 1, kind: 'confirm' }, { player: 0, kind: 'down' });
    // P1 moved first (to Boot Cache: 25, unaffordable), then P2 confirmed there.
    expect(h.set.save.data.cores).toBe(20);
    expect(h.set.ui.vm('hangar')?.message).toBe('Not enough Cores');
  });

  it('maxed levels and read-only saves are refused; a write failure toasts', async () => {
    const h = await toHangar(1000);
    const { save, ui } = h.set;
    for (let i = 0; i < 6; i++) h.press({ player: 'any', kind: 'confirm' });
    expect(save.data.meta.hullFw).toBe(5);
    expect(ui.vm('hangar')?.message).toBe('Already at max level');
    save.failWith = 'quota';
    h.press({ player: 'any', kind: 'down' }, { player: 'any', kind: 'confirm' });
    expect(ui.toasts.at(-1)?.kind).toBe('error');
    save.status = 'readOnlyFuture';
    h.press({ player: 'any', kind: 'confirm' });
    expect(ui.vm('hangar')?.message).toContain('Read-only');
    expect(ui.vm('hangar')?.readOnly).toBe(true);
  });

  it('back returns to the main menu', async () => {
    const h = await toHangar(0);
    h.press({ player: 0, kind: 'back' });
    h.frame();
    expect(h.stack).toEqual(['MainMenu']);
    expect(h.set.ui.visible.has('hangar')).toBe(false);
  });
});

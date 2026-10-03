import { describe, expect, it } from 'vitest';
import { CHEATS } from '../../src/config/cheats';
import { CARD_IDS, STAT_ROW_IDS, TEAM_ITEM_IDS } from '../../src/contracts/ids';
import type { PlayerLoadout } from '../../src/contracts/run';
import { installedItems, loadoutSignature } from '../../src/states/loadoutViewModel';
import { KERNEL_PANIC } from '../../src/themes/kernelPanic';

function loadout(patch: Partial<PlayerLoadout> = {}): PlayerLoadout {
  const rows = Object.fromEntries(STAT_ROW_IDS.map((id) => [id, 0])) as PlayerLoadout['rows'];
  const team = Object.fromEntries(TEAM_ITEM_IDS.map((id) => [id, 0])) as PlayerLoadout['team'];
  return { rows, team, cards: new Uint8Array(CARD_IDS.length), ...patch };
}

describe('INSTALLED lists include Firmware and cheats', () => {
  it('a run with only Firmware is never "nothing installed"', () => {
    const l = loadout({ meta: { hullFw: 2, legendaryPool: 1 } });
    const items = installedItems(l, KERNEL_PANIC, true);
    expect(items.map((i) => i.id)).toEqual(['fw:hullFw', 'fw:legendaryPool']);
    expect(items[0]).toMatchObject({ kind: 'firmware', label: 'Hull FW', count: '2' });
    expect(items[0]!.desc).toMatch(/^FIRMWARE \(permanent\): \+10% max HP/);
  });

  it('the HUD folds Firmware into one FW chip and shows active cheats', () => {
    const l = loadout({ meta: { hullFw: 1, overclockFw: 3 }, cheats: ['god'] });
    const items = installedItems(l, KERNEL_PANIC, true, true);
    expect(items.map((i) => [i.short, i.count])).toEqual([
      ['FW', '2'],
      ['GOD', ''], // each cheat chip names its cheat (it used to read CHEAT for all of them)
    ]);
    const shorts = CHEATS.map((c) => c.short);
    expect(new Set(shorts).size).toBe(shorts.length);
    for (const sh of shorts) expect(sh.length).toBeLessThanOrEqual(6);
    expect(items[0]!.desc).toContain('Overclock FW 3');
    expect(items[1]!.desc).toMatch(/no Cores, no records/);
  });

  it('the loadout signature changes with Firmware', () => {
    expect(loadoutSignature(loadout())).not.toBe(loadoutSignature(loadout({ meta: { hullFw: 1 } })));
  });
});

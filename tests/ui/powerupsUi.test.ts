import { describe, expect, it } from 'vitest';
import { KERNEL_PANIC } from '../../src/themes/kernelPanic';
import { Hud } from '../../src/ui/hud/Hud';
import { HangarScreen } from '../../src/ui/screens/HangarScreen';
import { MainMenuScreen } from '../../src/ui/screens/MainMenuScreen';
import { PauseScreen } from '../../src/ui/screens/PauseScreen';
import { ShopScreen } from '../../src/ui/screens/ShopScreen';
import { InstalledList } from '../../src/ui/widgets/InstalledList';
import { FakeDocument, asDocument, asFake } from './fakeDom';
import {
  hangarVM,
  hudPlayerVM,
  hudVM,
  installedItem,
  mainMenuVM,
  manualVM,
  pauseVM,
  shopPanelVM,
  shopVM,
} from './fixtures';

const ctx = () => ({ doc: asDocument(new FakeDocument()), theme: KERNEL_PANIC });

describe('powerup descriptions in the Patch Bay and Hangar', () => {
  it('every shop row shows its description and next-level line; INSTALLED lists the loadout', () => {
    const s = new ShopScreen(ctx());
    const el = asFake(s.el);
    el.hidden = false;
    const installed = [
      installedItem('Thrusters', { count: '2' }),
      installedItem('Split Shot', { kind: 'card' }),
    ];
    s.render(shopVM({ panels: [shopPanelVM(0, { installed }), shopPanelVM(1)] }), 0);
    const p1 = el.byClass('kp-shop-panel')[0]!;
    const rows = p1.byClass('kp-row').filter((r) => r.visible);
    // 2 stat rows + repair + 3 cards + 2 team + reroll + gift.
    expect(rows.length).toBe(10);
    for (const r of rows) expect(r.first('kp-row-blurb').textContent).toMatch(/ blurb$/);
    expect(rows[0]!.first('kp-row-next').textContent).toBe('thrusters next');
    const chips = p1
      .first('kp-shop-installed')
      .byClass('kp-inst')
      .filter((c) => c.visible);
    expect(chips.map((c) => c.textContent)).toEqual(['Thrusters2', 'Split Shot1']);
    expect(chips[0]!.getAttribute('title')).toBe('Thrusters desc');
    expect(p1.first('kp-shop-installed').first('kp-inst-empty').hidden).toBe(true);
    expect(el.byClass('kp-shop-panel')[1]!.first('kp-inst-empty').hidden).toBe(false);
    // READY is in the pinned footer, outside the scrolling list.
    expect(p1.first('kp-shop-foot').byClass('kp-shop-ready').length).toBe(1);
    expect(p1.first('kp-shop-scroll').byClass('kp-shop-ready').length).toBe(0);
  });

  it('a cursor move scrolls its row into view once (not on every render)', () => {
    const s = new ShopScreen(ctx());
    const el = asFake(s.el);
    el.hidden = false;
    const at = (row: number) =>
      shopVM({ panels: [shopPanelVM(0, { cursor: { row, col: 0 } }), shopPanelVM(1)] });
    s.render(at(4), 0);
    const p1 = el.byClass('kp-shop-panel')[0]!;
    const card = p1.byClass('kp-row-card')[1]!;
    expect(card.scrollIntoViewCalls).toBe(1);
    s.render(at(4), 16);
    expect(card.scrollIntoViewCalls).toBe(1);
    s.render(at(8), 32);
    expect(p1.first('kp-shop-util').byClass('kp-row')[0]!.scrollIntoViewCalls).toBe(1);
  });

  it('the hangar shows a description line under every item', () => {
    const s = new HangarScreen(ctx());
    const el = asFake(s.el);
    el.hidden = false;
    s.render(hangarVM({ cursor: 1 }));
    const rows = el.byClass('kp-row').filter((r) => r.visible);
    expect(rows.map((r) => r.first('kp-row-blurb').textContent)).toEqual([
      'hullFw blurb',
      'specter blurb',
      'respec blurb',
    ]);
    expect(rows[1]!.scrollIntoViewCalls).toBe(1);
    expect(el.byClass('kp-shop-detail').length).toBe(0);
  });
});

describe('installed powerups in the HUD and Pause', () => {
  it('the HUD strip rebuilds only when the loadout key changes', () => {
    const hud = new Hud(ctx());
    const el = asFake(hud.el);
    el.hidden = false;
    const items = [installedItem('Thrusters', { short: 'THR', count: '2' })];
    const p = (key: number, loadout = items) => hudPlayerVM({ loadout, loadoutKey: key });
    hud.render(hudVM({ players: [p(1), p(0, [])] }), 0);
    const strip = el.byClass('kp-pp')[0]!.first('kp-pp-loadout');
    expect(strip.hidden).toBe(false);
    const chip = strip.byClass('kp-inst')[0]!;
    expect(chip.textContent).toBe('THR2');
    expect(chip.getAttribute('title')).toBe('Thrusters 2: Thrusters desc');
    expect(el.byClass('kp-pp')[1]!.first('kp-pp-loadout').hidden).toBe(true);
    const writes = chip.textWrites;
    // Same key, new (equal) list: nothing is touched.
    hud.render(hudVM({ players: [p(1, [installedItem('Payload')]), p(0, [])] }), 1000);
    expect(chip.textWrites).toBe(writes);
    hud.render(hudVM({ players: [p(2, [installedItem('Payload', { short: 'PAY' })]), p(0, [])] }), 2000);
    expect(chip.textContent).toBe('PAY1');
  });

  it('Pause lists each present player with descriptions next to the menu', () => {
    const s = new PauseScreen(ctx());
    const el = asFake(s.el);
    el.hidden = false;
    s.render(
      pauseVM({
        loadouts: [
          {
            player: 0,
            present: true,
            name: 'LANCER',
            items: [installedItem('Payload', { desc: '+30% damage' })],
          },
          { player: 1, present: false, name: 'BULWARK', items: [] },
        ],
      }),
    );
    const box = el.first('kp-pause-installed');
    expect(box.hidden).toBe(false);
    const cols = box.byClass('kp-pause-lo').filter((c) => c.visible);
    expect(cols.length).toBe(1);
    expect(cols[0]!.classList.contains('kp-p1')).toBe(true);
    expect(cols[0]!.first('kp-inst-desc').textContent).toBe('+30% damage');
    // A sub-panel (manual) hides the menu and the installed lists.
    s.render(pauseVM({ panel: 'manual', manual: manualVM() }));
    expect(box.hidden).toBe(true);
    expect(el.first('kp-manual').hidden).toBe(false);
  });

  it('InstalledList shows its empty text for an empty loadout', () => {
    const l = new InstalledList(asDocument(new FakeDocument()), 'x', 'Nothing installed yet', 'rows');
    l.render([]);
    expect(asFake(l.el).first('kp-inst-empty').hidden).toBe(false);
  });
});

describe('HOW TO PLAY panel', () => {
  it('renders the table of contents, the open page and pointer targets', () => {
    const s = new MainMenuScreen(ctx());
    const el = asFake(s.el);
    el.hidden = false;
    s.render(mainMenuVM({ panel: 'manual', manual: manualVM({ page: 0 }) }));
    const panel = el.first('kp-manual');
    expect(panel.hidden).toBe(false);
    expect(el.first('kp-menu-box').hidden).toBe(true);
    const toc = panel.byClass('kp-manual-toc-item');
    expect(toc.map((t) => t.textContent)).toEqual(['Goal', 'Tips']);
    expect(toc[1]!.getAttribute('data-item')).toBe('manual:1');
    expect(toc[0]!.classList.contains('is-cursor')).toBe(true);
    expect(panel.first('kp-manual-title').textContent).toBe('Goal');
    expect(panel.first('kp-manual-counter').textContent).toBe('1 / 2');
    const blocks = panel.byClass('kp-mb').filter((b) => b.visible);
    expect(blocks.map((b) => b.classList.contains('kp-mb-item'))).toEqual([false, true]);
    expect(blocks[1]!.first('kp-mb-term').textContent).toBe('Move');
    expect(blocks[0]!.first('kp-mb-term').hidden).toBe(true);
    expect(panel.first('kp-manual-prev').getAttribute('data-kind')).toBe('left');
    expect(panel.first('kp-manual-next').getAttribute('data-kind')).toBe('right');
    expect(panel.first('kp-back').getAttribute('data-kind')).toBe('back');

    panel.first('kp-manual-page').scrollTop = 120;
    s.render(mainMenuVM({ panel: 'manual', manual: manualVM({ page: 1 }) }));
    expect(panel.first('kp-manual-title').textContent).toBe('Tips');
    expect(toc[1]!.classList.contains('is-cursor')).toBe(true);
    expect(panel.first('kp-manual-page').scrollTop).toBe(0);
    expect(panel.byClass('kp-mb').filter((b) => b.visible).length).toBe(1);
  });
});

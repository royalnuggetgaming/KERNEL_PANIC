import { describe, expect, it } from 'vitest';
import { statRowDef } from '../../src/config/runCatalog';
import { HudVmWriter } from '../../src/states/hudViewModel';
import { installedItems, loadoutSignature } from '../../src/states/loadoutViewModel';
import { createPausedState } from '../../src/states/PausedState';
import { cardDesc, statRowDesc, statRowNext, statRowTotal } from '../../src/states/powerupText';
import { buildShopVM } from '../../src/states/shopViewModel';
import { KERNEL_PANIC } from '../../src/themes/kernelPanic';
import { FakeShop, testRunConfig } from '../helpers/fakeRun';
import { createFakeServices } from '../helpers/fakeServices';
import { LoadoutRunSession, blankLoadout, setCard } from './loadoutRun';

const CURSORS = [
  { row: 0, col: 0 },
  { row: 0, col: 0 },
] as const;

describe('installed powerup lists', () => {
  it('lists stat rows, cards with stacks and team items with their current effect', () => {
    const l = blankLoadout();
    l.rows.thrusters = 2;
    l.rows.payload = 1;
    setCard(l, 'splitShot', 2);
    setCard(l, 'afterimage', 1);
    setCard(l, 'shardCache', 3);
    l.team.linkAmp = 1;
    l.team.spareKernel = 2;
    const items = installedItems(l, KERNEL_PANIC, true);
    expect(items.map((i) => `${i.label} ${i.count}`.trim())).toEqual([
      'Thrusters 2',
      'Payload 1',
      'Split Shot ×2',
      'Afterimage',
      'Link Amplifier 1',
    ]);
    expect(items[0]!.desc).toBe(statRowTotal('thrusters', 2));
    expect(items[0]!.short).toBe('THR');
    expect(items[2]!.desc).toBe(cardDesc('splitShot'));
    expect(items[4]!.kind).toBe('team');
    // Versus has no team row: team items are left out.
    expect(installedItems(l, KERNEL_PANIC, false).some((i) => i.kind === 'team')).toBe(false);
  });

  it('the signature changes with any level', () => {
    const l = blankLoadout();
    const a = loadoutSignature(l);
    l.rows.magnet = 1;
    const b = loadoutSignature(l);
    setCard(l, 'pierce', 1);
    expect(new Set([a, b, loadoutSignature(l)]).size).toBe(3);
  });
});

describe('HUD installed strip', () => {
  it('reads the loadout once per wave and bumps the key only when it changed', () => {
    const run = new LoadoutRunSession();
    const w = run.world;
    w.run.wave = 1;
    const writer = new HudVmWriter(KERNEL_PANIC, run);
    const first = writer.write(w, null);
    expect(first.players[0].loadout).toEqual([]);
    const key0 = first.players[0].loadoutKey;
    const reads = run.loadoutReads;
    for (let i = 0; i < 30; i++) writer.write(w, null);
    expect(run.loadoutReads).toBe(reads);
    // A shop visit buys Thrusters, then the next wave begins.
    run.loadouts[0].rows.thrusters = 1;
    w.run.wave = 2;
    const vm = writer.write(w, null);
    expect(vm.players[0].loadout.map((i) => i.label)).toEqual(['Thrusters']);
    expect(vm.players[0].loadoutKey).toBe(key0 + 1);
    // P2 bought nothing: same key, same list identity.
    expect(vm.players[1].loadoutKey).toBe(first.players[1].loadoutKey);
    expect(writer.write(w, null).players[0].loadout).toBe(vm.players[0].loadout);
  });

  it('without a loadout reader the strip stays empty', () => {
    const run = new LoadoutRunSession();
    const vm = new HudVmWriter(KERNEL_PANIC).write(run.world, null);
    expect(vm.players[0].loadout).toEqual([]);
    expect(vm.players[0].loadoutKey).toBe(0);
  });
});

describe('Patch Bay descriptions and INSTALLED', () => {
  it('every row has a description and a next-level line; INSTALLED comes from the live loadout', () => {
    const run = new LoadoutRunSession();
    run.loadouts[0].rows.thrusters = 2;
    setCard(run.loadouts[0], 'pierce', 1);
    const snap = new FakeShop(run.world).snapshot();
    const vm = buildShopVM(snap, CURSORS, KERNEL_PANIC, [null, null], [run.loadout(0), run.loadout(1)]);
    const p = vm.panels[0];
    const all = [...p.rows, p.repair, ...p.cards, ...p.team, p.reroll, ...(p.gift === null ? [] : [p.gift])];
    for (const r of all) expect(r.blurb.length).toBeGreaterThan(8);
    expect(p.rows[0]!.blurb).toBe(statRowDesc('thrusters'));
    expect(p.rows[0]!.next).toBe(statRowNext('thrusters', 0));
    expect(p.cards[0]!.blurb).toBe(cardDesc('pierce'));
    expect(p.cards[0]!.next).toContain('Owned ×1');
    expect(p.team.find((t) => t.id === 'team:spareKernel')!.next).toContain('team holds');
    expect(p.installed.map((i) => i.label)).toEqual([statRowDef('thrusters').label, 'Pierce']);
    expect(vm.panels[1].installed).toEqual([]);
  });

  it('without loadouts the INSTALLED lists are empty (older run doubles)', () => {
    const run = new LoadoutRunSession();
    const vm = buildShopVM(new FakeShop(run.world).snapshot(), CURSORS, KERNEL_PANIC);
    expect(vm.panels[0].installed).toEqual([]);
  });
});

describe('Pause installed lists', () => {
  it('shows each present player with descriptions', () => {
    const set = createFakeServices();
    const run = new LoadoutRunSession(testRunConfig({ mode: 'coop' }));
    run.loadouts[1].rows.overclock = 3;
    set.services.session.current = run;
    set.fsm.stack = ['Playing', 'Paused'];
    const state = createPausedState(set.services);
    state.enter({ reason: 'user' }, 'Playing');
    const lo = set.ui.vm('pause')!.loadouts;
    expect(lo.map((l) => l.present)).toEqual([true, true]);
    expect(lo[0]!.items).toEqual([]);
    expect(lo[1]!.items[0]!.desc).toBe(statRowTotal('overclock', 3));
    expect(lo[1]!.name).toBe('BULWARK');
  });
});

import { describe, expect, it } from 'vitest';
import { CARD_IDS } from '../../src/contracts/ids';
import { NullLogger } from '../../src/core/logger';
import { createRunSession } from '../../src/sim/RunSession';
import { testRunConfig } from '../helpers/fakeRun';

describe('RunSession.loadout (v2 installed-powerups read)', () => {
  it('starts empty, follows purchases inside the open visit and keeps them after the visit', () => {
    const run = createRunSession(testRunConfig({ mode: 'coop' }), { log: NullLogger });
    const empty = run.loadout(0);
    expect(Object.values(empty.rows).every((l) => l === 0)).toBe(true);
    expect(Array.from(empty.cards).every((c) => c === 0)).toBe(true);
    expect(empty.cards.length).toBe(CARD_IDS.length);
    expect(empty.team.spareKernel).toBe(run.world.run.spareKernels);

    run.state.run.wallets[0] = 5000;
    run.state.run.wallets[1] = 5000;
    const shop = run.openShop();
    shop.update(1000);
    expect(shop.apply({ kind: 'buyRow', player: 0, id: 'thrusters' }).ok).toBe(true);
    expect(shop.apply({ kind: 'buyTeam', player: 1, id: 'linkAmp' }).ok).toBe(true);
    expect(run.loadout(0).rows.thrusters).toBe(1);
    expect(run.loadout(1).rows.thrusters).toBe(0);
    expect(run.loadout(0).team.linkAmp).toBe(1);
    expect(shop.apply({ kind: 'undo', player: 0 }).ok).toBe(true);
    expect(run.loadout(0).rows.thrusters).toBe(0);
    expect(shop.apply({ kind: 'buyRow', player: 0, id: 'payload' }).ok).toBe(true);

    shop.commit();
    run.applyShopResults();
    const after = run.loadout(0);
    expect(after.rows.payload).toBe(1);
    expect(after.team.linkAmp).toBe(1);
    // Copies: mutating a result never leaks into the session.
    (after.rows as Record<string, number>).payload = 9;
    expect(run.loadout(0).rows.payload).toBe(1);
    run.dispose();
  });
});

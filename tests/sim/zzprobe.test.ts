import { it } from 'vitest';
import { createRunSession } from '../../src/sim/RunSession';
import { stateHash } from '../../src/sim/stateHash';
import { NullLogger } from '../../src/core/logger';
import { Autopilot } from './autopilot';
import { testRunConfig } from '../helpers/fakeRun';

it('probe', () => {
  for (const mode of ['solo', 'coop'] as const) {
    const s = createRunSession(testRunConfig(mode === 'solo' ? { mode, players: [{ player: 0, vehicle: 'lancer' }] } : {}), { log: NullLogger });
    s.beginNextWave();
    const si = new Autopilot();
    const t0 = performance.now();
    let t = 0;
    for (; t < 72000; t++) {
      s.tick(si.at(s.state));
      if ((t & 1) === 1) s.clearEvents();
      const f = s.flags;
      if (f.waveClearReady) {
        const shop = s.openShop();
        shop.update(400);
        for (let k = 0; k < 20; k++) for (const p of [0, 1] as const) { const ids = ['plating','payload','overclock','thrusters'] as const; shop.apply({ kind: 'buyRow', player: p, id: ids[k % 4]! }); }
        shop.commit();
        s.applyShopResults();
        s.beginNextWave();
      }
      if (f.defeat) break;
    }
    const w = s.state;
    console.log(mode, 'ticks', t, 'ms', (performance.now() - t0).toFixed(0), 'wave', w.run.wave, 'phase', w.run.phase, 'cleared', w.run.wavesCleared, 'wallets', w.run.wallets, 'kills', w.players[0].kills, w.players[1].kills, 'hash', stateHash(w));
  }
});

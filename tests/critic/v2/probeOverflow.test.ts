import { appendFileSync } from 'node:fs';
const OUT = '/tmp/claude-0/-home-user/3a904291-51d4-5248-a38d-676463e52843/scratchpad/v2/bugs/probe.log';
const out = (...a: unknown[]): void => appendFileSync(OUT, a.join(' ') + '\n');
import { it } from 'vitest';
import { Autopilot } from '../../sim/autopilot';
import { newSession, autoShop } from '../../sim/runDriver';

it('probe overflow', () => {
  for (const start of [4, 9, 14, 19, 24]) {
    const s = newSession('coop', 7);
    const ap = new Autopilot();
    s.state.run.wave = start;
    s.beginNextWave();
    const w = s.state;
    let waveTicks = 0;
    const log: string[] = [];
    for (let t = 0; t < 120 * 60 * 6; t++) {
      for (const p of w.players) if (p.life === 'alive') p.invulnUntil = w.time + 1;
      s.tick(ap.at(w));
      if ((t & 1) === 1) s.clearEvents();
      waveTicks++;
      if (s.flags.waveClearReady) {
        log.push(`w${w.run.wave} ${(waveTicks / 120).toFixed(1)}s phaseEnd enemies=${w.enemies.count}`);
        const shop = s.openShop();
        autoShop(shop, [true, true]);
        shop.commit();
        s.applyShopResults();
        s.beginNextWave();
        waveTicks = 0;
        if (log.length >= 3) break;
      }
      if (waveTicks > 120 * 200) {
        const b = w.bosses.find((x) => x.alive);
        log.push(`STUCK w${w.run.wave} phase=${w.run.phase} enemies=${w.enemies.count} pending=${w.director.pending.count} budget=${w.director.budgetLeft} boss=${b ? `${b.id} ${b.hp.toFixed(0)}/${b.maxHp.toFixed(0)}` : 'none'}`);
        break;
      }
    }
    out(`start ${start + 1}:`, log.join(' | '));
    s.dispose();
  }
}, 300_000);

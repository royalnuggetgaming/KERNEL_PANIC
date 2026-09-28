import { appendFileSync } from 'node:fs';
import { it } from 'vitest';
import { Autopilot } from '../../sim/autopilot';
import { newSession } from '../../sim/runDriver';
const OUT = '/tmp/claude-0/-home-user/3a904291-51d4-5248-a38d-676463e52843/scratchpad/v2/bugs/probe.log';
const out = (...a: unknown[]): void => appendFileSync(OUT, a.join(' ') + '\n');

it('probe fork', () => {
  const s = newSession('coop', 7);
  const ap = new Autopilot();
  s.state.run.wave = 19;
  s.beginNextWave();
  const w = s.state;
  const kinds: Record<string, number> = {};
  for (let t = 0; t < 120 * 240; t++) {
    for (const p of w.players) if (p.life === 'alive') p.invulnUntil = w.time + 1;
    s.tick(ap.at(w));
    if ((t & 1) === 1) s.clearEvents();
    if (t % (120 * 20) === 0) {
      for (const k in kinds) delete kinds[k];
      for (let i = 0; i < w.enemies.count; i++) { const e = w.enemies.active[i]!; kinds[e.kind] = (kinds[e.kind] ?? 0) + 1; }
      out(`t=${(t / 120).toFixed(0)} phase=${w.run.phase} timer=${w.run.waveTimer.toFixed(0)} en=${w.enemies.count} ${JSON.stringify(kinds)} bosses=` +
        w.bosses.map((b) => `${b.part}:${b.alive ? 'A' : '-'} ${b.hp.toFixed(0)}/${b.maxHp.toFixed(0)} @${b.x.toFixed(1)},${b.z.toFixed(1)} gen${b.splitGen} dt${b.deathTime.toFixed(0)}`).join(' ; ') +
        ` p0=${w.players[0].x.toFixed(1)},${w.players[0].z.toFixed(1)} dmg=${w.players[0].damageDealt.toFixed(0)}`);
    }
    if (s.flags.waveClearReady) { out('cleared at', t / 120); break; }
  }
}, 300_000);

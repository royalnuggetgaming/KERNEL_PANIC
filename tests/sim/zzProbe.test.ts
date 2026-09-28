import { it } from 'vitest';
import { appendFileSync } from 'node:fs';
const log = (...a: unknown[]) => appendFileSync(process.env.PROBE_OUT ?? '/dev/null', a.join(' ') + '\n');
import type { PlayerIndex, RunMode } from '../../src/contracts/ids';
import { createRng } from '../../src/core/rng';
import { Autopilot } from './autopilot';
import { candidates, pick } from './economyModel';
import { newSession } from './runDriver';

function probe(mode: RunMode, seed: number, extra: Record<string, unknown>) {
  const s = newSession(mode, seed, extra);
  const ap = new Autopilot();
  const buyer = createRng(seed).fork('buyer');
  const n = mode === 'solo' ? 1 : 2;
  const dmg: number[] = [];
  let cur = 0;
  const prev = [s.state.players[0].hp, s.state.players[1].hp];
  s.beginNextWave();
  let t = 0;
  for (; t < 1_500_000; t++) {
    s.tick(ap.at(s.state));
    const w = s.state;
    for (let i = 0; i < n; i++) {
      const h = w.players[i as PlayerIndex].hp;
      if (h < prev[i]!) cur += prev[i]! - h;
      prev[i] = h;
    }
    s.clearEvents();
    if (s.flags.defeat) break;
    if (!s.flags.waveClearReady) continue;
    dmg.push(Math.round(cur));
    cur = 0;
    const shop = s.openShop();
    shop.update(400);
    for (let i = 0; i < n; i++) {
      const p: PlayerIndex = i === 0 ? 0 : 1;
      const wantTeam = buyer.chance(0.3);
      for (let guard = 0; guard < 64; guard++) {
        const list = candidates(shop.snapshot().players[p], p, mode === 'coop', wantTeam);
        if (list.length === 0 || !shop.apply(pick(list, 'greedy', buyer).tx).ok) break;
      }
    }
    if (shop.finalVisit) shop.apply({ kind: 'choose', player: 0, choice: 'pushDeeper' });
    shop.commit();
    s.applyShopResults();
    s.beginNextWave();
    for (let i = 0; i < n; i++) prev[i] = s.state.players[i as PlayerIndex].hp;
  }
  dmg.push(Math.round(cur));
  log('  kinds', JSON.stringify((globalThis as unknown as Record<string, unknown>).__DMG));
  (globalThis as unknown as Record<string, unknown>).__DMG = {};
  return { wave: s.state.run.wave, dmg, maxHp: s.state.players[0].maxHp };
}

it('probe', () => {
  (globalThis as unknown as Record<string, unknown>).__DMG = {};
  const diffs = (process.env.PROBE_DIFF ?? 'normal').split(',');
  for (const d of diffs) {
    for (const mode of (process.env.PROBE_MODES ?? 'solo,coop').split(',') as RunMode[]) {
      const waves: number[] = [];
      const per: number[] = [];
      const cnt: number[] = [];
      for (let seed = 1; seed <= Number(process.env.PROBE_SEEDS ?? 20); seed++) {
        const r = probe(mode, seed, d === 'none' ? {} : { difficulty: d });
        waves.push(r.wave);
        r.dmg.forEach((v, k) => { per[k] = (per[k] ?? 0) + v; cnt[k] = (cnt[k] ?? 0) + 1; });
        log(d, mode, seed, 'wave', r.wave, 'dmg/wave', r.dmg.join(' '));
      }
      log('PERWAVE', d, mode, per.map((v, k) => (v / cnt[k]!).toFixed(0) + '/' + cnt[k]).join(' '));
      log('SUMMARY', d, mode, waves.join(','), 'avg', (waves.reduce((a, b) => a + b, 0) / waves.length).toFixed(1));
    }
  }
}, 600_000);

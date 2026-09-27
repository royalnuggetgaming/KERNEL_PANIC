/**
 * CPU budget (plan section 10): the stress load of 180 enemies and ~2,000 projectiles (1,500 player shots +
 * 500 enemy shots, topped up every step) with both players and the link beam. The plan's sim budget is
 * <= 0.8 ms per 120 Hz step on the target Mac; this container has no guarantee of that speed, so the
 * assertion is loose (mean < 4 ms; measured here ~0.45 ms mean, ~0.7 ms p95). Also an allocation sanity
 * check: heap growth per step over a window without garbage collection. This coarse bound catches per-entity
 * object allocation (hundreds of KB/step); the zero-allocation gate for the same load, including HeapNumber
 * boxing across non-inlined calls, is tests/sim/simAllocation.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { ENEMY_KINDS, NO_HANDLE } from '../../src/contracts/ids';
import { PROJECTILE_KINDS, type ProjectileSpec } from '../../src/contracts/sim';
import { SOURCE_WORLD } from '../../src/contracts/simEvents';
import type { WorldState } from '../../src/contracts/world';
import { createRng } from '../../src/core/rng';
import { SIM } from '../../src/config/tuning';
import { spawnEnemy } from '../../src/entities/enemies';
import { spawnProjectile } from '../../src/entities/projectiles';
import { createWorld } from '../../src/sim/createWorld';
import { clearSimEvents } from '../../src/sim/simEventChannels';
import { beginWave } from '../../src/sim/rules';
import { stepWorld } from '../../src/sim/stepWorld';
import { testWorldConfig } from '../helpers/worldFixture';
import { Autopilot } from './autopilot';

const ENEMIES = 180;
const PLAYER_SHOTS = 1_500;
const ENEMY_SHOTS = 500;
const rng = createRng(9).fork('perf');
const SPEC: ProjectileSpec = {
  side: 'player',
  owner: 0,
  kind: PROJECTILE_KINDS.bolt,
  x: 0,
  z: 0,
  vx: 0,
  vz: 0,
  damage: 1,
  radius: 0.25,
  life: 1.2,
  pierce: 0,
  bounces: 0,
  crit: false,
  homing: NO_HANDLE,
};

function topUp(w: WorldState): void {
  let k = 0;
  while (w.enemies.count < ENEMIES) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(8, 28);
    const e = spawnEnemy(
      w,
      ENEMY_KINDS[k++ % ENEMY_KINDS.length]!,
      Math.sin(a) * r,
      Math.cos(a) * r,
      false,
      0,
    );
    if (e === null) break;
    e.hp = e.maxHp = 1e7;
  }
  while (w.playerShots.count < PLAYER_SHOTS || w.enemyShots.count < ENEMY_SHOTS) {
    const player = w.playerShots.count < PLAYER_SHOTS;
    const a = rng.range(0, Math.PI * 2);
    SPEC.side = player ? 'player' : 'enemy';
    SPEC.owner = player ? (w.playerShots.count & 1 ? 1 : 0) : SOURCE_WORLD;
    SPEC.kind = player ? PROJECTILE_KINDS.bolt : PROJECTILE_KINDS.enemyOrb;
    SPEC.x = rng.range(-28, 28);
    SPEC.z = rng.range(-28, 28);
    SPEC.vx = Math.sin(a) * (player ? 40 : 10);
    SPEC.vz = Math.cos(a) * (player ? 40 : 10);
    if (spawnProjectile(w, SPEC) === null) break;
  }
}

function stressWorld(): { w: WorldState; ap: Autopilot } {
  const w = createWorld(testWorldConfig({ seed: 5, mode: 'coop', vehicles: ['lancer', 'tinker'] }));
  beginWave(w, 12);
  const ap = new Autopilot();
  while (w.run.phase === 'countdown') stepWorld(w, ap.at(w), SIM.DT);
  w.director.budgetLeft = 0;
  return { w, ap };
}

function stress(w: WorldState, ap: Autopilot, steps: number, times: Float64Array | null): void {
  for (let i = 0; i < steps; i++) {
    topUp(w);
    for (const p of w.players) p.invulnUntil = w.time + 1;
    const intents = ap.at(w);
    const t0 = performance.now();
    stepWorld(w, intents, SIM.DT);
    if (times !== null) times[i] = performance.now() - t0;
    if ((i & 1) === 1) clearSimEvents(w.events);
  }
}

interface MemoryUsageLike {
  memoryUsage(): { readonly heapUsed: number };
}

function nodeProcess(): MemoryUsageLike | null {
  const p: unknown = Reflect.get(globalThis, 'process');
  return typeof p === 'object' && p !== null && typeof Reflect.get(p, 'memoryUsage') === 'function'
    ? (p as MemoryUsageLike)
    : null;
}

describe('sim CPU budget', () => {
  it('180 enemies + ~2,000 projectiles: mean step < 4 ms in this container', () => {
    const { w, ap } = stressWorld();
    stress(w, ap, 300, null);
    const n = 1_200;
    const times = new Float64Array(n);
    stress(w, ap, n, times);
    expect(w.enemies.count).toBeGreaterThanOrEqual(ENEMIES - 10);
    expect(w.playerShots.count + w.enemyShots.count).toBeGreaterThan(1_500);
    let sum = 0;
    for (let i = 0; i < n; i++) sum += times[i]!;
    const sorted = Array.from(times).sort((a, b) => a - b);
    const mean = sum / n;
    const p95 = sorted[Math.floor(n * 0.95)]!;
    expect(Number.isFinite(mean)).toBe(true);
    expect(mean).toBeLessThan(4);
    expect(p95).toBeLessThan(12);
  }, 60_000);

  it('steady-state stepping allocates (almost) nothing', async () => {
    const proc = nodeProcess();
    if (proc === null) return;
    const gcTimes: number[] = [];
    const obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) gcTimes.push(e.startTime);
    });
    let observing = true;
    try {
      obs.observe({ entryTypes: ['gc'] });
    } catch {
      observing = false;
    }
    const { w, ap } = stressWorld();
    stress(w, ap, 600, null);
    const steps = 600;
    let best = Infinity;
    for (let attempt = 0; attempt < 8 && best === Infinity; attempt++) {
      const t0 = performance.now();
      const h0 = proc.memoryUsage().heapUsed;
      stress(w, ap, steps, null);
      const h1 = proc.memoryUsage().heapUsed;
      const t1 = performance.now();
      await new Promise((r) => setTimeout(r, 0));
      const gcInWindow = gcTimes.some((t) => t >= t0 && t <= t1);
      if ((!observing || !gcInWindow) && h1 >= h0) best = (h1 - h0) / steps;
    }
    obs.disconnect();
    // Without a GC-free window we cannot measure; the budget test above still covers the load.
    if (best === Infinity) return;
    expect(best).toBeLessThan(32 * 1024);
  }, 60_000);
});

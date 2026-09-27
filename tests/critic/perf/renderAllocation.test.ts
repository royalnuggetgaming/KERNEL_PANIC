/**
 * PERF critic (plan section 10: view sync is a hot path, "zero steady-state GC"; the view/fx files document
 * themselves as allocation-free). Real AssetLibrary batches and rings (three runs in node), real WorldViews/
 * FxDirector/TrailRenderer, a sim world at the stress load. The sim is advanced first; each measured frame then
 * only moves the players (so trails keep changing) and re-runs the render-side work, so the numbers are render
 * allocations only. Expected to FAIL on the current code:
 * - TrailRibbon.write: `(visible ? this.px[k]! : x) + ox` merges a Float32Array load with the tagged parameter
 *   `x`; TurboFan boxes the phi, 2 HeapNumbers per vertex: ~4.2 KB per call, ~8.4 KB per frame (2 players).
 * - EnemyView.sync -> InstanceBatch.push(x, z, yaw, ...) and FxDirector.consume -> ParticleSystem.burst/emit/
 *   rng.range box the computed doubles they pass across non-inlined calls (1-7 KB per frame at stress).
 */
import { describe, expect, it } from 'vitest';
import { createAssetLibrary } from '../../../src/assets/AssetLibrary';
import { buildTrailGeometry } from '../../../src/assets/geometry/fxShapes';
import { QUALITY_PRESETS } from '../../../src/config/quality';
import { NullLogger } from '../../../src/core/logger';
import { CameraRig } from '../../../src/render/CameraRig';
import { TrailRibbon } from '../../../src/render/fx/TrailRenderer';
import type { FrameContext } from '../../../src/render/views/types';
import { WorldViews } from '../../../src/render/WorldViews';
import { clearSimEvents } from '../../../src/sim/simEventChannels';
import { KERNEL_PANIC } from '../../../src/themes/kernelPanic';
import { measureAllocation } from '../../support/allocProbe';
import { createStressRig } from '../../support/stressWorld';

const FRAME_BUDGET_BYTES = 256;

async function renderRig(): Promise<{
  rig: ReturnType<typeof createStressRig>;
  views: WorldViews;
  camera: CameraRig;
  ctx: FrameContext;
  movePlayers(i: number): void;
}> {
  const lib = createAssetLibrary({
    theme: KERNEL_PANIC,
    quality: QUALITY_PRESETS.high,
    log: NullLogger,
    seed: 11,
  });
  await lib.build(() => undefined);
  const camera = new CameraRig();
  camera.setViewport(1512, 982);
  camera.setMode('follow');
  const views = new WorldViews(lib, lib.createBatches(), camera, 0x6a09e667);
  views.particles.setCap(QUALITY_PRESETS.high.particleCap);
  const rig = createStressRig(false);
  for (let i = 0; i < 240; i++) {
    rig.step();
    clearSimEvents(rig.w.events);
  }
  const w = rig.w;
  const ctx: FrameContext = { world: w, alpha: 0.5, frameDt: 1 / 120, time: 10, simTime: w.time };
  const movePlayers = (i: number): void => {
    for (let k = 0; k < 2; k++) {
      const p = w.players[k === 0 ? 0 : 1];
      const a = i * 0.02 + k * Math.PI;
      p.prevX = p.x;
      p.prevZ = p.z;
      p.x = Math.sin(a) * 12;
      p.z = Math.cos(a) * 12;
    }
    ctx.time = 10 + i / 120;
  };
  return { rig, views, camera, ctx, movePlayers };
}

describe('PERF critic: render-side per-frame allocation', () => {
  it('TrailRibbon.write (every frame, per player) allocates nothing', async () => {
    const g = buildTrailGeometry(0);
    const pos = g.getAttribute('position').array as Float32Array;
    const uv = g.getAttribute('uv').array as Float32Array;
    const ribbon = new TrailRibbon(uv, pos.length / 3);
    const xz = new Float64Array(2);
    const report = await measureAllocation(
      (i) => {
        xz[0] = Math.sin(i * 0.01) * 10;
        xz[1] = Math.cos(i * 0.013) * 10;
        ribbon.advance(xz[0], xz[1], 1 / 120);
        ribbon.write(pos, xz[0], xz[1], true);
      },
      2_000,
      20_000,
    );
    if (report === null) return;
    expect(
      report.bytesPerIter,
      `TrailRibbon advance+write allocates ${Math.round(report.bytesPerIter)} B/call; top:\n${report.top.join('\n')}`,
    ).toBeLessThan(64);
  }, 60_000);

  it('WorldViews.sync at the stress load allocates ~nothing per frame', async () => {
    const r = await renderRig();
    const report = await measureAllocation(
      (i) => {
        r.movePlayers(i);
        r.views.sync(r.ctx, r.camera.distance, false);
      },
      1_000,
      3_000,
    );
    if (report === null) return;
    expect(r.rig.w.enemies.count).toBeGreaterThanOrEqual(170);
    expect(
      report.bytesPerIter,
      `WorldViews.sync allocates ${Math.round(report.bytesPerIter)} B/frame; top:\n${report.top.join('\n')}`,
    ).toBeLessThan(FRAME_BUDGET_BYTES);
  }, 60_000);

  it("FxDirector.consume of one stress step's events allocates ~nothing", async () => {
    const r = await renderRig();
    // One step's events at the stress load (dozens of hits, shots and some kills), consumed every frame.
    r.rig.step();
    const e = r.rig.w.events;
    expect(e.hit.count).toBeGreaterThan(10);
    const report = await measureAllocation(
      (i) => {
        r.views.fx.consume(e, 10 + i / 120);
        r.views.particles.commit();
      },
      1_000,
      3_000,
    );
    if (report === null) return;
    expect(
      report.bytesPerIter,
      `FxDirector.consume allocates ${Math.round(report.bytesPerIter)} B/frame for ${e.hit.count} hits; top:\n${report.top.join('\n')}`,
    ).toBeLessThan(FRAME_BUDGET_BYTES);
  }, 60_000);
});

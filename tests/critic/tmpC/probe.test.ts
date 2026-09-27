import { it } from 'vitest';
import { createAssetLibrary } from '../../../src/assets/AssetLibrary';
import { QUALITY_PRESETS } from '../../../src/config/quality';
import { NullLogger } from '../../../src/core/logger';
import { CameraRig } from '../../../src/render/CameraRig';
import type { FrameContext } from '../../../src/render/views/types';
import { WorldViews } from '../../../src/render/WorldViews';
import { clearSimEvents } from '../../../src/sim/simEventChannels';
import { KERNEL_PANIC } from '../../../src/themes/kernelPanic';
import { measureAllocation } from '../../support/allocProbe';
import { createStressRig } from '../../support/stressWorld';

it('probe', async () => {
  const lib = createAssetLibrary({ theme: KERNEL_PANIC, quality: QUALITY_PRESETS.high, log: NullLogger, seed: 11 });
  await lib.build(() => undefined);
  const camera = new CameraRig();
  const views = new WorldViews(lib, lib.createBatches(), camera, 0x6a09e667);
  const rig = createStressRig(false);
  for (let i = 0; i < 240; i++) { rig.step(); clearSimEvents(rig.w.events); }
  const w = rig.w;
  const ctx: FrameContext = { world: w, alpha: 0.5, frameDt: 1 / 120, time: 10, simTime: w.time };
  const mode = process.env.PROBE ?? 'enemies';
  const r = await measureAllocation((i) => {
    ctx.time = 10 + i / 120;
    if (mode === 'enemies') views.enemies.sync(ctx);
    else if (mode === 'pickups') views.pickups.sync(ctx);
    else if (mode === 'nothing') views.pickups.clear();
  }, 1000, 3000);
  (await import('node:fs')).appendFileSync('/tmp/claude-0/-home-user/3a904291-51d4-5248-a38d-676463e52843/scratchpad/probe.txt', [mode, 'pickups', w.pickups.count, 'enemies', w.enemies.count, r?.bytesPerIter, r?.top.join('\n')].join(' ') + '\n');
}, 60000);

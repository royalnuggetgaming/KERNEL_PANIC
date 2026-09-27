/**
 * GPU residency after Boot (plan section 10 TARGETS "Zero new programs, geometries or textures after Boot"; 10.6
 * warm-up; 10.7 "Assets and batches are allocated once at Boot ... cycleRuns(3) ... renderer.info.memory equals
 * the Boot baseline"). Regression for PERF-4 (round-1 perf critic).
 *
 * three uploads a geometry (createBuffer + bufferData of the whole array + a VAO; info.memory.geometries++) the
 * first time a VISIBLE mesh using it is projected. Before the fix the live InstanceBatches/GpuRingBuffers under
 * views.root were invisible during warm-up, so each was first uploaded mid-run (Chromium: geometries 32 at Boot
 * -> 41 after cycleRuns(2)). RenderBridge.warmLive now primes every batch and ring (WorldViews.primeForWarmup).
 *
 * Drives the real RenderBridge with a structural fake WebGLRenderer whose render() records the geometry of every
 * visible mesh (what three would upload) and expects no geometry to be seen for the first time after warmup().
 */
import { describe, expect, it, vi } from 'vitest';

interface Obj {
  visible: boolean;
  isMesh?: boolean;
  geometry?: { uuid: string; name?: string; type?: string };
  name?: string;
  children: Obj[];
}

const fakeGl = vi.hoisted(() => {
  const seen = new Map<string, string>();
  let phase = 'boot';
  return {
    seen,
    setPhase(p: string): void {
      phase = p;
    },
    record(o: Obj): void {
      if (!o.visible) return;
      if (o.isMesh === true && o.geometry !== undefined && !seen.has(o.geometry.uuid)) {
        seen.set(o.geometry.uuid, `${phase}: ${o.name ?? '?'} (${o.geometry.type ?? 'geometry'})`);
      }
      for (const c of o.children) fakeGl.record(c);
    },
  };
});

vi.mock('three', async (importOriginal) => {
  const three = await importOriginal<Record<string, unknown>>();
  class FakeWebGLRenderer {
    toneMapping = 0;
    outputColorSpace = '';
    autoClear = true;
    readonly debug = { checkShaderErrors: false };
    readonly capabilities = { isWebGL2: true };
    readonly extensions = { has: (): boolean => true };
    readonly info = {
      autoReset: true,
      programs: [] as unknown[],
      render: { calls: 0, triangles: 0 },
      memory: { geometries: 0, textures: 0 },
      reset: (): void => undefined,
    };
    readonly domElement = {
      style: {},
      parentElement: null,
      addEventListener: (): void => undefined,
      removeEventListener: (): void => undefined,
    };
    setClearColor(): void {}
    setPixelRatio(): void {}
    setSize(): void {}
    setRenderTarget(): void {}
    clear(): void {}
    initTexture(): void {}
    compileAsync(): Promise<void> {
      return Promise.resolve();
    }
    render(scene: Obj): void {
      fakeGl.record(scene);
      this.info.memory.geometries = fakeGl.seen.size;
    }
    dispose(): void {}
  }
  return { ...three, WebGLRenderer: FakeWebGLRenderer };
});

const { createAssetLibrary } = await import('../../src/assets/AssetLibrary');
const { QUALITY_PRESETS } = await import('../../src/config/quality');
const { NullLogger } = await import('../../src/core/logger');
const { createRenderBridge } = await import('../../src/render/RenderBridge');
const { DEFAULT_SETTINGS } = await import('../../src/save/defaults');
const { clearSimEvents } = await import('../../src/sim/simEventChannels');
const { KERNEL_PANIC } = await import('../../src/themes/kernelPanic');
const { createStressRig } = await import('../support/stressWorld');

describe('RenderBridge: GPU residency after Boot', () => {
  it('no geometry is uploaded for the first time after warm-up (Playing at the stress load)', async () => {
    const lib = createAssetLibrary({
      theme: KERNEL_PANIC,
      quality: QUALITY_PRESETS.high,
      log: NullLogger,
      seed: 11,
    });
    await lib.build(() => undefined);
    const host = {
      appendChild: (): void => undefined,
      removeChild: (): void => undefined,
      getBoundingClientRect: () => ({ width: 1280, height: 720 }),
    };
    const bridge = createRenderBridge({
      canvasHost: host as unknown as HTMLElement,
      assets: lib,
      theme: KERNEL_PANIC,
      settings: DEFAULT_SETTINGS,
      log: NullLogger,
    });
    fakeGl.setPhase('warmup');
    await bridge.warmup();
    // Boot -> MainMenu backdrop frames.
    fakeGl.setPhase('menu');
    bridge.setCameraMode('attract');
    for (let i = 0; i < 3; i++) bridge.frame(0.5, 1 / 60);
    const bootBaseline = fakeGl.seen.size;

    // Playing at the stress load: 180 enemies of every kind, shots, pickups, particles, digits, shockwaves.
    fakeGl.setPhase('playing');
    const rig = createStressRig(false);
    bridge.attachWorld(rig.w, () => undefined);
    bridge.setCameraMode('follow');
    for (let i = 0; i < 120; i++) {
      rig.step();
      bridge.consumeEvents(rig.w.events);
      clearSimEvents(rig.w.events);
      bridge.frame(0.5, 1 / 120);
    }
    const late = [...fakeGl.seen.values()].filter((v) => v.startsWith('playing'));
    expect(
      late,
      `${late.length} geometries first drawn (uploaded) after Boot (baseline ${bootBaseline}):\n${late.join('\n')}`,
    ).toEqual([]);
    bridge.dispose();
  }, 60_000);
});

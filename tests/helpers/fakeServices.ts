/** Builds a complete Services object from the fakes, with every fake exposed for assertions. */
import type { Services } from '../../src/contracts/services';
import { createMemoryLogger, type MemoryLogger } from '../../src/core/logger';
import { KERNEL_PANIC } from '../../src/themes/kernelPanic';
import { FakeClock } from './fakeClock';
import {
  FakeAssets,
  FakeInputPort,
  FakeLoop,
  FakePerf,
  FakeRenderPort,
  FakeUiPort,
  NullAudio,
} from './fakePorts';
import { createFakeRunFactory, type FakeRunSession } from './fakeRun';
import { FakeSaveStore } from './fakeSave';
import { FakeFsm } from './fakeStates';

export interface FakeServiceSet {
  readonly services: Services;
  /** services.reloadApp() calls. */
  readonly reloads: { count: number };
  readonly fsm: FakeFsm;
  readonly input: FakeInputPort;
  readonly audio: NullAudio;
  readonly render: FakeRenderPort;
  readonly ui: FakeUiPort;
  readonly save: FakeSaveStore;
  readonly assets: FakeAssets;
  readonly loop: FakeLoop;
  readonly perf: FakePerf;
  readonly clock: FakeClock;
  readonly log: MemoryLogger;
  readonly sessions: FakeRunSession[];
}

export function createFakeServices(
  o: { save?: FakeSaveStore; fsm?: FakeFsm; seed?: number } = {},
): FakeServiceSet {
  const fsm = o.fsm ?? new FakeFsm();
  const input = new FakeInputPort();
  const audio = new NullAudio();
  const render = new FakeRenderPort();
  const ui = new FakeUiPort();
  const save = o.save ?? new FakeSaveStore();
  const assets = new FakeAssets();
  const loop = new FakeLoop();
  const perf = new FakePerf();
  const clock = new FakeClock();
  const log = createMemoryLogger();
  const runs = createFakeRunFactory();
  let seed = o.seed ?? 1000;
  let runCounter = 0;
  const reloads = { count: 0 };
  const services: Services = {
    fsm,
    input,
    audio,
    render,
    ui,
    save,
    assets,
    session: { current: null, lastPicks: null, lastMode: null },
    createRun: runs.createRun,
    loop,
    perf,
    theme: () => KERNEL_PANIC,
    clock,
    log,
    env: { debug: false, seedOverride: null, strict: true, version: 'test' },
    newSeed: () => seed++,
    newRunId: () => `run-${String(++runCounter)}`,
    reloadApp: () => {
      reloads.count++;
    },
  };
  return {
    services,
    reloads,
    fsm,
    input,
    audio,
    render,
    ui,
    save,
    assets,
    loop,
    perf,
    clock,
    log,
    sessions: runs.sessions,
  };
}

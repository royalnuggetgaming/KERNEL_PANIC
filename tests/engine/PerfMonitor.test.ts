import { describe, expect, it } from 'vitest';
import { PERF } from '../../src/config/quality';
import { createMemoryLogger } from '../../src/core/logger';
import type { FrameSample } from '../../src/engine/GameLoop';
import { createPerfMonitor } from '../../src/engine/PerfMonitor';

function sample(frameMs: number, cpuMs = 1, simMs = 0.5, dropped = 0): FrameSample {
  return { frameMs, simMs, cpuMs, steps: 1, dropped };
}

describe('PerfMonitor', () => {
  it('computes interpolated percentiles per series', () => {
    const m = createPerfMonitor({ log: createMemoryLogger() });
    expect(m.percentile('frame', 50)).toBe(0);
    for (let i = 100; i >= 1; i--) m.record(sample(i, i / 10, i / 100));
    expect(m.percentile('frame', 0)).toBe(1);
    expect(m.percentile('frame', 100)).toBe(100);
    expect(m.percentile('frame', 50)).toBeCloseTo(50.5, 9);
    expect(m.percentile('frame', 95)).toBeCloseTo(95.05, 9);
    expect(m.percentile('cpu', 100)).toBeCloseTo(10, 9);
    expect(m.percentile('sim', -5)).toBeCloseTo(0.01, 9);
    expect(m.percentile('sim', 200)).toBeCloseTo(1, 9);
  });

  it('keeps only the last RING_FRAMES frames and counts all frames', () => {
    const m = createPerfMonitor({ log: createMemoryLogger() });
    for (let i = 0; i < PERF.RING_FRAMES; i++) m.record(sample(50));
    for (let i = 0; i < PERF.RING_FRAMES; i++) m.record(sample(10));
    expect(m.frames).toBe(PERF.RING_FRAMES * 2);
    expect(m.percentile('frame', 100)).toBe(10);
    expect(m.snapshot().avgFps).toBeCloseTo(100, 9);
  });

  it('leaves zero-interval frames out of the series but counts their dropped steps', () => {
    const m = createPerfMonitor({ log: createMemoryLogger() });
    m.record(sample(0, 1, 1, 3));
    expect(m.frames).toBe(1);
    expect(m.snapshot().avgFps).toBe(0);
    expect(m.snapshot().droppedSteps).toBe(3);
  });

  it('snapshots fps, percentiles, long frames, cpu p95 and dropped steps into a reused object', () => {
    const m = createPerfMonitor({ log: createMemoryLogger() });
    for (let i = 0; i < 98; i++) m.record(sample(1000 / 60, 2));
    m.record(sample(40, 3, 1, 4));
    m.record(sample(34, 3));
    const s = m.snapshot();
    expect(s.longFrames).toBe(2);
    expect(s.droppedSteps).toBe(4);
    expect(s.p50).toBeCloseTo(1000 / 60, 9);
    expect(s.p99).toBeGreaterThan(33);
    expect(s.cpuP95).toBe(2);
    expect(s.avgFps).toBeCloseTo((1000 * 100) / (98 * (1000 / 60) + 74), 6);
    expect(m.snapshot()).toBe(s);
  });

  it('reports the missed-vsync ratio for a refresh rate', () => {
    const m = createPerfMonitor({ log: createMemoryLogger() });
    expect(m.missedVsyncRatio(120)).toBe(0);
    for (let i = 0; i < 90; i++) m.record(sample(1000 / 120));
    for (let i = 0; i < 10; i++) m.record(sample(2000 / 120));
    expect(m.missedVsyncRatio(120)).toBeCloseTo(10 / 110, 9);
    expect(m.missedVsyncRatio(60)).toBe(0);
    expect(m.missedVsyncRatio(0)).toBe(0);
  });

  it('records the program baseline on first call and logs a DEV error once per growth', () => {
    const log = createMemoryLogger();
    const m = createPerfMonitor({ log });
    m.setProgramCount(20);
    m.setProgramCount(20);
    m.setProgramCount(18);
    expect(log.count('error')).toBe(0);
    m.setProgramCount(21);
    m.setProgramCount(21);
    expect(log.count('error')).toBe(1);
    m.setProgramCount(22);
    expect(log.count('error')).toBe(2);
  });

  it('remembers the playing flag', () => {
    const m = createPerfMonitor({ log: createMemoryLogger() });
    expect(m.playing).toBe(false);
    m.setPlaying(true);
    expect(m.playing).toBe(true);
  });
});

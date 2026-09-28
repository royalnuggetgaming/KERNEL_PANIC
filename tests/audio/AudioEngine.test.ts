import { describe, expect, it } from 'vitest';
import { SFX_IDS } from '../../src/contracts/audio';
import { createMemoryLogger } from '../../src/core/logger';
import { createSimEvents } from '../../src/sim/simEventChannels';
import { KERNEL_PANIC } from '../../src/themes/kernelPanic';
import {
  SCHEDULER_INTERVAL_MS,
  STEAL_FADE_S,
  type TimerPort,
  createAudioEngine,
} from '../../src/audio/AudioEngine';
import { BEAT_PHASE_IDLE } from '../../src/audio/Sequencer';
import { DUCK_CUTOFF_HZ, LIMITER_RATIO, LIMITER_THRESHOLD_DB, LOUNGE_CUTOFF_HZ } from '../../src/audio/Mixer';
import { CATEGORY_LIMITS, VOICE_COUNT } from '../../src/audio/VoicePool';
import { FakeContext, FakeOfflineContext } from './fakeWebAudio';

class FakeTimers implements TimerPort {
  readonly cbs = new Map<number, () => void>();
  private next = 1;
  setInterval(cb: () => void, ms: number): number {
    expect(ms).toBe(SCHEDULER_INTERVAL_MS);
    const id = this.next++;
    this.cbs.set(id, cb);
    return id;
  }
  clearInterval(id: number): void {
    this.cbs.delete(id);
  }
  fire(): void {
    for (const cb of this.cbs.values()) cb();
  }
}

function setup(opts: { failCreate?: number } = {}) {
  const contexts: FakeContext[] = [];
  let failures = opts.failCreate ?? 0;
  const timers = new FakeTimers();
  const log = createMemoryLogger();
  const engine = createAudioEngine({
    theme: KERNEL_PANIC,
    seed: 42,
    log,
    timers,
    createContext: () => {
      if (failures > 0) {
        failures--;
        throw new Error('no audio');
      }
      const c = new FakeContext(48000);
      contexts.push(c);
      return c as unknown as AudioContext;
    },
    createOfflineContext: (ch, len, sr) =>
      new FakeOfflineContext(ch, len, sr) as unknown as OfflineAudioContext,
  });
  return { engine, contexts, timers, log };
}

describe('AudioEngine', () => {
  it('play() and consumeEvents() are no-ops before unlock', () => {
    const { engine, contexts } = setup();
    engine.play('laser');
    engine.consumeEvents(createSimEvents());
    expect(contexts).toHaveLength(0);
    expect(engine.unlocked).toBe(false);
    expect(engine.beatPhase).toBe(BEAT_PHASE_IDLE);
    expect(engine.stats()).toEqual({ voices: 0, stolen: 0, coalesced: 0, ctxState: 'none' });
  });

  it('unlock is idempotent: one context, running, limiter configured', async () => {
    const { engine, contexts, timers } = setup();
    const a = engine.unlock();
    const b = engine.unlock();
    expect(b).toBe(a);
    await a;
    await engine.unlock();
    expect(contexts).toHaveLength(1);
    const ctx = contexts[0]!;
    expect(ctx.state).toBe('running');
    expect(engine.unlocked).toBe(true);
    expect(engine.stats().ctxState).toBe('running');
    const lim = ctx.nodes.find((n) => n.kind === 'compressor')!;
    expect(lim.threshold.value).toBe(LIMITER_THRESHOLD_DB);
    expect(lim.ratio.value).toBe(LIMITER_RATIO);
    expect(lim.outputs[0]).toBe(ctx.destination);
    expect(ctx.count('panner')).toBe(VOICE_COUNT);
    expect(ctx.count('convolver')).toBe(1);
    expect(timers.cbs.size).toBe(1);
    expect(ctx.unreachable()).toHaveLength(0);
  });

  it('survives an interrupted (Safari) context: a later unlock resumes it', async () => {
    const { engine, contexts } = setup();
    await engine.unlock();
    const ctx = contexts[0]!;
    ctx.state = 'interrupted';
    const before = ctx.resumeCalls;
    await engine.unlock();
    expect(ctx.resumeCalls).toBe(before + 1);
    expect(ctx.state).toBe('running');
  });

  it('retries unlock after a failed context creation', async () => {
    const { engine, contexts, log } = setup({ failCreate: 1 });
    await engine.unlock();
    expect(engine.unlocked).toBe(false);
    expect(log.count('error')).toBe(1);
    await engine.unlock();
    expect(engine.unlocked).toBe(true);
    expect(contexts).toHaveLength(1);
  });

  it('each play creates exactly one buffer source; voices never exceed 32 under stress', async () => {
    const { engine, contexts } = setup();
    await engine.unlock();
    const ctx = contexts[0]!;
    const base = ctx.count('bufferSource');
    engine.play('laser', 0.5, 1, 0);
    expect(ctx.count('bufferSource')).toBe(base + 1);
    // Same id within 25 ms is coalesced.
    engine.play('laser');
    expect(ctx.count('bufferSource')).toBe(base + 1);
    expect(engine.stats().coalesced).toBe(1);
    for (let f = 0; f < 600; f++) {
      ctx.currentTime += 1 / 120;
      for (let i = 0; i < SFX_IDS.length; i++) engine.play(SFX_IDS[i]!, (i % 3) - 1, 1, (i % 5) * 100);
      expect(engine.stats().voices).toBeLessThanOrEqual(VOICE_COUNT);
    }
    const s = engine.stats();
    expect(s.stolen).toBeGreaterThan(0);
    expect(s.coalesced).toBeGreaterThan(0);
    // No source is left without an eventual end: buffer sources end with their buffer; stolen ones are stopped.
    const stopped = ctx.nodes.filter((n) => n.kind === 'bufferSource' && n.stoppedAt !== null);
    expect(stopped.length).toBe(s.stolen);
  });

  it('a stolen voice fades over 10 ms before the new sound starts', async () => {
    const { engine, contexts } = setup();
    await engine.unlock();
    const ctx = contexts[0]!;
    ctx.currentTime = 1;
    for (let i = 0; i < CATEGORY_LIMITS.explosion; i++) {
      ctx.currentTime += 0.03;
      engine.play('explodeBoss');
    }
    const first = ctx.nodes.filter((n) => n.kind === 'bufferSource').at(-CATEGORY_LIMITS.explosion)!;
    ctx.currentTime += 0.03;
    const now = ctx.currentTime;
    engine.play('explodeBoss');
    expect(first.stoppedAt).toBeCloseTo(now + STEAL_FADE_S, 9);
    const newest = ctx.nodes.filter((n) => n.kind === 'bufferSource').at(-1)!;
    expect(newest.startedAt).toBeCloseTo(now + STEAL_FADE_S, 9);
  });

  it('routes SimEvents through play()', async () => {
    const { engine, contexts } = setup();
    await engine.unlock();
    const ctx = contexts[0]!;
    const ev = createSimEvents();
    const s = ev.shot.push();
    s.owner = 0;
    s.vehicle = 'lancer';
    s.x = 0;
    s.z = 0;
    s.dirX = 0;
    s.dirZ = 1;
    const before = ctx.count('bufferSource');
    engine.consumeEvents(ev);
    expect(ctx.count('bufferSource')).toBe(before + 1);
  });

  it('music: the sequencer runs on the audio clock via the interval and beatPhase', async () => {
    const { engine, contexts, timers } = setup();
    engine.setMood('combat');
    engine.setIntensity(0.9);
    engine.setSector(2);
    await engine.unlock();
    const ctx = contexts[0]!;
    const oscBefore = ctx.count('oscillator');
    for (let i = 0; i < 80; i++) {
      ctx.currentTime += 0.025;
      timers.fire();
    }
    expect(ctx.count('oscillator')).toBeGreaterThan(oscBefore);
    const spb = 60 / KERNEL_PANIC.audio.bpm;
    const p1 = engine.beatPhase;
    ctx.currentTime += spb / 4;
    const p2 = engine.beatPhase;
    expect((p2 - p1 + 1) % 1).toBeCloseTo(0.25, 6);
    expect(p1).toBeGreaterThanOrEqual(0);
    expect(p1).toBeLessThan(1);
  });

  it('duck, lounge, volumes, suspend/resume and dispose', async () => {
    const { engine, contexts, timers } = setup();
    engine.setVolumes(0.5, 0.25, 1);
    engine.duck(true);
    await engine.unlock();
    const ctx = contexts[0]!;
    const filters = ctx.nodes.filter((n) => n.kind === 'biquad');
    expect(filters.some((f) => f.frequency.value === DUCK_CUTOFF_HZ)).toBe(true);
    engine.setMood('shop');
    expect(filters.some((f) => f.frequency.value === LOUNGE_CUTOFF_HZ)).toBe(true);
    engine.duck(false);
    expect(filters.some((f) => f.frequency.value === DUCK_CUTOFF_HZ)).toBe(false);
    engine.setVolumes(1, 1, 0);
    engine.setIntensity(Number.NaN);
    await engine.suspend();
    expect(ctx.state).toBe('suspended');
    engine.play('uiMove');
    await engine.resume();
    expect(ctx.state).toBe('running');
    engine.dispose();
    engine.dispose();
    expect(ctx.closeCalls).toBe(1);
    expect(timers.cbs.size).toBe(0);
    expect(engine.unlocked).toBe(false);
    await engine.resume();
    await engine.suspend();
    expect(ctx.state).toBe('closed');
  });
});

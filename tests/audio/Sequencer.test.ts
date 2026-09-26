import { describe, expect, it } from 'vitest';
import type { MusicMood } from '../../src/contracts/audio';
import { KERNEL_PANIC } from '../../src/themes/kernelPanic';
import { type Composer, type NoteEvent, createComposer } from '../../src/audio/Composer';
import { LATE_TOLERANCE_S, LOOKAHEAD_S, START_DELAY_S, createSequencer } from '../../src/audio/Sequencer';

interface Scheduled {
  readonly at: number;
  readonly when: number;
  readonly inst: string;
  readonly beat: number;
}

function setup(bpm = 120, composer: Composer = createComposer(KERNEL_PANIC, 1)) {
  const clock = { t: 10 };
  const log: Scheduled[] = [];
  const seq = createSequencer({
    now: () => clock.t,
    composer,
    bpm,
    schedule: (e: NoteEvent, when: number) => {
      log.push({ at: clock.t, when, inst: e.instrument, beat: e.startBeat });
    },
  });
  return { clock, log, seq };
}

/** Composer with one note per beat, for exact counting. */
const METRONOME: Composer = {
  bar(_i: number, mood: MusicMood, _x: number, out: NoteEvent[]): number {
    if (mood === 'silent') return 0;
    for (let b = 0; b < 4; b++)
      out[b] = { instrument: 'kick', midi: 36, startBeat: b, lengthBeats: 0.5, velocity: 1 };
    return 4;
  },
};

describe('Sequencer', () => {
  it('schedules only inside the lookahead window on the audio clock', () => {
    const { clock, log, seq } = setup(112);
    seq.setMood('combat');
    seq.setIntensity(1);
    seq.start();
    for (let i = 0; i < 2000; i++) {
      clock.t += 0.025;
      seq.tick();
    }
    expect(log.length).toBeGreaterThan(500);
    for (const s of log) {
      expect(s.when).toBeGreaterThanOrEqual(s.at);
      expect(s.when).toBeLessThan(s.at + LOOKAHEAD_S);
    }
  });

  it('schedules every note exactly once, in time order per bar', () => {
    const { clock, log, seq } = setup(120, METRONOME);
    seq.setMood('combat');
    seq.start();
    const t0 = clock.t + START_DELAY_S;
    for (let i = 0; i < 400; i++) {
      clock.t += 0.025;
      seq.tick();
    }
    // 10 s at 120 BPM = 20 beats, plus the lookahead.
    const whens = log.map((s) => s.when);
    for (let i = 0; i < whens.length; i++) expect(whens[i]).toBeCloseTo(t0 + i * 0.5, 9);
    expect(whens.length).toBe(Math.floor((clock.t + LOOKAHEAD_S - t0) / 0.5) + 1);
  });

  it('beatPhase is derived from the clock', () => {
    const { clock, seq } = setup(120, METRONOME);
    expect(seq.beatPhase).toBe(0);
    seq.setMood('combat');
    seq.start();
    const t0 = clock.t + START_DELAY_S;
    clock.t = t0 + 0.25;
    expect(seq.beatPhase).toBeCloseTo(0.5, 9);
    clock.t = t0 + 1.125;
    expect(seq.beatPhase).toBeCloseTo(0.25, 9);
    expect(seq.beatPosition).toBeCloseTo(2.25, 9);
    seq.stop();
    expect(seq.beatPhase).toBe(0);
    expect(seq.running).toBe(false);
  });

  it('does nothing while stopped and nothing for silent', () => {
    const { clock, log, seq } = setup(120, METRONOME);
    seq.tick();
    expect(log).toHaveLength(0);
    seq.start();
    for (let i = 0; i < 100; i++) {
      clock.t += 0.025;
      seq.tick();
    }
    expect(log).toHaveLength(0);
    expect(seq.mood).toBe('silent');
  });

  it('a mood change takes effect within the lookahead window', () => {
    const { clock, log, seq } = setup(120, METRONOME);
    seq.start();
    clock.t += 0.3;
    seq.tick();
    expect(log).toHaveLength(0);
    const changedAt = clock.t;
    seq.setMood('combat');
    clock.t += 0.1;
    seq.tick();
    expect(log.length).toBeGreaterThan(0);
    for (const s of log) {
      expect(s.when).toBeGreaterThanOrEqual(changedAt);
      expect(s.when).toBeLessThan(changedAt + 0.1 + LOOKAHEAD_S);
    }
    // Same mood again is a no-op (no recompose, no duplicates).
    const n = log.length;
    seq.setMood('combat');
    seq.tick();
    expect(log.length).toBe(n);
  });

  it('drops notes that are too late after a stall and resynchronises', () => {
    const { clock, log, seq } = setup(120, METRONOME);
    seq.setMood('combat');
    seq.start();
    clock.t += 0.1;
    seq.tick();
    const before = log.length;
    clock.t += 7.3; // long stall (background tab)
    seq.tick();
    const burst = log.slice(before);
    for (const s of burst) {
      expect(s.when).toBeGreaterThanOrEqual(clock.t);
      expect(s.when).toBeLessThan(clock.t + LOOKAHEAD_S);
    }
    expect(burst.length).toBeLessThanOrEqual(1 + Math.ceil((LOOKAHEAD_S + LATE_TOLERANCE_S) / 0.5));
    expect(seq.barIndex).toBeGreaterThan(2);
  });

  it('clamps intensity and survives a bad bpm', () => {
    const { seq } = setup(Number.NaN, METRONOME);
    seq.setIntensity(5);
    expect(seq.intensity).toBe(1);
    seq.setIntensity(Number.NaN);
    expect(seq.intensity).toBe(0);
    expect(seq.scheduledCount).toBe(0);
  });
});

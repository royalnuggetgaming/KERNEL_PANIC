/**
 * Lookahead music scheduler (plan section 10 item 10): driven by a ~25 ms interval plus a per-frame tick,
 * it asks the Composer for one bar at a time and hands every note whose start falls inside the
 * [now, now + LOOKAHEAD_S) window to `schedule` exactly once, on the audio clock. Pure: `now` is injected.
 */
import type { MusicMood } from '../contracts/audio';
import { clamp } from '../core/math';
import { BEATS_PER_BAR, type Composer, MAX_BAR_EVENTS, type NoteEvent } from './Composer';

export const LOOKAHEAD_S = 0.2;
/** Notes that became due less than this long ago are still played (at `now`); older ones are dropped. */
export const LATE_TOLERANCE_S = 0.05;
/** Delay between start() and the first downbeat, so the first notes are not late. */
export const START_DELAY_S = 0.06;

/**
 * beatPhase while no music plays (stopped, or before the first downbeat): the tail of the bar, where the
 * floor's exp(-uBeat * 7) pulse is at rest (~0.1%), instead of 0 which would hold it at full brightness.
 */
export const BEAT_PHASE_IDLE = 0.999;

export interface Sequencer {
  start(): void;
  stop(): void;
  tick(): void;
  setMood(m: MusicMood): void;
  setIntensity(x: number): void;
  readonly beatPhase: number;
}

export interface SequencerDeps {
  readonly now: () => number;
  readonly composer: Composer;
  readonly schedule: (e: NoteEvent, whenS: number) => void;
  readonly bpm: number;
}

export interface SequencerApi extends Sequencer {
  readonly running: boolean;
  readonly mood: MusicMood;
  readonly intensity: number;
  /** Index of the bar currently being scheduled. */
  readonly barIndex: number;
  /** Absolute beat position (fractional) since start, 0 when stopped. */
  readonly beatPosition: number;
  /** Total notes handed to `schedule`. */
  readonly scheduledCount: number;
}

class SequencerImpl implements SequencerApi {
  private readonly now: () => number;
  private readonly composer: Composer;
  private readonly schedule: (e: NoteEvent, whenS: number) => void;
  private readonly spb: number;
  private readonly barLen: number;
  private readonly buf: NoteEvent[] = [];
  private count = 0;
  private composed = false;
  private startTime = 0;
  private barStart = 0;
  /** Every note starting before this time has been scheduled or dropped. */
  private scheduledUntil = 0;
  running = false;
  mood: MusicMood = 'silent';
  intensity = 0;
  barIndex = 0;
  scheduledCount = 0;

  constructor(deps: SequencerDeps) {
    this.now = deps.now;
    this.composer = deps.composer;
    this.schedule = deps.schedule;
    const bpm = deps.bpm > 0 && Number.isFinite(deps.bpm) ? deps.bpm : 120;
    this.spb = 60 / bpm;
    this.barLen = this.spb * BEATS_PER_BAR;
    for (let i = 0; i < MAX_BAR_EVENTS; i++) {
      this.buf.push({ instrument: 'pad', midi: 0, startBeat: 0, lengthBeats: 0, velocity: 0 });
    }
  }

  start(): void {
    const t = this.now() + START_DELAY_S;
    this.startTime = t;
    this.barStart = t;
    this.scheduledUntil = t;
    this.barIndex = 0;
    this.composed = false;
    this.running = true;
    this.tick();
  }

  stop(): void {
    this.running = false;
    this.composed = false;
  }

  setMood(m: MusicMood): void {
    if (m === this.mood) return;
    this.mood = m;
    // Recompose the current bar so a mood change is heard within the lookahead window, not a bar later.
    this.composed = false;
  }

  setIntensity(x: number): void {
    this.intensity = clamp(Number.isFinite(x) ? x : 0, 0, 1);
  }

  get beatPosition(): number {
    if (!this.running) return 0;
    const t = this.now() - this.startTime;
    return t > 0 ? t / this.spb : 0;
  }

  get beatPhase(): number {
    if (!this.running || this.now() <= this.startTime) return BEAT_PHASE_IDLE;
    const p = this.beatPosition;
    return p - Math.floor(p);
  }

  tick(): void {
    if (!this.running) return;
    const t = this.now();
    const horizon = t + LOOKAHEAD_S;
    const oldest = t - LATE_TOLERANCE_S;
    if (this.scheduledUntil < oldest) this.scheduledUntil = oldest;
    // Skip whole bars that are already in the past (e.g. after a long stall).
    while (this.barStart + this.barLen <= oldest) {
      this.barStart += this.barLen;
      this.barIndex++;
      this.composed = false;
    }
    for (;;) {
      if (!this.composed) {
        this.count = this.composer.bar(this.barIndex, this.mood, this.intensity, this.buf);
        this.composed = true;
      }
      const from = this.scheduledUntil;
      const barEnd = this.barStart + this.barLen;
      const to = horizon < barEnd ? horizon : barEnd;
      for (let i = 0; i < this.count; i++) {
        const e = this.buf[i]!;
        const when = this.barStart + e.startBeat * this.spb;
        if (when >= from && when < to) {
          this.schedule(e, when > t ? when : t);
          this.scheduledCount++;
        }
      }
      this.scheduledUntil = to;
      if (barEnd >= horizon) break;
      this.barStart = barEnd;
      this.barIndex++;
      this.composed = false;
    }
  }
}

/** Lookahead sequencer on an injected clock (the AudioContext's currentTime in production). */
export function createSequencer(deps: SequencerDeps): SequencerApi {
  return new SequencerImpl(deps);
}

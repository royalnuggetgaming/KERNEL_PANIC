/**
 * Persistent music mixer: one filtered bus per instrument into the music input, a reverb send, the kick
 * sidechain duck on the pad, and a live-node budget (plan section 10: fewer than ~40 music nodes live, each
 * stopped explicitly). `schedule` is the Sequencer's sink.
 */
import type { Rng } from '../contracts/sim';
import type { NoteEvent } from './Composer';
import { INSTRUMENT_IDS, type InstrumentId, instrumentIndex } from './instrumentIds';
import { INSTRUMENTS } from './instruments';
import { crunch, makeNoiseBuffer } from './synth';
import type { TimbrePreset } from './timbre';

export const MAX_LIVE_NODES = 40;
/** Pad gain floor while the kick sidechain ducks it. */
export const SIDECHAIN_FLOOR = 0.35;
const RING = 96;

export class MusicGraph {
  private readonly ctx: BaseAudioContext;
  private readonly timbre: TimbrePreset;
  private readonly buses: AudioNode[] = [];
  private readonly padSide: GainNode;
  private readonly noise: AudioBuffer;
  private readonly ends = new Float64Array(RING);
  private readonly counts = new Uint8Array(RING);
  private spb: number;
  dropped = 0;
  played = 0;
  /** Bound once so the Sequencer can call it without allocating. */
  readonly schedule: (e: NoteEvent, whenS: number) => void;

  constructor(
    ctx: BaseAudioContext,
    musicIn: AudioNode,
    reverbIn: AudioNode,
    timbre: TimbrePreset,
    bpm: number,
    rng: Rng,
  ) {
    this.ctx = ctx;
    this.timbre = timbre;
    this.spb = 60 / (bpm > 0 ? bpm : 120);
    this.noise = makeNoiseBuffer(ctx, 'white', 1, rng);
    const b = timbre.brightness;

    this.padSide = ctx.createGain();
    this.padSide.connect(musicIn);
    const padFilter = this.filter('lowpass', 2200 * b, 0.7, this.padSide);
    this.send(this.padSide, reverbIn, 0.35);

    for (let i = 0; i < INSTRUMENT_IDS.length; i++) {
      const id = INSTRUMENT_IDS[i]!;
      this.buses.push(id === 'pad' ? padFilter : this.makeBus(id, musicIn, reverbIn));
    }
    this.schedule = (e, whenS) => {
      this.play(e, whenS);
    };
  }

  setBpm(bpm: number): void {
    if (bpm > 0) this.spb = 60 / bpm;
  }

  /** Music nodes still alive at `now` (per the explicit stop times). */
  liveNodes(now: number): number {
    let n = 0;
    for (let i = 0; i < RING; i++) if (this.ends[i]! > now) n += this.counts[i]!;
    return n;
  }

  private play(e: NoteEvent, when: number): void {
    const idx = instrumentIndex(e.instrument);
    if (idx < 0) return;
    const id = INSTRUMENT_IDS[idx]!;
    const def = INSTRUMENTS[id];
    const now = this.ctx.currentTime;
    const live = this.liveNodes(now);
    if (live + def.nodes > MAX_LIVE_NODES && def.priority < 5) {
      this.dropped++;
      return;
    }
    const slot = this.freeSlot(now);
    if (slot < 0) {
      this.dropped++;
      return;
    }
    const dur = Math.max(0.02, e.lengthBeats * this.spb);
    const end = def.play(this.ctx, this.buses[idx]!, e.midi, when, dur, e.velocity, this.timbre, this.noise);
    this.ends[slot] = end;
    this.counts[slot] = def.nodes;
    this.played++;
    if (id === 'kick') this.duckPad(when, e.velocity);
  }

  private freeSlot(now: number): number {
    for (let i = 0; i < RING; i++) if (this.ends[i]! <= now) return i;
    return -1;
  }

  /** Sidechain: the pad dips on every kick and recovers over ~200 ms. */
  private duckPad(when: number, vel: number): void {
    const g = this.padSide.gain;
    const floor = 1 - (1 - SIDECHAIN_FLOOR) * Math.min(1, vel);
    g.setValueAtTime(1, when);
    g.linearRampToValueAtTime(floor, when + 0.012);
    g.setTargetAtTime(1, when + 0.03, 0.07);
  }

  private filter(type: BiquadFilterType, hz: number, q: number, out: AudioNode): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = hz;
    f.Q.value = q;
    f.connect(out);
    return f;
  }

  private send(from: AudioNode, to: AudioNode, level: number): void {
    const g = this.ctx.createGain();
    g.gain.value = level;
    from.connect(g);
    g.connect(to);
  }

  private makeBus(id: Exclude<InstrumentId, 'pad'>, musicIn: AudioNode, reverbIn: AudioNode): AudioNode {
    const b = this.timbre.brightness;
    switch (id) {
      case 'bass':
        return this.filter('lowpass', 900 * b, 0.9, musicIn);
      case 'distBass': {
        const post = this.filter('lowpass', 1700 * b, 1.2, musicIn);
        const ws = crunch(this.ctx, Math.min(1, this.timbre.drive + 0.35));
        ws.connect(post);
        return ws;
      }
      case 'arp': {
        const f = this.filter('lowpass', 3600 * b, 2, musicIn);
        this.send(f, reverbIn, 0.4);
        return f;
      }
      case 'kick':
        return this.filter('lowpass', 5000, 0.7, musicIn);
      case 'hat':
        return this.filter('highpass', 7000, 0.7, musicIn);
      case 'snare': {
        const f = this.filter('highpass', 900, 0.7, musicIn);
        this.send(f, reverbIn, 0.25);
        return f;
      }
      case 'lead': {
        const f = this.filter('lowpass', 3200 * b, 1, musicIn);
        this.send(f, reverbIn, 0.45);
        return f;
      }
    }
  }
}

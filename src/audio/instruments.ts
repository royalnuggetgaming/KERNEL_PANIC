/**
 * Music instruments (plan section 8): detuned 3-saw pad, octave-pulse sub bass, distorted boss bass,
 * gated FM arpeggio, 808-style kick, noise hat and snare, and a square lead. Every note creates a few
 * short-lived nodes that are explicitly stopped; persistent per-instrument filters live in MusicGraph.
 */
import type { InstrumentId } from './instrumentIds';
import { SILENCE, envelope, percEnvelope } from './synth';
import { midiToHz } from './theory';
import type { TimbrePreset } from './timbre';

export interface InstrumentDef {
  /** Nodes created per note (counted against the live-node budget). */
  readonly nodes: number;
  /** Lower numbers are dropped first when the live-node budget is exhausted. */
  readonly priority: number;
  /** Schedules one note at `when` lasting `dur` seconds; returns the time its nodes stop. */
  play(
    ctx: BaseAudioContext,
    out: AudioNode,
    midi: number,
    when: number,
    dur: number,
    vel: number,
    timbre: TimbrePreset,
    noise: AudioBuffer,
  ): number;
}

const PAD_ENV = { a: 0.35, d: 0.6, s: 0.72, r: 0.7 } as const;
const BASS_ENV = { a: 0.005, d: 0.12, s: 0.7, r: 0.06 } as const;
const LEAD_ENV = { a: 0.01, d: 0.18, s: 0.6, r: 0.12 } as const;

function osc(
  ctx: BaseAudioContext,
  type: OscillatorType,
  hz: number,
  detune: number,
  dest: AudioNode,
  when: number,
  stop: number,
): void {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = hz;
  o.detune.value = detune;
  o.connect(dest);
  o.start(when);
  o.stop(stop);
}

export const INSTRUMENTS: Readonly<Record<InstrumentId, InstrumentDef>> = {
  pad: {
    nodes: 4,
    priority: 3,
    play(ctx, out, midi, when, dur, vel, timbre) {
      const g = ctx.createGain();
      g.connect(out);
      const end = envelope(g.gain, when, PAD_ENV, 0.07 * vel, dur);
      const hz = midiToHz(midi);
      const d = timbre.padDetuneCents;
      osc(ctx, timbre.padWave, hz, -d, g, when, end + 0.02);
      osc(ctx, timbre.padWave, hz, 0, g, when, end + 0.02);
      osc(ctx, timbre.padWave, hz, d, g, when, end + 0.02);
      return end + 0.02;
    },
  },
  bass: {
    nodes: 4,
    priority: 4,
    play(ctx, out, midi, when, dur, vel) {
      const g = ctx.createGain();
      g.connect(out);
      const end = envelope(g.gain, when, BASS_ENV, 0.32 * vel, dur);
      const hz = midiToHz(midi);
      osc(ctx, 'sine', hz, 0, g, when, end + 0.01);
      const pulse = ctx.createOscillator();
      const pg = ctx.createGain();
      pulse.type = 'square';
      pulse.frequency.value = hz;
      pg.gain.value = 0.28;
      pulse.connect(pg);
      pg.connect(g);
      pulse.start(when);
      pulse.stop(end + 0.01);
      return end + 0.01;
    },
  },
  distBass: {
    nodes: 3,
    priority: 4,
    play(ctx, out, midi, when, dur, vel) {
      const g = ctx.createGain();
      g.connect(out);
      const end = envelope(g.gain, when, BASS_ENV, 0.3 * vel, dur);
      const hz = midiToHz(midi);
      osc(ctx, 'sawtooth', hz, 0, g, when, end + 0.01);
      osc(ctx, 'square', hz * 0.5, 6, g, when, end + 0.01);
      return end + 0.01;
    },
  },
  arp: {
    nodes: 4,
    priority: 1,
    play(ctx, out, midi, when, dur, vel, timbre) {
      const hz = midiToHz(midi);
      const car = ctx.createOscillator();
      const mod = ctx.createOscillator();
      const mg = ctx.createGain();
      const amp = ctx.createGain();
      car.frequency.value = hz;
      mod.frequency.value = hz * timbre.fmRatio;
      mg.gain.setValueAtTime(hz * timbre.fmRatio * timbre.fmIndex, when);
      mg.gain.exponentialRampToValueAtTime(Math.max(SILENCE, hz * 0.2), when + Math.max(0.02, dur));
      // Gated: hard-ish on/off envelope with a short tail.
      amp.gain.setValueAtTime(SILENCE, when);
      amp.gain.linearRampToValueAtTime(0.09 * vel, when + 0.004);
      amp.gain.setValueAtTime(0.09 * vel, when + dur);
      amp.gain.exponentialRampToValueAtTime(SILENCE, when + dur + 0.04);
      mod.connect(mg);
      mg.connect(car.frequency);
      car.connect(amp);
      amp.connect(out);
      const stop = when + dur + 0.05;
      mod.start(when);
      car.start(when);
      mod.stop(stop);
      car.stop(stop);
      return stop;
    },
  },
  kick: {
    nodes: 2,
    priority: 5,
    play(ctx, out, _midi, when, _dur, vel) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(150, when);
      o.frequency.exponentialRampToValueAtTime(42, when + 0.12);
      const end = percEnvelope(g.gain, when, 0.9 * vel, 0.002, 0.42);
      o.connect(g);
      g.connect(out);
      o.start(when);
      o.stop(end + 0.01);
      return end + 0.01;
    },
  },
  hat: {
    nodes: 2,
    priority: 0,
    play(ctx, out, _midi, when, dur, vel, _timbre, noise) {
      const src = ctx.createBufferSource();
      const g = ctx.createGain();
      src.buffer = noise;
      src.loop = true;
      const end = percEnvelope(g.gain, when, 0.22 * vel, 0.001, Math.max(0.03, dur * 0.4));
      src.connect(g);
      g.connect(out);
      src.start(when, (when * 0.37) % 0.9);
      src.stop(end + 0.01);
      return end + 0.01;
    },
  },
  snare: {
    nodes: 4,
    priority: 2,
    play(ctx, out, _midi, when, _dur, vel, _timbre, noise) {
      const src = ctx.createBufferSource();
      const ng = ctx.createGain();
      src.buffer = noise;
      src.loop = true;
      const e1 = percEnvelope(ng.gain, when, 0.35 * vel, 0.001, 0.18);
      src.connect(ng);
      ng.connect(out);
      src.start(when, (when * 0.53) % 0.9);
      src.stop(e1 + 0.01);
      const body = ctx.createOscillator();
      const bg = ctx.createGain();
      body.type = 'triangle';
      body.frequency.setValueAtTime(220, when);
      body.frequency.exponentialRampToValueAtTime(160, when + 0.08);
      const e2 = percEnvelope(bg.gain, when, 0.3 * vel, 0.001, 0.1);
      body.connect(bg);
      bg.connect(out);
      body.start(when);
      body.stop(e2 + 0.01);
      return Math.max(e1, e2) + 0.01;
    },
  },
  lead: {
    nodes: 2,
    priority: 3,
    play(ctx, out, midi, when, dur, vel, timbre) {
      const g = ctx.createGain();
      g.connect(out);
      const end = envelope(g.gain, when, LEAD_ENV, 0.08 * vel, dur);
      osc(ctx, timbre.leadWave, midiToHz(midi), 0, g, when, end + 0.01);
      return end + 0.01;
    },
  },
};

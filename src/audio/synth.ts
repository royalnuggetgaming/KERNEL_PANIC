/**
 * Web Audio synthesis primitives (plan section 8): ADSR on AudioParam, oscillator and FM voices, seeded noise
 * buffers (white, pink, brown), filter sweeps and a WaveShaper drive curve. The buffer/curve fillers are pure
 * and node-testable; the node builders take any BaseAudioContext (realtime or offline).
 */
import type { Rng } from '../contracts/sim';

/** Smallest level used as an exponential-ramp target (exponential ramps cannot reach 0). */
export const SILENCE = 0.0001;

export interface Adsr {
  readonly a: number;
  readonly d: number;
  /** Sustain level as a fraction of the peak. */
  readonly s: number;
  readonly r: number;
}

/**
 * Schedules an ADSR on `param` starting at t: attack to `peak`, decay to s * peak, hold until t + gate,
 * then release towards silence. Returns the time the release ends.
 */
export function envelope(param: AudioParam, t: number, env: Adsr, peak: number, gate: number): number {
  const a = Math.max(0.001, env.a);
  const d = Math.max(0.001, env.d);
  const r = Math.max(0.005, env.r);
  const sus = Math.max(SILENCE, peak * env.s);
  const gateEnd = Math.max(t + a, t + gate);
  param.cancelScheduledValues(t);
  param.setValueAtTime(SILENCE, t);
  param.linearRampToValueAtTime(peak, t + a);
  if (gateEnd > t + a)
    param.exponentialRampToValueAtTime(Math.max(SILENCE, sus), Math.min(t + a + d, gateEnd));
  if (gateEnd > t + a + d) param.setValueAtTime(sus, gateEnd);
  param.exponentialRampToValueAtTime(SILENCE, gateEnd + r);
  return gateEnd + r;
}

/** Percussive envelope: instant-ish attack then an exponential decay over `decay` seconds. */
export function percEnvelope(
  param: AudioParam,
  t: number,
  peak: number,
  attack: number,
  decay: number,
): number {
  param.cancelScheduledValues(t);
  param.setValueAtTime(SILENCE, t);
  param.linearRampToValueAtTime(peak, t + Math.max(0.001, attack));
  const end = t + Math.max(0.001, attack) + Math.max(0.005, decay);
  param.exponentialRampToValueAtTime(SILENCE, end);
  return end;
}

/** Exponential frequency (or any positive param) sweep from `from` to `to` over `dur` seconds. */
export function sweep(param: AudioParam, t: number, from: number, to: number, dur: number): void {
  param.setValueAtTime(Math.max(SILENCE, from), t);
  param.exponentialRampToValueAtTime(Math.max(SILENCE, to), t + Math.max(0.001, dur));
}

/**
 * One enveloped oscillator with an exponential pitch glide from f0 to f1 over `glide` seconds.
 * Returns the stop time.
 */
export function tone(
  ctx: BaseAudioContext,
  out: AudioNode,
  type: OscillatorType,
  t: number,
  f0: number,
  f1: number,
  glide: number,
  peak: number,
  attack: number,
  decay: number,
  detuneCents = 0,
): number {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.detune.value = detuneCents;
  sweep(osc.frequency, t, f0, f1, glide);
  const end = percEnvelope(g.gain, t, peak, attack, decay);
  osc.connect(g);
  g.connect(out);
  osc.start(t);
  osc.stop(end + 0.01);
  return end;
}

/**
 * Two-operator FM voice: a sine modulator (carrierHz * ratio) drives the carrier frequency with depth
 * index * modulatorHz. The modulation index decays with the amplitude for a glassy attack. Returns stop time.
 */
export function fmVoice(
  ctx: BaseAudioContext,
  out: AudioNode,
  t: number,
  dur: number,
  carrierHz: number,
  ratio: number,
  index: number,
  peak: number,
  carrierType: OscillatorType = 'sine',
): number {
  const car = ctx.createOscillator();
  const mod = ctx.createOscillator();
  const modGain = ctx.createGain();
  const amp = ctx.createGain();
  car.type = carrierType;
  mod.type = 'sine';
  car.frequency.value = carrierHz;
  const modHz = carrierHz * ratio;
  mod.frequency.value = modHz;
  modGain.gain.setValueAtTime(index * modHz, t);
  modGain.gain.exponentialRampToValueAtTime(Math.max(SILENCE, index * modHz * 0.15), t + Math.max(0.01, dur));
  const end = percEnvelope(amp.gain, t, peak, 0.004, Math.max(0.01, dur));
  mod.connect(modGain);
  modGain.connect(car.frequency);
  car.connect(amp);
  amp.connect(out);
  mod.start(t);
  car.start(t);
  mod.stop(end + 0.01);
  car.stop(end + 0.01);
  return end;
}

export type NoiseKind = 'white' | 'pink' | 'brown';

/** Fills `data` with seeded noise in [-1, 1]. Pink uses Paul Kellet's filter; brown is leaky-integrated. */
export function fillNoise(data: Float32Array, kind: NoiseKind, rng: Rng): void {
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const w = rng.next() * 2 - 1;
    if (kind === 'white') {
      data[i] = w;
    } else if (kind === 'pink') {
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      const p = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
      data[i] = p < -1 ? -1 : p > 1 ? 1 : p;
    } else {
      last = (last + 0.02 * w) / 1.02;
      const b = last * 3.5;
      data[i] = b < -1 ? -1 : b > 1 ? 1 : b;
    }
  }
}

/** A mono noise AudioBuffer of the given length. */
export function makeNoiseBuffer(
  ctx: BaseAudioContext,
  kind: NoiseKind,
  seconds: number,
  rng: Rng,
): AudioBuffer {
  const len = Math.max(1, Math.ceil(seconds * ctx.sampleRate));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  fillNoise(buf.getChannelData(0), kind, rng);
  return buf;
}

/**
 * Plays a slice of a noise buffer through a filter whose cutoff sweeps f0 -> f1, with a percussive envelope.
 * Returns the stop time.
 */
export function noiseBurst(
  ctx: BaseAudioContext,
  out: AudioNode,
  noise: AudioBuffer,
  t: number,
  filterType: BiquadFilterType,
  f0: number,
  f1: number,
  q: number,
  peak: number,
  attack: number,
  decay: number,
): number {
  const src = ctx.createBufferSource();
  const filt = ctx.createBiquadFilter();
  const g = ctx.createGain();
  src.buffer = noise;
  src.loop = true;
  filt.type = filterType;
  filt.Q.value = q;
  sweep(filt.frequency, t, f0, f1, attack + decay);
  const end = percEnvelope(g.gain, t, peak, attack, decay);
  src.connect(filt);
  filt.connect(g);
  g.connect(out);
  src.start(t);
  src.stop(end + 0.01);
  return end;
}

/** Soft-clip (tanh-style) waveshaper curve; amount 0..1 maps to gentle..heavy crunch. Output in [-1, 1]. */
export function makeDriveCurve(amount: number, samples = 1024): Float32Array<ArrayBuffer> {
  const n = Math.max(2, samples | 0);
  const curve = new Float32Array(n);
  const k = 1 + Math.max(0, Math.min(1, amount)) * 40;
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;
    curve[i] = Math.tanh(k * x) / norm;
  }
  return curve;
}

/** A WaveShaper crunch node (4x oversampled). */
export function crunch(ctx: BaseAudioContext, amount: number): WaveShaperNode {
  const ws = ctx.createWaveShaper();
  ws.curve = makeDriveCurve(amount);
  ws.oversample = '4x';
  return ws;
}

/** A gain node at a fixed level connected to `out`: convenience for recipe sub-mixes. */
export function mixGain(ctx: BaseAudioContext, out: AudioNode, level: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = level;
  g.connect(out);
  return g;
}

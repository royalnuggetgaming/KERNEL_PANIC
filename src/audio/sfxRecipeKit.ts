/**
 * Shared vocabulary for SFX recipes: the per-render context handed to every recipe plus a few composite
 * gestures (laser zap, sub thump, glitch stutter, chime) built from synth.ts primitives.
 */
import type { SfxCategory } from '../contracts/audio';
import type { Rng } from '../contracts/sim';
import { type NoiseKind, SILENCE, crunch, fmVoice, makeNoiseBuffer, mixGain, noiseBurst, tone } from './synth';
import type { TimbrePreset } from './timbre';

/** Everything a recipe needs to build its graph into one (offline) context. */
export interface RecipeContext {
  readonly ctx: BaseAudioContext;
  readonly out: AudioNode;
  /** 0, 1 or 2. */
  readonly variant: number;
  /** Frequency multiplier for this variant (timbre transpose, variant offset and jitter). */
  readonly pitch: number;
  readonly timbre: TimbrePreset;
  readonly rng: Rng;
  /** A 1 s looping noise buffer of the given colour, created once per render context. */
  noise(kind: NoiseKind): AudioBuffer;
}

export interface SfxRecipe {
  readonly category: SfxCategory;
  /** Rendered length in seconds before the timbre's decay multiplier. */
  readonly duration: number;
  /** Playback gain trim. */
  readonly gain: number;
  build(r: RecipeContext): void;
}

export const SFX_VARIANTS = 3;
/** Semitone offset of each variant. */
const VARIANT_SEMIS: readonly number[] = [0, 1, -1];

/** Frequency multiplier for a variant, including the timbre transpose and a small seeded jitter. */
export function variantPitch(timbre: TimbrePreset, variant: number, rng: Rng): number {
  const semis = timbre.sfxTranspose + (VARIANT_SEMIS[variant % SFX_VARIANTS] ?? 0);
  return Math.pow(2, semis / 12) * (1 + rng.range(-0.015, 0.015));
}

export class RecipeContextImpl implements RecipeContext {
  readonly ctx: BaseAudioContext;
  readonly out: AudioNode;
  readonly variant: number;
  readonly pitch: number;
  readonly timbre: TimbrePreset;
  readonly rng: Rng;
  private readonly buffers: Partial<Record<NoiseKind, AudioBuffer>> = {};

  constructor(ctx: BaseAudioContext, out: AudioNode, variant: number, timbre: TimbrePreset, rng: Rng) {
    this.ctx = ctx;
    this.out = out;
    this.variant = variant;
    this.timbre = timbre;
    this.rng = rng;
    this.pitch = variantPitch(timbre, variant, rng);
  }

  noise(kind: NoiseKind): AudioBuffer {
    const have = this.buffers[kind];
    if (have !== undefined) return have;
    const buf = makeNoiseBuffer(this.ctx, kind, 1, this.rng);
    this.buffers[kind] = buf;
    return buf;
  }
}

/** Two detuned laser oscillators with a pitch drop ("square/saw lasers with pitch drops"). */
export function zap(r: RecipeContext, t: number, f0: number, f1: number, glide: number, peak: number, decay: number): number {
  const p = r.pitch;
  const d = decay * r.timbre.decay;
  const e1 = tone(r.ctx, r.out, r.timbre.laserWave, t, f0 * p, f1 * p, glide, peak, 0.002, d);
  const e2 = tone(r.ctx, r.out, r.timbre.laserWave2, t, f0 * p * 0.995, f1 * p, glide, peak * 0.45, 0.002, d, 9);
  return Math.max(e1, e2);
}

/** Sine sub-thump with a fast pitch drop (explosions, kicks, impacts). */
export function thump(r: RecipeContext, t: number, f0: number, f1: number, peak: number, decay: number): number {
  return tone(r.ctx, r.out, 'sine', t, f0, f1, decay * 0.6, peak, 0.002, decay * r.timbre.decay);
}

/**
 * Noise + sub explosion through a WaveShaper crunch ("noise plus sub-thump explosions through a WaveShaper
 * crunch"). size scales cutoff, length and level.
 */
export function boom(r: RecipeContext, t: number, size: number, peak: number): number {
  const ctx = r.ctx;
  const drive = crunch(ctx, r.timbre.drive * (0.6 + 0.4 * size));
  const post = mixGain(ctx, r.out, 0.8);
  drive.connect(post);
  const bright = r.timbre.brightness;
  const decay = (0.28 + 0.9 * size) * r.timbre.decay;
  const e1 = noiseBurst(ctx, drive, r.noise(size > 0.6 ? 'brown' : 'white'), t, 'lowpass', 4200 * bright, 140, 0.8, peak, 0.004, decay);
  const e2 = noiseBurst(ctx, drive, r.noise('pink'), t, 'bandpass', 1400 * bright, 300, 1.2, peak * 0.5, 0.002, decay * 0.5);
  const e3 = tone(ctx, drive, 'sine', t, (140 - 40 * size) * r.pitch, 32, 0.25 + 0.3 * size, peak * 1.2, 0.002, decay * 0.8);
  return Math.max(e1, e2, e3);
}

/**
 * Glitch stutter: `count` tiny gated bursts at jittered pitches, like a corrupted buffer repeating
 * ("a glitch stutter when a Corrupted enemy dies").
 */
export function stutter(r: RecipeContext, t: number, count: number, spacing: number, peak: number): number {
  let end = t;
  for (let i = 0; i < count; i++) {
    const at = t + i * spacing;
    const f = (600 + r.rng.next() * 2600) * r.pitch;
    const e =
      i % 2 === 0
        ? noiseBurst(r.ctx, r.out, r.noise('white'), at, 'bandpass', f, f * 0.7, 6, peak, 0.001, spacing * 0.6)
        : tone(r.ctx, r.out, 'square', at, f * 0.5, f * 0.25, spacing * 0.5, peak * 0.5, 0.001, spacing * 0.55);
    if (e > end) end = e;
  }
  return end;
}

/** FM glass chime: a stack of FM voices staggered in time ("FM glass shimmer for power-ups"). */
export function chime(r: RecipeContext, t: number, freqs: readonly number[], gap: number, peak: number, dur: number): number {
  let end = t;
  const ratio = r.timbre.fmRatio + 1.5;
  for (let i = 0; i < freqs.length; i++) {
    const e = fmVoice(r.ctx, r.out, t + i * gap, dur * r.timbre.decay, freqs[i]! * r.pitch, ratio, r.timbre.fmIndex * 0.6, peak);
    if (e > end) end = e;
  }
  return end;
}

/** Plain sequential blips (UI and fanfare). */
export function blips(
  r: RecipeContext,
  type: OscillatorType,
  t: number,
  freqs: readonly number[],
  gap: number,
  peak: number,
  decay: number,
): number {
  let end = t;
  for (let i = 0; i < freqs.length; i++) {
    const f = freqs[i]! * r.pitch;
    const e = tone(r.ctx, r.out, type, t + i * gap, f, f * 0.999, 0.01, peak, 0.003, decay);
    if (e > end) end = e;
  }
  return end;
}

/** A filtered noise swell (whooshes, domes, portals). */
export function whoosh(r: RecipeContext, t: number, f0: number, f1: number, attack: number, decay: number, peak: number): number {
  const b = r.timbre.brightness;
  return noiseBurst(r.ctx, r.out, r.noise('pink'), t, 'bandpass', Math.max(SILENCE, f0 * b), Math.max(SILENCE, f1 * b), 2.5, peak, attack, decay);
}

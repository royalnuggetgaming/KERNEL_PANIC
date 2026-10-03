/** Timbre presets selected by ThemeAudio.timbre: they parameterise every SFX recipe and instrument. */
import type { ThemeAudio } from '../contracts/theme';

export interface TimbrePreset {
  /** Weapon/laser oscillator waves (primary, secondary). */
  readonly laserWave: OscillatorType;
  readonly laserWave2: OscillatorType;
  readonly padWave: OscillatorType;
  readonly leadWave: OscillatorType;
  /** Spread of the 3-oscillator pad detune, in cents. */
  readonly padDetuneCents: number;
  /** Multiplier on filter cutoffs (1 = neutral). */
  readonly brightness: number;
  /** 0..1 waveshaper crunch amount for explosions and the boss bass. */
  readonly drive: number;
  /** Multiplier on SFX tails. */
  readonly decay: number;
  readonly reverbSeconds: number;
  readonly reverbDecay: number;
  /** FM arp/shimmer modulator ratio and index. */
  readonly fmRatio: number;
  readonly fmIndex: number;
  /** Master pitch offset for SFX, in semitones. */
  readonly sfxTranspose: number;
  /** Drum kit voicing: 808-style electro, soft muffled (abyssal), metallic noise (industrial). */
  readonly kit: DrumKit;
  /** Wave of the bass pulse layer over the sine sub. */
  readonly bassWave: OscillatorType;
  /** 0..1 waveshaper drive on the regular bass bus (0 = clean, no shaper). */
  readonly bassDrive: number;
}

export type DrumKit = 'electro' | 'soft' | 'metal';

export type TimbreName = ThemeAudio['timbre'];

export const TIMBRES: Readonly<Record<TimbreName, TimbrePreset>> = {
  synthwave: {
    laserWave: 'square',
    laserWave2: 'sawtooth',
    padWave: 'sawtooth',
    leadWave: 'square',
    padDetuneCents: 12,
    brightness: 1,
    drive: 0.55,
    decay: 1,
    reverbSeconds: 2.4,
    reverbDecay: 3.2,
    fmRatio: 2,
    fmIndex: 2.4,
    sfxTranspose: 0,
    kit: 'electro',
    bassWave: 'square',
    bassDrive: 0,
  },
  abyssal: {
    laserWave: 'sine',
    laserWave2: 'triangle',
    padWave: 'triangle',
    leadWave: 'sine',
    padDetuneCents: 7,
    brightness: 0.55,
    drive: 0.25,
    decay: 1.5,
    reverbSeconds: 3.6,
    reverbDecay: 2.2,
    fmRatio: 1.5,
    fmIndex: 1.6,
    sfxTranspose: -5,
    kit: 'soft',
    bassWave: 'sine',
    bassDrive: 0,
  },
  industrial: {
    laserWave: 'sawtooth',
    laserWave2: 'square',
    padWave: 'sawtooth',
    leadWave: 'sawtooth',
    padDetuneCents: 18,
    brightness: 1.2,
    drive: 0.85,
    decay: 0.85,
    reverbSeconds: 1.8,
    reverbDecay: 4,
    fmRatio: 3,
    fmIndex: 3.2,
    sfxTranspose: -2,
    kit: 'metal',
    bassWave: 'sawtooth',
    bassDrive: 0.6,
  },
};

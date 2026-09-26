/**
 * Pure music theory helpers: pitch conversion, modes, chord building and the theme's key/progression logic
 * (plan section 2: A minor/Dorian i-VI-III-VII; sector keys A/C/E minor; boss waves move up a key).
 */
import type { ThemeDef } from '../contracts/theme';

export type ModeName = 'aeolian' | 'dorian' | 'phrygian';

/** Semitone offsets of each mode from its tonic. */
export const SCALES: Readonly<Record<ModeName, readonly number[]>> = {
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
};

/** Minor pentatonic, used for melodic ladders (pickup pitch ladder, lead fills). */
export const MINOR_PENTATONIC: readonly number[] = [0, 3, 5, 7, 10];

const MINOR_SEVENTH: readonly number[] = [0, 3, 7, 10];

export const A4_MIDI = 69;
export const A4_HZ = 440;

/** Equal-tempered frequency of a MIDI note (A4 = 69 = 440 Hz). Fractional notes are allowed. */
export function midiToHz(midi: number): number {
  return A4_HZ * Math.pow(2, (midi - A4_MIDI) / 12);
}

/** Inverse of midiToHz. */
export function hzToMidi(hz: number): number {
  return A4_MIDI + 12 * Math.log2(hz / A4_HZ);
}

/** Frequency ratio of a detune in cents (100 cents = 1 semitone). */
export function centsToRatio(cents: number): number {
  return Math.pow(2, cents / 1200);
}

/**
 * Semitone offset (from the tonic) of a scale degree. Degrees may be negative or beyond the octave;
 * they wrap with octave carries (degree 7 of a 7-note scale is the tonic an octave up).
 */
export function scaleDegree(scale: readonly number[], degree: number): number {
  const n = scale.length;
  const oct = Math.floor(degree / n);
  const idx = degree - oct * n;
  return scale[idx]! + 12 * oct;
}

/** Index of a semitone offset (0..11) in the scale, or -1 when the pitch class is not in the scale. */
export function degreeOf(scale: readonly number[], semitone: number): number {
  const pc = ((semitone % 12) + 12) % 12;
  for (let i = 0; i < scale.length; i++) if (scale[i] === pc) return i;
  return -1;
}

/**
 * Writes the diatonic chord built on `rootOffset` (semitones above the tonic) into out[0..size) as
 * semitone offsets from the tonic, stacking thirds within `scale`. Falls back to the aeolian scale when the
 * root is not diatonic to `scale` (e.g. the bVI of Dorian), then to a plain minor triad. Returns size.
 */
export function chordTones(
  scale: readonly number[],
  rootOffset: number,
  size: number,
  out: number[] | Float64Array,
): number {
  let s = scale;
  let deg = degreeOf(s, rootOffset);
  if (deg < 0) {
    s = SCALES.aeolian;
    deg = degreeOf(s, rootOffset);
  }
  const base = rootOffset - (((rootOffset % 12) + 12) % 12);
  if (deg < 0) {
    for (let i = 0; i < size; i++) out[i] = rootOffset + MINOR_SEVENTH[i % 4]! + 12 * Math.floor(i / 4);
    return size;
  }
  for (let i = 0; i < size; i++) out[i] = base + scaleDegree(s, deg + 2 * i);
  return size;
}

/** Key tonic (MIDI) for a sector, optionally shifted for a boss wave. */
export function keyRoot(theme: ThemeDef, sector: 1 | 2 | 3, boss: boolean): number {
  const a = theme.audio;
  return a.rootMidi + a.sectorKeyShift[sector - 1] + (boss ? a.bossKeyShift : 0);
}

/** Chord root MIDI note per bar of the theme's progression in the given sector key. */
export function progression(theme: ThemeDef, sector: 1 | 2 | 3, boss: boolean): readonly number[] {
  const root = keyRoot(theme, sector, boss);
  const p = theme.audio.progression;
  const out: number[] = [];
  for (let i = 0; i < p.length; i++) out.push(root + p[i]!);
  return out;
}

/** Seconds per beat at a tempo. */
export function secondsPerBeat(bpm: number): number {
  return 60 / bpm;
}

/** Wraps a MIDI note into [lo, lo + 12) by octaves. */
export function foldIntoOctave(midi: number, lo: number): number {
  let m = midi;
  while (m < lo) m += 12;
  while (m >= lo + 12) m -= 12;
  return m;
}

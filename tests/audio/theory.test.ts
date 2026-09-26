import { describe, expect, it } from 'vitest';
import { KERNEL_PANIC } from '../../src/themes/kernelPanic';
import {
  SCALES,
  centsToRatio,
  chordTones,
  degreeOf,
  foldIntoOctave,
  hzToMidi,
  keyRoot,
  midiToHz,
  progression,
  scaleDegree,
  secondsPerBeat,
} from '../../src/audio/theory';

describe('theory', () => {
  it('midiToHz uses A4 = 440', () => {
    expect(midiToHz(69)).toBeCloseTo(440, 10);
    expect(midiToHz(81)).toBeCloseTo(880, 10);
    expect(midiToHz(57)).toBeCloseTo(220, 10);
    expect(midiToHz(60)).toBeCloseTo(261.6256, 3);
    expect(hzToMidi(midiToHz(45.5))).toBeCloseTo(45.5, 10);
    expect(centsToRatio(1200)).toBeCloseTo(2, 10);
    expect(centsToRatio(-1200)).toBeCloseTo(0.5, 10);
  });

  it('scales have 7 ascending degrees starting at 0', () => {
    for (const name of ['aeolian', 'dorian', 'phrygian'] as const) {
      const s = SCALES[name];
      expect(s).toHaveLength(7);
      expect(s[0]).toBe(0);
      for (let i = 1; i < s.length; i++) expect(s[i]!).toBeGreaterThan(s[i - 1]!);
    }
    expect(SCALES.dorian[5]).toBe(9);
    expect(SCALES.aeolian[5]).toBe(8);
    expect(SCALES.phrygian[1]).toBe(1);
  });

  it('scaleDegree wraps octaves in both directions', () => {
    const a = SCALES.aeolian;
    expect(scaleDegree(a, 0)).toBe(0);
    expect(scaleDegree(a, 7)).toBe(12);
    expect(scaleDegree(a, 9)).toBe(15);
    expect(scaleDegree(a, -1)).toBe(-2);
    expect(degreeOf(a, 8)).toBe(5);
    expect(degreeOf(a, 20)).toBe(5);
    expect(degreeOf(a, 9)).toBe(-1);
  });

  it('builds the i-VI-III-VII triads of A minor', () => {
    const out = [0, 0, 0];
    chordTones(SCALES.aeolian, 0, 3, out);
    expect(out).toEqual([0, 3, 7]); // A C E
    chordTones(SCALES.aeolian, 8, 3, out);
    expect(out).toEqual([8, 12, 15]); // F A C
    chordTones(SCALES.aeolian, 3, 3, out);
    expect(out).toEqual([3, 7, 10]); // C E G
    chordTones(SCALES.aeolian, 10, 3, out);
    expect(out).toEqual([10, 14, 17]); // G B D
  });

  it('falls back to aeolian for non-diatonic roots and to a minor chord otherwise', () => {
    const out = [0, 0, 0, 0];
    chordTones(SCALES.dorian, 8, 3, out);
    expect(out.slice(0, 3)).toEqual([8, 12, 15]);
    chordTones(SCALES.aeolian, 1, 4, out);
    expect(out).toEqual([1, 4, 8, 11]);
  });

  it('sector keys are A, C and E minor, boss waves move up', () => {
    expect(keyRoot(KERNEL_PANIC, 1, false) % 12).toBe(9); // A
    expect(keyRoot(KERNEL_PANIC, 2, false) % 12).toBe(0); // C
    expect(keyRoot(KERNEL_PANIC, 3, false) % 12).toBe(4); // E
    expect(keyRoot(KERNEL_PANIC, 1, true)).toBe(
      keyRoot(KERNEL_PANIC, 1, false) + KERNEL_PANIC.audio.bossKeyShift,
    );
  });

  it('progression returns one chord root per bar', () => {
    const p = progression(KERNEL_PANIC, 1, false);
    expect(p).toEqual([57, 65, 60, 67]);
    const b = progression(KERNEL_PANIC, 2, true);
    expect(b[0]).toBe(57 + 3 + 1);
  });

  it('misc helpers', () => {
    expect(secondsPerBeat(112)).toBeCloseTo(60 / 112, 10);
    expect(foldIntoOctave(30, 33)).toBe(42);
    expect(foldIntoOctave(50, 33)).toBe(38);
    expect(foldIntoOctave(33, 33)).toBe(33);
  });
});

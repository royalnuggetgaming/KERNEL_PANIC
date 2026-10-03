/** Composer per theme: deterministic bars, in-range events, and a recognisably different arrangement per style. */
import { describe, expect, it } from 'vitest';
import { BEATS_PER_BAR, MAX_BAR_EVENTS, type NoteEvent, createComposer } from '../../src/audio/Composer';
import { INSTRUMENT_IDS } from '../../src/audio/instrumentIds';
import { TIMBRES } from '../../src/audio/timbre';
import type { MusicMood } from '../../src/contracts/audio';
import type { ThemeDef } from '../../src/contracts/theme';
import { THEMES } from '../../src/themes/registry';

const MOODS: readonly MusicMood[] = [
  'menu',
  'select',
  'combat',
  'boss',
  'shop',
  'paused',
  'gameover',
  'victory',
];

function render(theme: ThemeDef, seed: number, mood: MusicMood, x: number, bars = 8): NoteEvent[][] {
  const c = createComposer(theme, seed);
  const out: NoteEvent[] = [];
  const res: NoteEvent[][] = [];
  for (let b = 0; b < bars; b++) {
    const n = c.bar(b, mood, x, out);
    res.push(out.slice(0, n).map((e) => ({ ...e })));
  }
  return res;
}

function count(bars: NoteEvent[][], inst: string): number {
  let n = 0;
  for (const b of bars) for (const e of b) if (e.instrument === inst) n++;
  return n;
}

describe.each(Object.values(THEMES).map((t) => [t.id, t] as const))('composer for %s', (_id, theme) => {
  it('is deterministic per (seed, bar, mood, intensity) and emits valid events', () => {
    for (const mood of MOODS) {
      for (const x of [0, 0.4, 0.8, 1]) {
        const a = render(theme, 77, mood, x);
        expect(render(theme, 77, mood, x)).toEqual(a);
        for (const bar of a) {
          expect(bar.length).toBeLessThanOrEqual(MAX_BAR_EVENTS);
          for (const e of bar) {
            expect(INSTRUMENT_IDS).toContain(e.instrument);
            expect(e.startBeat).toBeGreaterThanOrEqual(0);
            expect(e.startBeat).toBeLessThan(BEATS_PER_BAR);
            expect(e.velocity).toBeGreaterThan(0);
            expect(e.velocity).toBeLessThanOrEqual(1);
            expect(Number.isInteger(e.midi)).toBe(true);
          }
        }
      }
    }
  });

  it('maps its timbre preset to a distinct drum kit', () => {
    const kits = Object.values(THEMES).map((t) => TIMBRES[t.audio.timbre].kit);
    expect(new Set(kits).size).toBe(kits.length);
  });
});

describe('theme arrangements differ', () => {
  it('abyssal plays sparse sonar pings and held drones; industrial drives 16th noise percussion', () => {
    const kp = render(THEMES.kernelPanic, 5, 'combat', 0.8);
    const ab = render(THEMES.abyssalLight, 5, 'combat', 0.8);
    const em = render(THEMES.emberfall, 5, 'combat', 0.8);
    expect(count(ab, 'arp')).toBeLessThan(count(kp, 'arp') / 3);
    expect(count(ab, 'bass')).toBeLessThan(count(kp, 'bass'));
    expect(count(ab, 'hat')).toBeLessThan(count(em, 'hat') / 2);
    expect(count(em, 'hat')).toBe(16 * 8);
    expect(count(em, 'kick')).toBeGreaterThan(count(ab, 'kick'));
    const longest = Math.max(
      ...ab
        .flat()
        .filter((e) => e.instrument === 'bass')
        .map((e) => e.lengthBeats),
    );
    expect(longest).toBe(4);
  });

  it('even at low intensity EMBERFALL keeps its 16th-note percussion and ABYSSAL LIGHT stays sparse', () => {
    expect(count(render(THEMES.emberfall, 9, 'combat', 0.35), 'hat')).toBe(16 * 8);
    expect(count(render(THEMES.abyssalLight, 9, 'combat', 0.35), 'hat')).toBeLessThanOrEqual(4 * 8);
  });

  it('tempo and key follow the theme (76 BPM D Dorian, 124 BPM E Phrygian)', () => {
    expect(THEMES.abyssalLight.audio).toMatchObject({ bpm: 76, mode: 'dorian', rootMidi: 50 });
    expect(THEMES.emberfall.audio).toMatchObject({ bpm: 124, mode: 'phrygian', rootMidi: 52 });
  });
});

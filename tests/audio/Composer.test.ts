import { describe, expect, it } from 'vitest';
import type { MusicMood } from '../../src/contracts/audio';
import { KERNEL_PANIC } from '../../src/themes/kernelPanic';
import {
  BEATS_PER_BAR,
  MAX_BAR_EVENTS,
  type NoteEvent,
  createComposer,
  layerLevel,
} from '../../src/audio/Composer';
import { INSTRUMENT_IDS, LAYER_THRESHOLDS } from '../../src/audio/instrumentIds';
import { keyRoot } from '../../src/audio/theory';

const MOODS: readonly MusicMood[] = [
  'silent',
  'menu',
  'select',
  'combat',
  'boss',
  'shop',
  'paused',
  'gameover',
  'victory',
];

function render(
  seed: number,
  bars: number,
  mood: MusicMood,
  intensity: number,
  sector: 1 | 2 | 3 = 1,
): NoteEvent[][] {
  const c = createComposer(KERNEL_PANIC, seed);
  c.setSector(sector);
  const out: NoteEvent[] = [];
  const res: NoteEvent[][] = [];
  for (let b = 0; b < bars; b++) {
    const n = c.bar(b, mood, intensity, out);
    res.push(out.slice(0, n).map((e) => ({ ...e })));
  }
  return res;
}

function instruments(bars: NoteEvent[][]): Set<string> {
  const s = new Set<string>();
  for (const bar of bars) for (const e of bar) s.add(e.instrument);
  return s;
}

describe('Composer', () => {
  it('is deterministic per seed', () => {
    for (const mood of MOODS) {
      expect(render(1234, 8, mood, 0.8)).toEqual(render(1234, 8, mood, 0.8));
    }
    expect(render(1, 16, 'combat', 0.9)).not.toEqual(render(2, 16, 'combat', 0.9));
  });

  it('bar(i) is a pure function of its inputs (order independent)', () => {
    const c = createComposer(KERNEL_PANIC, 99);
    const out: NoteEvent[] = [];
    const n5 = c.bar(5, 'combat', 0.8, out);
    const first = out.slice(0, n5).map((e) => ({ ...e }));
    c.bar(2, 'boss', 0.3, out);
    c.bar(11, 'shop', 0.5, out);
    const again = c.bar(5, 'combat', 0.8, out);
    expect(out.slice(0, again).map((e) => ({ ...e }))).toEqual(first);
  });

  it('reuses the out structs (no growth after the first bar)', () => {
    const c = createComposer(KERNEL_PANIC, 5);
    const out: NoteEvent[] = [];
    c.bar(0, 'boss', 1, out);
    const len = out.length;
    const firstRef = out[0];
    for (let b = 1; b < 32; b++) c.bar(b, 'boss', 1, out);
    expect(out[0]).toBe(firstRef);
    expect(out.length).toBeLessThanOrEqual(Math.max(len, MAX_BAR_EVENTS));
  });

  it('layers respect intensity', () => {
    const low = instruments(render(7, 8, 'combat', 0.1));
    expect([...low]).toEqual(['pad']);
    const mid = instruments(render(7, 8, 'combat', 0.35));
    expect(mid.has('bass')).toBe(true);
    expect(mid.has('kick')).toBe(true);
    expect(mid.has('hat')).toBe(true);
    expect(mid.has('snare')).toBe(false);
    expect(mid.has('arp')).toBe(false);
    expect(mid.has('lead')).toBe(false);
    const seven = instruments(render(7, 16, 'combat', 0.7));
    expect(seven.has('arp')).toBe(true);
    expect(seven.has('snare')).toBe(true);
    expect(seven.has('lead')).toBe(false);
    const high = instruments(render(7, 16, 'combat', 0.9));
    expect(high.has('lead')).toBe(true);
    for (let x = 0; x <= 1.0001; x += 0.05) {
      const set = instruments(render(3, 4, 'combat', x));
      for (const id of INSTRUMENT_IDS) {
        if (!set.has(id)) continue;
        if (id === 'lead') expect(x).toBeGreaterThan(LAYER_THRESHOLDS.lead);
        else expect(x).toBeGreaterThanOrEqual(LAYER_THRESHOLDS[id] - 1e-9);
      }
    }
  });

  it('layer velocity grows with intensity (cross-fade)', () => {
    expect(layerLevel('arp', 0.49)).toBe(0);
    expect(layerLevel('arp', 0.5)).toBeGreaterThan(0);
    expect(layerLevel('arp', 0.9)).toBeGreaterThan(layerLevel('arp', 0.52));
    expect(layerLevel('lead', 0.7)).toBe(0);
    expect(layerLevel('pad', 0)).toBe(1);
  });

  it('notes are well-formed', () => {
    for (const mood of MOODS) {
      for (const bar of render(42, 8, mood, 1, 3)) {
        expect(bar.length).toBeLessThanOrEqual(MAX_BAR_EVENTS);
        for (const e of bar) {
          expect(INSTRUMENT_IDS).toContain(e.instrument);
          expect(e.startBeat).toBeGreaterThanOrEqual(0);
          expect(e.startBeat).toBeLessThan(BEATS_PER_BAR);
          expect(e.lengthBeats).toBeGreaterThan(0);
          expect(e.velocity).toBeGreaterThan(0);
          expect(e.velocity).toBeLessThanOrEqual(1);
          expect(Number.isInteger(e.midi)).toBe(true);
          expect(e.midi).toBeGreaterThanOrEqual(24);
          expect(e.midi).toBeLessThanOrEqual(96);
        }
      }
    }
  });

  it('silent writes nothing; mood variants differ', () => {
    expect(render(1, 4, 'silent', 1).every((b) => b.length === 0)).toBe(true);
    const shop = instruments(render(1, 8, 'shop', 1));
    expect(shop.has('kick')).toBe(false);
    expect(shop.has('lead')).toBe(false);
    expect(shop.has('pad')).toBe(true);
    const boss = instruments(render(1, 8, 'boss', 0));
    expect(boss.has('distBass')).toBe(true);
    expect(boss.has('bass')).toBe(false);
    expect(boss.has('kick')).toBe(true);
    const paused = instruments(render(1, 4, 'paused', 1));
    expect([...paused]).toEqual(['pad']);
    const over = instruments(render(1, 4, 'gameover', 1));
    expect(over.has('kick')).toBe(false);
    expect(instruments(render(1, 8, 'victory', 0)).has('lead')).toBe(true);
    // Shop pads are 4-note (7th) chords.
    const shopBar = render(1, 1, 'shop', 1)[0]!;
    expect(shopBar.filter((e) => e.instrument === 'pad')).toHaveLength(4);
  });

  it('follows the i-VI-III-VII progression in the sector key, boss up a key', () => {
    const roots = (bars: NoteEvent[][]): number[] =>
      bars.map(
        (b) =>
          Math.min(
            ...b.filter((e) => e.instrument === 'bass' || e.instrument === 'distBass').map((e) => e.midi),
          ) % 12,
      );
    const a = keyRoot(KERNEL_PANIC, 1, false);
    expect(roots(render(3, 4, 'combat', 0.5, 1))).toEqual([
      a % 12,
      (a + 8) % 12,
      (a + 3) % 12,
      (a + 10) % 12,
    ]);
    const c = keyRoot(KERNEL_PANIC, 2, false);
    expect(roots(render(3, 1, 'combat', 0.5, 2))[0]).toBe(c % 12);
    const bossKey = keyRoot(KERNEL_PANIC, 3, true);
    expect(roots(render(3, 1, 'boss', 0.5, 3))[0]).toBe(bossKey % 12);
  });

  it('handles non-finite intensity and negative bar indices', () => {
    const c = createComposer(KERNEL_PANIC, 1);
    const out: NoteEvent[] = [];
    expect(c.bar(-3, 'combat', Number.NaN, out)).toBeGreaterThan(0);
    expect(c.sector).toBe(1);
  });
});

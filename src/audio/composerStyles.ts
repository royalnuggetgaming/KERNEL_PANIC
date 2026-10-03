/**
 * Theme-specific arrangement writers for the Composer (selected by ThemeAudio.timbre). 'synthwave' keeps the
 * Composer's own patterns; 'abyssal' (ABYSSAL LIGHT) plays held drones, a soft heartbeat kick, half-time snare and
 * sparse sonar pings; 'industrial' (EMBERFALL) plays chugging 16th distorted-saw bass, four-on-the-floor kicks with
 * pickups, ghost snares and constant noise percussion. Every writer is pure over the injected seeded RNG, so a bar
 * stays a function of (seed, index, mood, intensity, sector).
 */
import type { ThemeAudio } from '../contracts/theme';
import { saturate } from '../core/math';
import { type InstrumentId, LAYER_FADE, LAYER_THRESHOLDS } from './instrumentIds';

export type MusicStyle = ThemeAudio['timbre'];

/** What a style writer may use from the Composer (its emitter, seeded RNG and arrangement). */
export interface StyleWriter {
  readonly x: number;
  readonly boss: boolean;
  emit(inst: InstrumentId, midi: number, start: number, len: number, vel: number): void;
  seedRng(bar: number, salt: number): void;
  rand(): number;
}

const KICK = 36;
const SNARE = 38;
const HAT = 42;
/** Industrial bass chug: 1 = a 16th hit (two bars of variation, read MSB first). */
const CHUG: readonly number[] = [0b1011101011011010, 0b1011101010110111];

/** Velocity multiplier of a layer at intensity x; 0 when the layer is gated off. */
export function layerLevel(inst: InstrumentId, x: number): number {
  const thr = LAYER_THRESHOLDS[inst];
  if (inst === 'lead' ? x <= thr : x < thr) return 0;
  if (thr === 0) return 1;
  return 0.45 + 0.55 * saturate((x - thr) / LAYER_FADE);
}

/** Bass for the non-boss, non-lounge arrangement. Returns false when the Composer's default applies. */
export function styledBass(w: StyleWriter, style: MusicStyle, root: number, bar: number): boolean {
  if (style === 'synthwave' || w.boss) return false;
  const lvl = layerLevel('bass', w.x);
  if (lvl === 0) return true;
  if (style === 'abyssal') {
    // A held drone on the root with a swelling fifth; a slow pulse joins at high intensity.
    w.emit('bass', root, 0, 4, 0.55 * lvl);
    if (bar % 2 === 1) w.emit('bass', root + 7, 2, 2, 0.3 * lvl);
    if (w.x >= 0.6) for (let q = 1; q < 4; q++) w.emit('bass', root, q, 0.6, 0.28 * lvl);
    return true;
  }
  const mask = w.x < 0.3 ? 0b1000100010001000 : CHUG[bar % 2]!;
  for (let s = 0; s < 16; s++) {
    if (((mask >> (15 - s)) & 1) === 0) continue;
    const up = s === 14 && w.x >= 0.6;
    w.emit('bass', up ? root + 12 : root, s * 0.25, 0.2, (s % 4 === 0 ? 0.8 : 0.55) * lvl);
  }
  return true;
}

/** Kick, snare and hats for the non-lounge arrangement. Returns false when the Composer's default applies. */
export function styledDrums(w: StyleWriter, style: MusicStyle, bar: number): boolean {
  if (style === 'synthwave') return false;
  const k = layerLevel('kick', w.x);
  const sn = layerLevel('snare', w.x);
  const h = layerLevel('hat', w.x);
  w.seedRng(bar, 23);
  if (style === 'abyssal') {
    // Heartbeat kick (lub-dub), half-time soft snare on 3, sparse shaker.
    if (k > 0) {
      w.emit('kick', KICK, 0, 0.5, 0.75 * k);
      w.emit('kick', KICK, 0.4, 0.4, 0.45 * k);
      if (w.x >= 0.6 || w.boss) {
        w.emit('kick', KICK, 2, 0.5, 0.65 * k);
        w.emit('kick', KICK, 2.4, 0.4, 0.4 * k);
      }
    }
    if (sn > 0) w.emit('snare', SNARE, 2, 0.6, 0.55 * sn);
    if (h > 0) {
      const steps = w.x >= 0.6 ? 8 : 4;
      for (let s = 0; s < steps; s++) {
        if (w.rand() < 0.35) continue;
        w.emit('hat', HAT, s * (4 / steps) + (steps === 4 ? 0.5 : 0), 0.2, (0.3 + w.rand() * 0.15) * h);
      }
    }
    return true;
  }
  // Industrial: four on the floor with 16th pickups, backbeat with ghosts, constant 16th noise percussion.
  if (k > 0) {
    for (let q = 0; q < 4; q++) w.emit('kick', KICK, q, 0.4, (q === 0 ? 1 : 0.85) * k);
    if (w.x >= 0.55 || w.boss) {
      w.emit('kick', KICK, 1.75, 0.3, 0.55 * k);
      if (w.rand() < 0.5) w.emit('kick', KICK, 3.75, 0.3, 0.5 * k);
    }
  }
  if (sn > 0) {
    w.emit('snare', SNARE, 1, 0.4, 0.85 * sn);
    w.emit('snare', SNARE, 3, 0.4, 0.9 * sn);
    for (let s = 0; s < 16; s++) {
      if (s % 4 === 0 || w.rand() > 0.16) continue;
      w.emit('snare', SNARE, s * 0.25, 0.15, 0.25 * sn);
    }
  }
  if (h > 0) {
    for (let s = 0; s < 16; s++) {
      const accent = s % 4 === 2 ? 0.65 : s % 2 === 1 ? 0.45 : 0.3;
      w.emit('hat', HAT, s * 0.25, s % 4 === 2 ? 0.22 : 0.07, (accent + w.rand() * 0.08) * h);
    }
  }
  return true;
}

/** Abyssal arpeggio: 2-4 long, high sonar pings per bar instead of the gated FM arpeggio. */
export function styledArp(
  w: StyleWriter,
  style: MusicStyle,
  base: number,
  tones: Float64Array,
  bar: number,
): boolean {
  if (style !== 'abyssal') return false;
  const lvl = layerLevel('arp', w.x);
  if (lvl === 0) return true;
  w.seedRng(bar, 29);
  const pings = 2 + Math.floor(w.rand() * (w.x >= 0.7 ? 3 : 2));
  for (let i = 0; i < pings; i++) {
    const ti = Math.floor(w.rand() * 3);
    const start = Math.floor(w.rand() * 8) * 0.5;
    w.emit('arp', base + 12 + tones[ti]! - tones[0]!, start, 1.5, (0.32 + w.rand() * 0.1) * lvl);
  }
  return true;
}

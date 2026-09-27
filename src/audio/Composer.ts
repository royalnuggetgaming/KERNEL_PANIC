/**
 * Seeded, pure music composer (plan section 2): per-bar patterns for pad, sub bass, FM arpeggio, 808 kit and
 * square lead, gated by intensity layers, with mood variants. bar() is a pure function of
 * (seed, index, mood, intensity, sector): the same inputs always produce the same notes.
 */
import type { MusicMood } from '../contracts/audio';
import type { ThemeDef } from '../contracts/theme';
import { clamp, saturate } from '../core/math';
import { type InstrumentId, LAYER_FADE, LAYER_THRESHOLDS } from './instrumentIds';
import { SCALES, chordTones, foldIntoOctave, keyRoot } from './theory';

export interface NoteEvent {
  instrument: string;
  midi: number;
  /** Beat offset inside the bar, [0, BEATS_PER_BAR). */
  startBeat: number;
  lengthBeats: number;
  /** 0..1. */
  velocity: number;
}

export interface Composer {
  /** Writes the bar's notes into out[0..n) (reusing existing structs) and returns n. */
  bar(index: number, mood: MusicMood, intensity: number, out: NoteEvent[]): number;
}

export interface SectorComposer extends Composer {
  setSector(s: 1 | 2 | 3): void;
  readonly sector: 1 | 2 | 3;
}

export const BEATS_PER_BAR = 4;
export const MAX_BAR_EVENTS = 112;

const PAD_LO = 55;
const BASS_LO = 33;
const ARP_LO = 60;
const LEAD_LO = 69;
const KICK_MIDI = 36;
const SNARE_MIDI = 38;
const HAT_MIDI = 42;

/** Arrangement derived from the mood. */
interface Arrangement {
  x: number;
  boss: boolean;
  lounge: boolean;
  padOnly: boolean;
  padVel: number;
  progShift: number;
  sparseArp: boolean;
}

function hash2(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ b;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Velocity multiplier of a layer at intensity x; 0 when the layer is gated off. */
export function layerLevel(inst: InstrumentId, x: number): number {
  const thr = LAYER_THRESHOLDS[inst];
  if (inst === 'lead' ? x <= thr : x < thr) return 0;
  if (thr === 0) return 1;
  return 0.45 + 0.55 * saturate((x - thr) / LAYER_FADE);
}

class ComposerImpl implements SectorComposer {
  private readonly theme: ThemeDef;
  private readonly seed: number;
  private readonly scale: readonly number[];
  private readonly leadScale: readonly number[];
  private readonly tones = new Float64Array(4);
  private readonly arr: Arrangement = {
    x: 0,
    boss: false,
    lounge: false,
    padOnly: false,
    padVel: 0.5,
    progShift: 0,
    sparseArp: false,
  };
  private rngState = 0;
  private n = 0;
  private out: NoteEvent[] = [];
  sector: 1 | 2 | 3 = 1;

  constructor(theme: ThemeDef, seed: number) {
    this.theme = theme;
    this.seed = seed >>> 0;
    this.scale = SCALES[theme.audio.mode];
    // "A minor/Dorian": melodies borrow the Dorian raised sixth over the minor harmony.
    this.leadScale = theme.audio.mode === 'aeolian' ? SCALES.dorian : this.scale;
  }

  setSector(s: 1 | 2 | 3): void {
    this.sector = s;
  }

  bar(index: number, mood: MusicMood, intensity: number, out: NoteEvent[]): number {
    this.out = out;
    this.n = 0;
    if (!this.arrange(mood, intensity)) return 0;
    const a = this.arr;
    const prog = this.theme.audio.progression;
    const len = prog.length;
    const barIdx = Math.max(0, Math.floor(index));
    let pi = (barIdx + a.progShift) % len;
    // Game over: a sparse lament that only rocks between i and VI.
    if (mood === 'gameover') pi = barIdx % 2 === 0 ? 0 : Math.min(1, len - 1);
    const rootOffset = prog[pi]!;
    const key = keyRoot(this.theme, this.sector, a.boss);
    const chordSize = a.lounge ? 4 : 3;
    chordTones(this.scale, rootOffset, chordSize, this.tones);

    this.seedRng(barIdx, 1);
    this.writePad(key, chordSize);
    if (a.padOnly) {
      if (mood === 'gameover') this.emit('bass', foldIntoOctave(key + rootOffset, BASS_LO), 0, 4, 0.35);
      return this.n;
    }
    this.writeBass(key + rootOffset, barIdx);
    if (!a.lounge) {
      this.writeKick(barIdx);
      this.writeSnare(barIdx);
    } else {
      this.writeLoungeSnare();
    }
    this.writeHats(barIdx);
    this.writeArp(key, barIdx);
    if (!a.lounge) this.writeLead(key, rootOffset, barIdx);
    return this.n;
  }

  private arrange(mood: MusicMood, intensity: number): boolean {
    const a = this.arr;
    const x = clamp(Number.isFinite(intensity) ? intensity : 0, 0, 1);
    a.boss = false;
    a.lounge = false;
    a.padOnly = false;
    a.padVel = 0.5;
    a.progShift = 0;
    a.sparseArp = false;
    switch (mood) {
      case 'silent':
        return false;
      case 'combat':
        a.x = x;
        return true;
      case 'boss':
        a.x = Math.max(x, 0.65);
        a.boss = true;
        return true;
      case 'menu':
        a.x = 0.5;
        a.sparseArp = true;
        a.padVel = 0.55;
        return true;
      case 'select':
        a.x = 0.5;
        return true;
      case 'shop':
        a.x = 0.55;
        a.lounge = true;
        a.sparseArp = true;
        a.padVel = 0.42;
        return true;
      case 'paused':
        a.x = 0;
        a.padOnly = true;
        a.padVel = 0.3;
        return true;
      case 'gameover':
        a.x = 0;
        a.padOnly = true;
        a.padVel = 0.38;
        return true;
      case 'victory':
        a.x = 0.85;
        a.progShift = 2;
        return true;
    }
  }

  private seedRng(bar: number, salt: number): void {
    this.rngState = hash2(hash2(this.seed, bar | 0), salt);
  }

  /** mulberry32 step, [0, 1). */
  private rand(): number {
    this.rngState = (this.rngState + 0x6d2b79f5) | 0;
    let t = this.rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  private emit(inst: InstrumentId, midi: number, start: number, len: number, vel: number): void {
    if (this.n >= MAX_BAR_EVENTS || vel <= 0) return;
    const out = this.out;
    let e = out[this.n];
    if (e === undefined) {
      e = { instrument: inst, midi, startBeat: start, lengthBeats: len, velocity: vel };
      out[this.n] = e;
    } else {
      e.instrument = inst;
      e.midi = midi;
      e.startBeat = start;
      e.lengthBeats = len;
      e.velocity = vel;
    }
    this.n++;
  }

  private writePad(key: number, size: number): void {
    const vel = this.arr.padVel * layerLevel('pad', this.arr.x);
    for (let i = 0; i < size; i++) {
      this.emit('pad', foldIntoOctave(key + this.tones[i]!, PAD_LO), 0, BEATS_PER_BAR, vel);
    }
  }

  private writeBass(rootMidi: number, bar: number): void {
    const a = this.arr;
    const inst: InstrumentId = a.boss ? 'distBass' : 'bass';
    const lvl = layerLevel(inst, a.x);
    if (lvl === 0) return;
    const root = foldIntoOctave(rootMidi, BASS_LO);
    if (a.lounge) {
      // Lounge walk: root on 1, fifth on 3, a scale passing tone into the next bar.
      this.emit(inst, root, 0, 1.6, 0.55 * lvl);
      this.emit(inst, root + 7, 2, 1.2, 0.45 * lvl);
      this.seedRng(bar, 7);
      if (this.rand() < 0.6) this.emit(inst, root + (this.rand() < 0.5 ? 10 : 5), 3.5, 0.45, 0.35 * lvl);
      return;
    }
    if (a.boss) {
      // Driving 16th sub with octave jumps on the off-sixteenths.
      for (let s = 0; s < 16; s++) {
        const up = s % 4 === 2;
        this.emit(inst, up ? root + 12 : root, s * 0.25, 0.2, (s % 4 === 0 ? 0.8 : 0.55) * lvl);
      }
      return;
    }
    if (a.x < 0.3) {
      for (let q = 0; q < 4; q++) this.emit(inst, root, q, 0.9, (q === 0 ? 0.6 : 0.45) * lvl);
      return;
    }
    // Octave-pulse eighths.
    for (let e = 0; e < 8; e++) {
      this.emit(inst, e % 2 === 0 ? root : root + 12, e * 0.5, 0.42, (e % 2 === 0 ? 0.75 : 0.5) * lvl);
    }
  }

  private writeKick(bar: number): void {
    const a = this.arr;
    const lvl = layerLevel('kick', a.x);
    if (lvl === 0) return;
    this.seedRng(bar, 3);
    if (a.x < 0.55) {
      this.emit('kick', KICK_MIDI, 0, 0.5, 0.9 * lvl);
      this.emit('kick', KICK_MIDI, 2, 0.5, 0.8 * lvl);
      if (this.rand() < 0.35) this.emit('kick', KICK_MIDI, 2.75, 0.4, 0.55 * lvl);
      return;
    }
    for (let q = 0; q < 4; q++) this.emit('kick', KICK_MIDI, q, 0.5, (q === 0 ? 1 : 0.88) * lvl);
    if (a.boss && this.rand() < 0.5) this.emit('kick', KICK_MIDI, 3.5, 0.4, 0.6 * lvl);
  }

  private writeSnare(bar: number): void {
    const a = this.arr;
    const lvl = layerLevel('snare', a.x);
    if (lvl === 0) return;
    this.emit('snare', SNARE_MIDI, 1, 0.5, 0.8 * lvl);
    this.emit('snare', SNARE_MIDI, 3, 0.5, 0.85 * lvl);
    if (bar % 4 === 3 && a.x >= 0.6) {
      for (let s = 13; s < 16; s++)
        this.emit('snare', SNARE_MIDI, s * 0.25, 0.2, (0.35 + (s - 13) * 0.15) * lvl);
    }
  }

  private writeLoungeSnare(): void {
    const lvl = layerLevel('snare', this.arr.x);
    if (lvl === 0) return;
    this.emit('snare', SNARE_MIDI, 3, 0.3, 0.3 * lvl);
  }

  private writeHats(bar: number): void {
    const a = this.arr;
    const lvl = layerLevel('hat', a.x);
    if (lvl === 0) return;
    this.seedRng(bar, 5);
    if (a.lounge) {
      // Swung eighths (triplet feel).
      for (let q = 0; q < 4; q++) {
        this.emit('hat', HAT_MIDI, q, 0.15, (0.28 + this.rand() * 0.06) * lvl);
        this.emit('hat', HAT_MIDI, q + 2 / 3, 0.1, (0.18 + this.rand() * 0.05) * lvl);
      }
      return;
    }
    if (a.x < 0.6) {
      for (let q = 0; q < 4; q++) this.emit('hat', HAT_MIDI, q + 0.5, 0.12, (0.45 + this.rand() * 0.1) * lvl);
      return;
    }
    for (let s = 0; s < 16; s++) {
      const off = s % 2 === 1 ? 0.62 : 0.32;
      this.emit('hat', HAT_MIDI, s * 0.25, s % 4 === 2 ? 0.2 : 0.08, (off + this.rand() * 0.1) * lvl);
    }
  }

  private writeArp(key: number, bar: number): void {
    const a = this.arr;
    const lvl = layerLevel('arp', a.x);
    if (lvl === 0) return;
    // The pattern shape is fixed per 4-bar phrase so the arpeggio reads as a motif.
    this.seedRng(bar >> 2, 11);
    const shape = Math.floor(this.rand() * 4);
    const octaveLift = this.rand() < 0.5 ? 0 : 12;
    this.seedRng(bar, 13);
    const steps = a.sparseArp ? 8 : 16;
    const stepLen = BEATS_PER_BAR / steps;
    const tones = this.tones;
    for (let s = 0; s < steps; s++) {
      if (a.sparseArp && this.rand() < 0.3) continue;
      let ti: number;
      if (shape === 0) ti = s % 4;
      else if (shape === 1) ti = 3 - (s % 4);
      else if (shape === 2) ti = s % 6 < 4 ? s % 6 : 6 - (s % 6);
      else ti = Math.floor(this.rand() * 4);
      const semis = ti === 3 ? tones[0]! + 12 : tones[ti]!;
      const midi = foldIntoOctave(key + tones[0]!, ARP_LO) + (semis - tones[0]!) + octaveLift;
      const accent = s % 4 === 0 ? 0.42 : 0.3;
      this.emit('arp', midi, s * stepLen, stepLen * 0.55, accent * lvl);
    }
  }

  private writeLead(key: number, rootOffset: number, bar: number): void {
    const lvl = layerLevel('lead', this.arr.x);
    if (lvl === 0) return;
    // Call (even bar) and answer (odd bar) share a 2-bar phrase seed.
    this.seedRng(bar >> 1, 17);
    const scale = this.leadScale;
    let deg = Math.floor(this.rand() * 5);
    const answer = (bar & 1) === 1;
    this.seedRng(bar, answer ? 19 : 17);
    const base = foldIntoOctave(key, LEAD_LO);
    let e = 0;
    while (e < 8) {
      const hold = this.rand() < 0.35 ? 2 : 1;
      if (this.rand() < 0.62 || e === 0) {
        const step = Math.floor(this.rand() * 5) - 2;
        deg = clamp(deg + step, 0, 9);
        let semis = this.degreeSemis(scale, deg);
        if (answer && e + hold >= 7) semis = rootOffset % 12;
        this.emit('lead', base + semis, e * 0.5, hold * 0.5 * 0.9, (e === 0 ? 0.5 : 0.42) * lvl);
      }
      e += hold;
    }
  }

  private degreeSemis(scale: readonly number[], deg: number): number {
    const n = scale.length;
    return scale[deg % n]! + 12 * Math.floor(deg / n);
  }
}

/** Seeded composer for a theme (key, mode, progression and tempo come from theme.audio). */
export function createComposer(theme: ThemeDef, seed: number): SectorComposer {
  return new ComposerImpl(theme, seed);
}

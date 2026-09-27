/** SFX recipes for player moves, specials, wave/boss stingers and UI (plan section 8, sfxRecipes). */
import { crunch, fmVoice, mixGain, noiseBurst, tone } from './synth';
import { type SfxRecipe, blips, chime, thump, whoosh, zap } from './sfxRecipeKit';

const DRONE_NOTES: readonly number[] = [783.99, 987.77, 1174.66];
const REVIVE_NOTES: readonly number[] = [440, 523.25, 659.25, 880];
const KERNEL_NOTES: readonly number[] = [440, 523.25, 659.25];
const CLEAR_NOTES: readonly number[] = [523.25, 659.25, 783.99, 1046.5, 1318.5];
const WIN_NOTES: readonly number[] = [523.25, 659.25, 783.99];
const WIN_HIGH: readonly number[] = [1046.5];
const ALARM: readonly number[] = [880, 880];
const UI_MOVE: readonly number[] = [1200];
const UI_CONFIRM: readonly number[] = [880, 1320];
const UI_BACK: readonly number[] = [880, 587.33];
const UI_BUY: readonly number[] = [987.77, 1318.5];
const UI_DENY: readonly number[] = [196, 196];

export const EVENT_RECIPES = {
  dash: {
    category: 'player',
    duration: 0.3,
    gain: 0.5,
    build(r) {
      whoosh(r, 0, 600, 3200, 0.03, 0.2, 0.45);
      tone(r.ctx, r.out, 'sine', 0, 200 * r.pitch, 520 * r.pitch, 0.15, 0.18, 0.005, 0.18);
    },
  },
  railburst: {
    category: 'player',
    duration: 0.8,
    gain: 0.75,
    build(r) {
      tone(r.ctx, r.out, 'sawtooth', 0, 200 * r.pitch, 2200 * r.pitch, 0.08, 0.15, 0.01, 0.07);
      zap(r, 0.08, 2600, 180, 0.45, 0.35, 0.5);
      noiseBurst(r.ctx, r.out, r.noise('white'), 0.08, 'highpass', 5200, 2000, 0.7, 0.2, 0.002, 0.3);
      thump(r, 0.08, 160 * r.pitch, 40, 0.5, 0.3);
    },
  },
  firewall: {
    category: 'player',
    duration: 1.1,
    gain: 0.6,
    build(r) {
      fmVoice(r.ctx, r.out, 0, 0.9 * r.timbre.decay, 220 * r.pitch, 1.5, 2, 0.25, 'sawtooth');
      whoosh(r, 0, 300, 1800, 0.15, 0.8, 0.35);
      tone(r.ctx, r.out, 'triangle', 0, 110 * r.pitch, 220 * r.pitch, 0.2, 0.2, 0.05, 0.8);
    },
  },
  blink: {
    category: 'player',
    duration: 0.55,
    gain: 0.55,
    build(r) {
      tone(r.ctx, r.out, 'sine', 0, 1800 * r.pitch, 300 * r.pitch, 0.12, 0.25, 0.002, 0.12);
      tone(r.ctx, r.out, 'sine', 0.15, 300 * r.pitch, 1800 * r.pitch, 0.12, 0.2, 0.002, 0.14);
      fmVoice(r.ctx, r.out, 0.1, 0.3 * r.timbre.decay, 2600 * r.pitch, 3.5, 1.2, 0.12);
    },
  },
  patchDrone: {
    category: 'player',
    duration: 0.85,
    gain: 0.55,
    build(r) {
      blips(r, 'triangle', 0, DRONE_NOTES, 0.09, 0.2, 0.3);
      const filt = r.ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 900 * r.timbre.brightness;
      filt.connect(r.out);
      tone(r.ctx, filt, 'sawtooth', 0, 110 * r.pitch, 112 * r.pitch, 0.5, 0.15, 0.08, 0.6);
    },
  },
  hurt: {
    category: 'player',
    duration: 0.35,
    gain: 0.6,
    build(r) {
      const drive = crunch(r.ctx, r.timbre.drive);
      drive.connect(mixGain(r.ctx, r.out, 0.7));
      tone(r.ctx, drive, 'square', 0, 440 * r.pitch, 110 * r.pitch, 0.2, 0.35, 0.002, 0.25);
      noiseBurst(r.ctx, r.out, r.noise('pink'), 0, 'lowpass', 2400, 400, 0.7, 0.3, 0.002, 0.15);
    },
  },
  downed: {
    category: 'player',
    duration: 1.2,
    gain: 0.7,
    build(r) {
      const filt = r.ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.setValueAtTime(3000 * r.timbre.brightness, 0);
      filt.frequency.exponentialRampToValueAtTime(150, 1);
      filt.connect(r.out);
      tone(r.ctx, filt, 'sawtooth', 0, 660 * r.pitch, 55 * r.pitch, 0.9, 0.35, 0.005, 0.95);
      tone(r.ctx, filt, 'square', 0, 655 * r.pitch, 54 * r.pitch, 0.9, 0.15, 0.005, 0.95);
      noiseBurst(r.ctx, r.out, r.noise('brown'), 0, 'lowpass', 1200, 100, 0.7, 0.35, 0.005, 0.6);
    },
  },
  revive: {
    category: 'player',
    duration: 0.95,
    gain: 0.6,
    build(r) {
      blips(r, 'triangle', 0, REVIVE_NOTES, 0.08, 0.24, 0.3 * r.timbre.decay);
      chime(r, 0.32, WIN_HIGH, 0, 0.14, 0.5);
    },
  },
  kernel: {
    category: 'stinger',
    duration: 1.35,
    gain: 0.65,
    build(r) {
      for (let i = 0; i < KERNEL_NOTES.length; i++) {
        fmVoice(r.ctx, r.out, 0, 1.1 * r.timbre.decay, KERNEL_NOTES[i]! * r.pitch, 1, 1.2, 0.14, 'triangle');
      }
      thump(r, 0, 110 * r.pitch, 45, 0.45, 0.4);
      tone(r.ctx, r.out, 'sine', 0.05, 220 * r.pitch, 880 * r.pitch, 0.6, 0.1, 0.1, 0.6);
    },
  },
  waveStart: {
    category: 'stinger',
    duration: 1.15,
    gain: 0.6,
    build(r) {
      blips(r, r.timbre.leadWave, 0, ALARM, 0.24, 0.2, 0.16);
      tone(r.ctx, r.out, r.timbre.laserWave2, 0.5, 220 * r.pitch, 880 * r.pitch, 0.45, 0.16, 0.05, 0.5);
      thump(r, 0.5, 120 * r.pitch, 40, 0.4, 0.35);
    },
  },
  waveClear: {
    category: 'stinger',
    duration: 1.45,
    gain: 0.6,
    build(r) {
      blips(r, r.timbre.leadWave, 0, CLEAR_NOTES, 0.07, 0.16, 0.35 * r.timbre.decay);
      chime(r, 0.35, CLEAR_NOTES, 0.04, 0.08, 0.8);
    },
  },
  bossRoar: {
    category: 'stinger',
    duration: 2.1,
    gain: 0.85,
    build(r) {
      const drive = crunch(r.ctx, Math.min(1, r.timbre.drive + 0.3));
      const filt = r.ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.Q.value = 6;
      filt.frequency.setValueAtTime(200, 0);
      filt.frequency.exponentialRampToValueAtTime(1800 * r.timbre.brightness, 0.6);
      filt.frequency.exponentialRampToValueAtTime(180, 1.9);
      drive.connect(filt);
      filt.connect(mixGain(r.ctx, r.out, 0.6));
      tone(r.ctx, drive, 'sawtooth', 0, 55 * r.pitch, 49 * r.pitch, 1.6, 0.5, 0.15, 1.6);
      tone(r.ctx, drive, 'sawtooth', 0, 58.3 * r.pitch, 51 * r.pitch, 1.6, 0.4, 0.15, 1.6);
      tone(r.ctx, drive, 'square', 0, 82.4 * r.pitch, 73 * r.pitch, 1.6, 0.3, 0.2, 1.5);
      noiseBurst(r.ctx, r.out, r.noise('brown'), 0, 'lowpass', 600, 120, 0.7, 0.3, 0.2, 1.4);
    },
  },
  portal: {
    category: 'stinger',
    duration: 0.7,
    gain: 0.45,
    build(r) {
      whoosh(r, 0, 200, 2400, 0.25, 0.35, 0.35);
      tone(r.ctx, r.out, 'sine', 0, 150 * r.pitch, 600 * r.pitch, 0.5, 0.18, 0.2, 0.35);
    },
  },
  roundWin: {
    category: 'stinger',
    duration: 1.65,
    gain: 0.65,
    build(r) {
      blips(r, r.timbre.leadWave, 0, WIN_NOTES, 0.13, 0.2, 0.18);
      blips(r, r.timbre.leadWave, 0.42, WIN_HIGH, 0, 0.22, 0.9 * r.timbre.decay);
      chime(r, 0.42, WIN_NOTES, 0.02, 0.08, 1);
    },
  },
  uiMove: {
    category: 'ui',
    duration: 0.06,
    gain: 0.4,
    build(r) {
      blips(r, 'square', 0, UI_MOVE, 0, 0.12, 0.03);
    },
  },
  uiConfirm: {
    category: 'ui',
    duration: 0.2,
    gain: 0.45,
    build(r) {
      blips(r, 'square', 0, UI_CONFIRM, 0.06, 0.13, 0.08);
    },
  },
  uiBack: {
    category: 'ui',
    duration: 0.16,
    gain: 0.45,
    build(r) {
      blips(r, 'square', 0, UI_BACK, 0.05, 0.12, 0.07);
    },
  },
  uiBuy: {
    category: 'ui',
    duration: 0.32,
    gain: 0.5,
    build(r) {
      blips(r, 'square', 0, UI_BUY, 0.07, 0.14, 0.2);
      fmVoice(r.ctx, r.out, 0.07, 0.2, 2637 * r.pitch, 2, 1, 0.06);
    },
  },
  uiDeny: {
    category: 'ui',
    duration: 0.24,
    gain: 0.45,
    build(r) {
      blips(r, 'sawtooth', 0, UI_DENY, 0.1, 0.14, 0.07);
    },
  },
} as const satisfies Record<string, SfxRecipe>;

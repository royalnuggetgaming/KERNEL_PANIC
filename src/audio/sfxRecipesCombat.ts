/** SFX recipes for weapons, impacts, explosions and pickups (plan section 8, sfxRecipes). */
import { crunch, fmVoice, mixGain, noiseBurst, tone } from './synth';
import { type SfxRecipe, blips, boom, chime, stutter, thump, zap } from './sfxRecipeKit';

const REPAIR_NOTES: readonly number[] = [523.25, 659.25, 783.99, 1046.5];
const POWER_NOTES: readonly number[] = [880, 1318.5, 1760, 2637];
const SHARD_NOTES: readonly number[] = [1318.5, 1975.5];

export const COMBAT_RECIPES = {
  laser: {
    category: 'weapon',
    duration: 0.18,
    gain: 0.55,
    build(r) {
      zap(r, 0, 1800, 380, 0.11, 0.32, 0.13);
    },
  },
  laserHeavy: {
    category: 'weapon',
    duration: 0.3,
    gain: 0.6,
    build(r) {
      zap(r, 0, 950, 150, 0.18, 0.34, 0.22);
      thump(r, 0, 190 * r.pitch, 55, 0.35, 0.2);
      noiseBurst(r.ctx, r.out, r.noise('white'), 0, 'bandpass', 3200, 700, 1.4, 0.18, 0.002, 0.08);
    },
  },
  needle: {
    category: 'weapon',
    duration: 0.1,
    gain: 0.45,
    build(r) {
      const p = r.pitch;
      tone(r.ctx, r.out, r.timbre.laserWave, 0, 3400 * p, 1700 * p, 0.05, 0.22, 0.001, 0.07);
      noiseBurst(r.ctx, r.out, r.noise('white'), 0, 'highpass', 6000, 4000, 0.7, 0.08, 0.001, 0.03);
    },
  },
  arc: {
    category: 'weapon',
    duration: 0.22,
    gain: 0.5,
    build(r) {
      fmVoice(r.ctx, r.out, 0, 0.16 * r.timbre.decay, 1150 * r.pitch, 3.7, 4, 0.22, 'square');
      noiseBurst(r.ctx, r.out, r.noise('white'), 0, 'bandpass', 4200, 2600, 6, 0.3, 0.001, 0.12);
    },
  },
  enemyShot: {
    category: 'weapon',
    duration: 0.17,
    gain: 0.4,
    build(r) {
      const p = r.pitch;
      tone(r.ctx, r.out, 'triangle', 0, 480 * p, 920 * p, 0.1, 0.3, 0.004, 0.13);
      tone(r.ctx, r.out, 'square', 0, 240 * p, 460 * p, 0.1, 0.07, 0.004, 0.1);
    },
  },
  hit: {
    category: 'impact',
    duration: 0.11,
    gain: 0.5,
    build(r) {
      noiseBurst(r.ctx, r.out, r.noise('white'), 0, 'highpass', 2600, 1400, 0.8, 0.35, 0.001, 0.05);
      tone(r.ctx, r.out, 'square', 0, 320 * r.pitch, 110 * r.pitch, 0.06, 0.18, 0.001, 0.07);
    },
  },
  crit: {
    category: 'impact',
    duration: 0.22,
    gain: 0.55,
    build(r) {
      noiseBurst(r.ctx, r.out, r.noise('white'), 0, 'highpass', 3200, 1800, 0.8, 0.35, 0.001, 0.06);
      tone(r.ctx, r.out, 'square', 0, 420 * r.pitch, 140 * r.pitch, 0.07, 0.2, 0.001, 0.08);
      fmVoice(r.ctx, r.out, 0.01, 0.17 * r.timbre.decay, 1760 * r.pitch, 2, 1.5, 0.22);
    },
  },
  shieldBlock: {
    category: 'impact',
    duration: 0.22,
    gain: 0.5,
    build(r) {
      fmVoice(r.ctx, r.out, 0, 0.18 * r.timbre.decay, 900 * r.pitch, 1.41, 3, 0.3);
      noiseBurst(r.ctx, r.out, r.noise('pink'), 0, 'bandpass', 2400, 1600, 3, 0.2, 0.001, 0.08);
    },
  },
  explodeS: {
    category: 'explosion',
    duration: 0.55,
    gain: 0.7,
    build(r) {
      boom(r, 0, 0.25, 0.55);
    },
  },
  explodeL: {
    category: 'explosion',
    duration: 1.1,
    gain: 0.8,
    build(r) {
      boom(r, 0, 0.7, 0.6);
      // Corrupted (elite) deaths route here: the tail stutters like a corrupted buffer.
      stutter(r, 0.26, 7, 0.045, 0.22);
    },
  },
  explodeBoss: {
    category: 'explosion',
    duration: 2.8,
    gain: 0.95,
    build(r) {
      boom(r, 0, 1, 0.65);
      boom(r, 0.38, 0.8, 0.45);
      const drive = crunch(r.ctx, r.timbre.drive);
      drive.connect(mixGain(r.ctx, r.out, 0.5));
      tone(r.ctx, drive, 'sawtooth', 0, 90 * r.pitch, 28, 1.1, 0.35, 0.01, 1.4 * r.timbre.decay);
      stutter(r, 0.9, 10, 0.06, 0.16);
    },
  },
  shard: {
    category: 'pickup',
    duration: 0.14,
    gain: 0.45,
    build(r) {
      blips(r, 'triangle', 0, SHARD_NOTES, 0.045, 0.24, 0.06);
    },
  },
  repair: {
    category: 'pickup',
    duration: 0.6,
    gain: 0.55,
    build(r) {
      blips(r, 'triangle', 0, REPAIR_NOTES, 0.075, 0.24, 0.16 * r.timbre.decay);
      tone(r.ctx, r.out, 'sine', 0, 262 * r.pitch, 523 * r.pitch, 0.3, 0.12, 0.05, 0.3);
    },
  },
  powerUp: {
    category: 'pickup',
    duration: 0.85,
    gain: 0.6,
    build(r) {
      chime(r, 0, POWER_NOTES, 0.06, 0.2, 0.6);
      tone(r.ctx, r.out, 'sine', 0, 440 * r.pitch, 1760 * r.pitch, 0.35, 0.1, 0.02, 0.35);
    },
  },
  sync: {
    category: 'pickup',
    duration: 0.6,
    gain: 0.6,
    build(r) {
      fmVoice(r.ctx, r.out, 0, 0.45 * r.timbre.decay, 660 * r.pitch, 2, 1.8, 0.2);
      fmVoice(r.ctx, r.out, 0, 0.45 * r.timbre.decay, 990 * r.pitch, 2, 1.8, 0.18);
      tone(r.ctx, r.out, 'sine', 0, 400 * r.pitch, 1600 * r.pitch, 0.25, 0.12, 0.01, 0.3);
    },
  },
} as const satisfies Record<string, SfxRecipe>;

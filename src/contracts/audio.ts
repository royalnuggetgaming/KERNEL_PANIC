/**
 * Audio port. Every sound and all music are synthesized with Web Audio. FROZEN after Wave 0.
 */
import type { SimEvents } from './simEvents';

export const SFX_IDS = [
  'laser',
  'laserHeavy',
  'needle',
  'arc',
  'enemyShot',
  'hit',
  'crit',
  'shieldBlock',
  'explodeS',
  'explodeL',
  'explodeBoss',
  'shard',
  'repair',
  'powerUp',
  'dash',
  'railburst',
  'firewall',
  'blink',
  'patchDrone',
  'hurt',
  'downed',
  'revive',
  'kernel',
  'waveStart',
  'waveClear',
  'bossRoar',
  'portal',
  'sync',
  'roundWin',
  'uiMove',
  'uiConfirm',
  'uiBack',
  'uiBuy',
  'uiDeny',
] as const;
export type SfxId = (typeof SFX_IDS)[number];

export type SfxCategory = 'weapon' | 'impact' | 'explosion' | 'pickup' | 'player' | 'ui' | 'stinger';

export type MusicMood =
  'silent' | 'menu' | 'select' | 'combat' | 'boss' | 'shop' | 'paused' | 'gameover' | 'victory';

export interface AudioStats {
  readonly voices: number;
  readonly stolen: number;
  readonly coalesced: number;
  readonly ctxState: string;
}

export interface AudioPort {
  /** Idempotent; must be called from a user gesture. Pre-renders the SFX bank. */
  unlock(): Promise<void>;
  readonly unlocked: boolean;
  /** No-op before unlock. pan in [-1, 1], gain multiplier, detune in cents. Positional args: no allocation. */
  play(id: SfxId, pan?: number, gain?: number, detuneCents?: number): void;
  /** Maps SimEvents to sounds (AudioEventRouter). Read-only: does not clear channels. */
  consumeEvents(e: SimEvents): void;
  setMood(m: MusicMood): void;
  /** 0..1 music intensity (layers cross-fade). */
  setIntensity(x: number): void;
  setSector(s: 1 | 2 | 3): void;
  /** Pause/shop duck: low-pass 700 Hz, -9 dB. */
  duck(on: boolean): void;
  setVolumes(master: number, music: number, sfx: number): void;
  /** 0..1 phase within the current beat, derived from the audio clock (drives shaders). */
  readonly beatPhase: number;
  suspend(): Promise<void>;
  resume(): Promise<void>;
  stats(): AudioStats;
}

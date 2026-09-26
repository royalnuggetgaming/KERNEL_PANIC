/**
 * Maps SimEvents to positional play() calls (plan section 8): pan from the event's x position across the
 * arena, a pickup pitch ladder that climbs with the combo, and louder/heavier variants by power.
 * Allocation-free: indexed loops over the channels, positional arguments only.
 */
import type { AudioPort, SfxId } from '../contracts/audio';
import type { VehicleId } from '../contracts/ids';
import type { PlayerEventKind, SimEvents, WaveEventKind } from '../contracts/simEvents';
import { MINOR_PENTATONIC } from './theory';

export interface AudioEventRouter {
  route(e: SimEvents): void;
}

type PlayFn = AudioPort['play'];

const SHOT_SFX: Readonly<Record<VehicleId, SfxId>> = {
  lancer: 'laser',
  bulwark: 'laserHeavy',
  specter: 'needle',
  tinker: 'arc',
};

/** Pickup ladder length in steps (two octaves of minor pentatonic plus the top tonic). */
export const LADDER_STEPS = MINOR_PENTATONIC.length * 2 + 1;

/** Detune in cents for the pickup pitch ladder at a combo count (climbs the minor pentatonic, then holds). */
export function ladderCents(combo: number): number {
  const c = combo > 0 && Number.isFinite(combo) ? Math.floor(combo) : 0;
  const step = c < LADDER_STEPS - 1 ? c : LADDER_STEPS - 1;
  const n = MINOR_PENTATONIC.length;
  const oct = Math.floor(step / n);
  return (MINOR_PENTATONIC[step - oct * n]! + 12 * oct) * 100;
}

/** Stereo pan in [-1, 1] from a world x coordinate. */
export function panFromX(x: number, halfWidth: number): number {
  if (!(halfWidth > 0) || !Number.isFinite(x)) return 0;
  const p = (x / halfWidth) * 0.85;
  return p < -1 ? -1 : p > 1 ? 1 : p;
}

class Router implements AudioEventRouter {
  private readonly play: PlayFn;
  private readonly half: number;

  constructor(play: PlayFn, arenaHalfWidth: number) {
    this.play = play;
    this.half = arenaHalfWidth;
  }

  route(e: SimEvents): void {
    const half = this.half;
    const play = this.play;

    const shot = e.shot;
    for (let i = 0; i < shot.count; i++) {
      const s = shot.get(i);
      play(SHOT_SFX[s.vehicle], panFromX(s.x, half), 0.8, 0);
    }
    const es = e.enemyShot;
    for (let i = 0; i < es.count; i++) {
      const s = es.get(i);
      play('enemyShot', panFromX(s.x, half), s.boss ? 0.9 : 0.6, s.boss ? -500 : 0);
    }
    const hit = e.hit;
    for (let i = 0; i < hit.count; i++) {
      const h = hit.get(i);
      const pan = panFromX(h.x, half);
      if (h.target === 2) play('shieldBlock', pan, 0.8, 0);
      else if (h.target === 3) play(h.crit ? 'crit' : 'hit', pan, 0.9, -300);
      else if (h.target === 0) play(h.crit ? 'crit' : 'hit', pan, 0.7, 0);
      // target 1 (player) is voiced by the player 'hurt' event.
    }
    const kill = e.kill;
    for (let i = 0; i < kill.count; i++) {
      const k = kill.get(i);
      // Corrupted (elite) kills use the large explosion with its glitch-stutter tail.
      play(k.elite ? 'explodeL' : 'explodeS', panFromX(k.x, half), k.elite ? 1 : 0.8, 0);
    }
    const ex = e.explosion;
    for (let i = 0; i < ex.count; i++) {
      const x = ex.get(i);
      const pw = x.power < 0 ? 0 : x.power > 1 ? 1 : x.power;
      play(pw >= 0.66 ? 'explodeL' : 'explodeS', panFromX(x.x, half), 0.5 + 0.5 * pw, 0);
    }
    const pk = e.pickup;
    for (let i = 0; i < pk.count; i++) {
      const p = pk.get(i);
      play('shard', panFromX(p.x, half), 0.75, ladderCents(p.combo));
    }
    const pl = e.player;
    for (let i = 0; i < pl.count; i++) {
      const p = pl.get(i);
      this.playerEvent(p.what, panFromX(p.x, half));
    }
    const wv = e.wave;
    for (let i = 0; i < wv.count; i++) {
      const w = wv.get(i);
      this.waveEvent(w.what, w.value);
    }
    const tg = e.telegraph;
    for (let i = 0; i < tg.count; i++) {
      const t = tg.get(i);
      if (t.shape === 0) play('portal', panFromX(t.x, half), 0.6, 0);
    }
    const sp = e.special;
    for (let i = 0; i < sp.count; i++) {
      const s = sp.get(i);
      const pan = panFromX(s.x, half);
      switch (s.kind) {
        case 'railburst':
          play('railburst', pan, 1, 0);
          break;
        case 'firewall':
          play('firewall', pan, 1, 0);
          break;
        case 'blinkSwarm':
          play('blink', pan, 1, 0);
          break;
        case 'patchDrone':
          play('patchDrone', pan, 1, 0);
          break;
      }
    }
    const bs = e.boss;
    for (let i = 0; i < bs.count; i++) {
      const b = bs.get(i);
      const pan = panFromX(b.x, half);
      switch (b.what) {
        case 'intro':
          play('bossRoar', pan, 1, 0);
          break;
        case 'phase':
          play('bossRoar', pan, 0.9, 200);
          break;
        case 'enrage':
          play('bossRoar', pan, 1, -500);
          break;
        case 'split':
          play('explodeL', pan, 0.9, 0);
          break;
        case 'respawn':
          play('portal', pan, 0.8, -300);
          break;
        case 'dead':
          play('explodeBoss', pan, 1, 0);
          break;
      }
    }
  }

  private playerEvent(what: PlayerEventKind, pan: number): void {
    const play = this.play;
    switch (what) {
      case 'hurt':
        play('hurt', pan, 0.9, 0);
        break;
      case 'downed':
        play('downed', pan, 1, 0);
        break;
      case 'revived':
        play('revive', pan, 1, 0);
        break;
      case 'offline':
        play('downed', pan, 0.8, -700);
        break;
      case 'kernel':
        play('kernel', 0, 1, 0);
        break;
      case 'dash':
        play('dash', pan, 0.8, 0);
        break;
      case 'special':
        // The special channel carries the kind-specific sound.
        break;
      case 'reboot':
        play('revive', pan, 0.8, 500);
        break;
      case 'heal':
        play('repair', pan, 0.7, 0);
        break;
      case 'shieldBlock':
        play('shieldBlock', pan, 0.9, 200);
        break;
      case 'eliminated':
        play('downed', pan, 1, -1200);
        break;
    }
  }

  private waveEvent(what: WaveEventKind, value: number): void {
    const play = this.play;
    switch (what) {
      case 'countdown':
        play('uiMove', 0, 0.8, value <= 1 ? 700 : 0);
        break;
      case 'start':
      case 'roundStart':
        play('waveStart', 0, 1, 0);
        break;
      case 'purge':
        play('explodeL', 0, 0.7, -200);
        break;
      case 'cleared':
        play('waveClear', 0, 1, 0);
        break;
      case 'bossSpawn':
        play('bossRoar', 0, 1, 0);
        break;
      case 'bossPhase':
        play('bossRoar', 0, 0.9, 200);
        break;
      case 'bossEnrage':
        play('bossRoar', 0, 1, -500);
        break;
      case 'bossDead':
        play('explodeBoss', 0, 1, 0);
        break;
      case 'sync':
        play('sync', 0, 1, 0);
        break;
      case 'comboTier':
        play('powerUp', 0, 0.8, (value > 0 ? value : 0) * 200);
        break;
      case 'roundEnd':
      case 'matchEnd':
        play('roundWin', 0, 1, what === 'matchEnd' ? 0 : -300);
        break;
      case 'suddenDeath':
        play('bossRoar', 0, 0.9, 300);
        break;
    }
  }
}

/** Router that turns a frame's SimEvents into play() calls. Does not clear channels. */
export function createAudioEventRouter(play: AudioPort['play'], arenaHalfWidth: number): AudioEventRouter {
  return new Router(play, arenaHalfWidth);
}

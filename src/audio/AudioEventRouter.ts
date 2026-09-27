/**
 * Maps SimEvents to positional play requests (plan section 8): pan from the event's x position across the
 * arena, a pickup pitch ladder that climbs with the combo, and louder/heavier variants by power.
 * Allocation-free: indexed loops over the channels; each request's pan/gain/detune is written to the sink's
 * Float64Array and only the id crosses the call (a double argument to a call that is not inlined is boxed, and
 * a stress frame routes hundreds of hit events).
 */
import type { AudioPort, SfxId } from '../contracts/audio';
import type { VehicleId } from '../contracts/ids';
import type { PlayerEvent, SimEvents, WaveEvent } from '../contracts/simEvents';
import { MINOR_PENTATONIC } from './theory';

export interface AudioEventRouter {
  route(e: SimEvents): void;
}

type PlayFn = AudioPort['play'];

/** Receives play requests: `req` holds [pan, gain, detuneCents] for the request being made. */
export interface AudioRequestSink {
  readonly req: Float64Array;
  request(id: SfxId): void;
}

/** Adapts a positional play() function to a request sink (tests, simple ports). */
class PlaySink implements AudioRequestSink {
  readonly req = new Float64Array(3);
  private readonly play: PlayFn;

  constructor(play: PlayFn) {
    this.play = play;
  }

  request(id: SfxId): void {
    this.play(id, this.req[0], this.req[1], this.req[2]);
  }
}

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
  private readonly sink: AudioRequestSink;
  private readonly q: Float64Array;
  /** [arena half width]; kept in a typed array so reading it never re-boxes. */
  private readonly half = new Float64Array(1);

  constructor(sink: AudioRequestSink, arenaHalfWidth: number) {
    this.sink = sink;
    this.q = sink.req;
    this.half[0] = arenaHalfWidth;
  }

  /** Requests `id` with q[0] = world x (converted to pan in place, panFromX's arithmetic), q[1] gain, q[2] detune. */
  private at(id: SfxId): void {
    const q = this.q;
    const half = this.half[0]!;
    const x = q[0]!;
    let p = 0;
    if (half > 0 && Number.isFinite(x)) {
      p = (x / half) * 0.85;
      p = p < -1 ? -1 : p > 1 ? 1 : p;
    }
    q[0] = p;
    this.sink.request(id);
  }

  /** at(id) with a literal gain and detune (constants cross the call untouched: nothing is boxed). */
  private play(id: SfxId, gain: number, detune: number): void {
    this.q[1] = gain;
    this.q[2] = detune;
    this.at(id);
  }

  /** Centre-panned request with q[1], q[2] set from literal/integer gain and detune. */
  private fixed(id: SfxId, gain: number, detune: number): void {
    const q = this.q;
    q[0] = 0;
    q[1] = gain;
    q[2] = detune;
    this.sink.request(id);
  }

  route(e: SimEvents): void {
    const q = this.q;

    const shot = e.shot;
    for (let i = 0; i < shot.count; i++) {
      const s = shot.get(i);
      q[0] = s.x;
      this.play(SHOT_SFX[s.vehicle], 0.8, 0);
    }
    const es = e.enemyShot;
    for (let i = 0; i < es.count; i++) {
      const s = es.get(i);
      q[0] = s.x;
      q[1] = s.boss ? 0.9 : 0.6;
      q[2] = s.boss ? -500 : 0;
      this.at('enemyShot');
    }
    const hit = e.hit;
    for (let i = 0; i < hit.count; i++) {
      const h = hit.get(i);
      const x = h.x;
      if (h.target === 2) {
        q[0] = x;
        this.play('shieldBlock', 0.8, 0);
      } else if (h.target === 3) {
        q[0] = x;
        this.play(h.crit ? 'crit' : 'hit', 0.9, -300);
      } else if (h.target === 0) {
        q[0] = x;
        this.play(h.crit ? 'crit' : 'hit', 0.7, 0);
      }
      // target 1 (player) is voiced by the player 'hurt' event.
    }
    const kill = e.kill;
    for (let i = 0; i < kill.count; i++) {
      const k = kill.get(i);
      // Corrupted (elite) kills use the large explosion with its glitch-stutter tail.
      q[0] = k.x;
      q[1] = k.elite ? 1 : 0.8;
      q[2] = 0;
      this.at(k.elite ? 'explodeL' : 'explodeS');
    }
    const ex = e.explosion;
    for (let i = 0; i < ex.count; i++) {
      const x = ex.get(i);
      const pw = x.power < 0 ? 0 : x.power > 1 ? 1 : x.power;
      q[0] = x.x;
      q[1] = 0.5 + 0.5 * pw;
      q[2] = 0;
      this.at(pw >= 0.66 ? 'explodeL' : 'explodeS');
    }
    const pk = e.pickup;
    for (let i = 0; i < pk.count; i++) {
      const p = pk.get(i);
      q[0] = p.x;
      q[1] = 0.75;
      q[2] = ladderCents(p.combo);
      this.at('shard');
    }
    const pl = e.player;
    for (let i = 0; i < pl.count; i++) {
      const p = pl.get(i);
      this.playerEvent(p);
    }
    const wv = e.wave;
    for (let i = 0; i < wv.count; i++) {
      const w = wv.get(i);
      this.waveEvent(w);
    }
    const tg = e.telegraph;
    for (let i = 0; i < tg.count; i++) {
      const t = tg.get(i);
      if (t.shape !== 0) continue;
      q[0] = t.x;
      this.play('portal', 0.6, 0);
    }
    const sp = e.special;
    for (let i = 0; i < sp.count; i++) {
      const s = sp.get(i);
      const x = s.x;
      switch (s.kind) {
        case 'railburst':
          q[0] = x;
          this.play('railburst', 1, 0);
          break;
        case 'firewall':
          q[0] = x;
          this.play('firewall', 1, 0);
          break;
        case 'blinkSwarm':
          q[0] = x;
          this.play('blink', 1, 0);
          break;
        case 'patchDrone':
          q[0] = x;
          this.play('patchDrone', 1, 0);
          break;
      }
    }
    const bs = e.boss;
    for (let i = 0; i < bs.count; i++) {
      const b = bs.get(i);
      const x = b.x;
      switch (b.what) {
        case 'intro':
          q[0] = x;
          this.play('bossRoar', 1, 0);
          break;
        case 'phase':
          q[0] = x;
          this.play('bossRoar', 0.9, 200);
          break;
        case 'enrage':
          q[0] = x;
          this.play('bossRoar', 1, -500);
          break;
        case 'split':
          q[0] = x;
          this.play('explodeL', 0.9, 0);
          break;
        case 'respawn':
          q[0] = x;
          this.play('portal', 0.8, -300);
          break;
        case 'dead':
          q[0] = x;
          this.play('explodeBoss', 1, 0);
          break;
      }
    }
  }

  private playerEvent(p: Readonly<PlayerEvent>): void {
    const q = this.q;
    const x = p.x;
    switch (p.what) {
      case 'hurt':
        q[0] = x;
        this.play('hurt', 0.9, 0);
        break;
      case 'downed':
        q[0] = x;
        this.play('downed', 1, 0);
        break;
      case 'revived':
        q[0] = x;
        this.play('revive', 1, 0);
        break;
      case 'offline':
        q[0] = x;
        this.play('downed', 0.8, -700);
        break;
      case 'kernel':
        this.fixed('kernel', 1, 0);
        break;
      case 'dash':
        q[0] = x;
        this.play('dash', 0.8, 0);
        break;
      case 'special':
        // The special channel carries the kind-specific sound.
        break;
      case 'reboot':
        q[0] = x;
        this.play('revive', 0.8, 500);
        break;
      case 'heal':
        q[0] = x;
        this.play('repair', 0.7, 0);
        break;
      case 'shieldBlock':
        q[0] = x;
        this.play('shieldBlock', 0.9, 200);
        break;
      case 'eliminated':
        q[0] = x;
        this.play('downed', 1, -1200);
        break;
    }
  }

  private waveEvent(w: Readonly<WaveEvent>): void {
    const q = this.q;
    const value = w.value;
    const what = w.what;
    q[0] = 0;
    switch (what) {
      case 'countdown':
        q[1] = 0.8;
        q[2] = value <= 1 ? 700 : 0;
        this.sink.request('uiMove');
        break;
      case 'start':
      case 'roundStart':
        this.fixed('waveStart', 1, 0);
        break;
      case 'purge':
        this.fixed('explodeL', 0.7, -200);
        break;
      case 'cleared':
        this.fixed('waveClear', 1, 0);
        break;
      case 'bossSpawn':
        this.fixed('bossRoar', 1, 0);
        break;
      case 'bossPhase':
        this.fixed('bossRoar', 0.9, 200);
        break;
      case 'bossEnrage':
        this.fixed('bossRoar', 1, -500);
        break;
      case 'bossDead':
        this.fixed('explodeBoss', 1, 0);
        break;
      case 'sync':
        this.fixed('sync', 1, 0);
        break;
      case 'comboTier':
        q[1] = 0.8;
        q[2] = (value > 0 ? value : 0) * 200;
        this.sink.request('powerUp');
        break;
      case 'roundEnd':
      case 'matchEnd':
        q[1] = 1;
        q[2] = what === 'matchEnd' ? 0 : -300;
        this.sink.request('roundWin');
        break;
      case 'suddenDeath':
        this.fixed('bossRoar', 0.9, 300);
        break;
    }
  }
}

/** Router that turns a frame's SimEvents into play() calls. Does not clear channels. */
export function createAudioEventRouter(play: AudioPort['play'], arenaHalfWidth: number): AudioEventRouter {
  return new Router(new PlaySink(play), arenaHalfWidth);
}

/** Router that turns a frame's SimEvents into sink requests (no doubles cross a call). Does not clear channels. */
export function createAudioRequestRouter(sink: AudioRequestSink, arenaHalfWidth: number): AudioEventRouter {
  return new Router(sink, arenaHalfWidth);
}

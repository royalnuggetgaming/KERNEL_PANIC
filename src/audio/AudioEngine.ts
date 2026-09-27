/**
 * AudioPort implementation (plan sections 8 and 10): one AudioContext ('interactive'), created and resumed
 * on the first gesture by unlock() (idempotent, survives Safari's 'interrupted' state), a pre-rendered SFX
 * bank played through 32 pooled channel strips, and the procedural music (Composer -> lookahead Sequencer ->
 * MusicGraph). beatPhase comes from ctx.currentTime. play() is a no-op before unlock.
 */
import type { AudioPort, AudioStats, MusicMood, SfxId } from '../contracts/audio';
import type { Logger } from '../contracts/ids';
import type { SimEvents } from '../contracts/simEvents';
import type { ThemeDef } from '../contracts/theme';
import { ARENA } from '../config/tuning';
import { createRng } from '../core/rng';
import { type AudioEventRouter, type AudioRequestSink, createAudioRequestRouter } from './AudioEventRouter';
import { type SectorComposer, createComposer } from './Composer';
import { Mixer } from './Mixer';
import { MusicGraph } from './MusicGraph';
import { type SequencerApi, createSequencer } from './Sequencer';
import { SfxBank, sfxIndex } from './SfxBank';
import { TIMBRES, type TimbrePreset } from './timbre';
import { CATEGORY_LIMITS, VOICE_COUNT, VOICE_IN, VoicePool } from './VoicePool';

/** Interval timer used for the 25 ms scheduler tick (injectable for tests). */
export interface TimerPort {
  setInterval(cb: () => void, ms: number): number;
  clearInterval(id: number): void;
}

export interface AudioEngineDeps {
  readonly theme: ThemeDef;
  readonly createContext: () => AudioContext;
  readonly createOfflineContext: (
    channels: number,
    length: number,
    sampleRate: number,
  ) => OfflineAudioContext;
  readonly log: Logger;
  readonly seed: number;
  /** Defaults to globalThis.setInterval/clearInterval. */
  readonly timers?: TimerPort;
}

export interface AudioEngine extends AudioPort {
  dispose(): void;
}

export const SCHEDULER_INTERVAL_MS = 25;
/** Fade applied to a stolen voice before its strip is reused. */
export const STEAL_FADE_S = 0.01;

const DEFAULT_TIMERS: TimerPort = {
  setInterval: (cb, ms) => globalThis.setInterval(cb, ms),
  clearInterval: (id) => {
    globalThis.clearInterval(id);
  },
};

class Engine implements AudioEngine, AudioRequestSink {
  private readonly deps: AudioEngineDeps;
  private readonly timbre: TimbrePreset;
  private readonly timers: TimerPort;
  private readonly pool = new VoicePool(VOICE_COUNT, CATEGORY_LIMITS);
  private readonly bank: SfxBank;
  private readonly composer: SectorComposer;
  private readonly router: AudioEventRouter;
  private readonly sources: (AudioBufferSourceNode | null)[] = [];
  private ctx: AudioContext | null = null;
  private mixer: Mixer | null = null;
  private music: MusicGraph | null = null;
  private seq: SequencerApi | null = null;
  private unlockPromise: Promise<void> | null = null;
  private timerId = -1;
  private mood: MusicMood = 'silent';
  private intensity = 0;
  private ducked = false;
  private readonly volumes = new Float64Array([1, 1, 1]);
  /** Request being played: [pan, gain, detuneCents] (the router writes it; see AudioRequestSink). */
  readonly req = new Float64Array(3);
  /** [ctx.currentTime], read once per play() / consumeEvents() batch (each read allocates a HeapNumber). */
  private readonly clock = new Float64Array(1);
  private disposed = false;
  unlocked = false;

  constructor(deps: AudioEngineDeps) {
    this.deps = deps;
    this.timbre = TIMBRES[deps.theme.audio.timbre];
    this.timers = deps.timers ?? DEFAULT_TIMERS;
    this.bank = new SfxBank(this.timbre, deps.seed, deps.log);
    this.composer = createComposer(deps.theme, deps.seed);
    this.router = createAudioRequestRouter(this, ARENA.RADIUS);
    for (let i = 0; i < VOICE_COUNT; i++) this.sources.push(null);
  }

  unlock(): Promise<void> {
    if (this.unlockPromise !== null) {
      this.wake();
      return this.unlockPromise;
    }
    this.unlockPromise = this.doUnlock().then((ok) => {
      // A failed context creation may be retried on the next gesture.
      if (!ok) this.unlockPromise = null;
    });
    return this.unlockPromise;
  }

  private async doUnlock(): Promise<boolean> {
    if (this.disposed) return true;
    let ctx: AudioContext;
    try {
      ctx = this.ctx ?? this.deps.createContext();
      this.ctx = ctx;
      if (this.mixer === null) this.buildGraph(ctx);
    } catch (err) {
      this.deps.log.error('audio: could not create the AudioContext', err);
      return false;
    }
    // resume() must start inside the user gesture: it is called before the first await.
    const resumed = ctx.resume().catch((err: unknown) => {
      this.deps.log.warn('audio: resume failed', err);
    });
    await this.bank.render(this.deps.createOfflineContext, ctx.sampleRate);
    await resumed;
    // dispose() may have run while rendering.
    if (this.isDisposed()) return true;
    if (this.bank.failed > 0) this.deps.log.warn(`audio: ${this.bank.failed} sfx variants failed to render`);
    this.unlocked = true;
    this.startMusic();
    return true;
  }

  private isDisposed(): boolean {
    return this.disposed;
  }

  /** Re-resume a context left 'suspended'/'interrupted' (Safari) on a later gesture. */
  private wake(): void {
    const ctx = this.ctx;
    if (ctx === null || this.disposed) return;
    const state: string = ctx.state;
    if (state === 'suspended' || state === 'interrupted') {
      ctx.resume().catch((err: unknown) => {
        this.deps.log.warn('audio: resume failed', err);
      });
    }
  }

  private buildGraph(ctx: AudioContext): void {
    const rng = createRng(this.deps.seed).fork('audio-graph');
    const uiStart = this.pool.rangeStart('ui');
    const mixer = new Mixer(ctx, this.timbre, rng, VOICE_COUNT, [uiStart, uiStart + CATEGORY_LIMITS.ui]);
    this.mixer = mixer;
    mixer.setVolumes(this.volumes[0]!, this.volumes[1]!, this.volumes[2]!);
    mixer.duck(this.ducked);
    mixer.setLounge(this.mood === 'shop');
    const bpm = this.deps.theme.audio.bpm;
    const music = new MusicGraph(ctx, mixer.musicIn, mixer.musicSend, this.timbre, bpm, rng.fork('music'));
    this.music = music;
    this.seq = createSequencer({
      now: () => ctx.currentTime,
      composer: this.composer,
      schedule: music.schedule,
      bpm,
    });
    this.seq.setMood(this.mood);
    this.seq.setIntensity(this.intensity);
  }

  private startMusic(): void {
    const seq = this.seq;
    if (seq === null || seq.running) return;
    seq.start();
    if (this.timerId < 0) {
      this.timerId = this.timers.setInterval(() => {
        seq.tick();
      }, SCHEDULER_INTERVAL_MS);
    }
  }

  play(id: SfxId, pan = 0, gain = 1, detuneCents = 0): void {
    if (!this.running()) return;
    const q = this.req;
    q[0] = pan;
    q[1] = gain;
    q[2] = detuneCents;
    this.request(id);
  }

  /** True when sounds can start; also latches the batch clock. */
  private running(): boolean {
    const ctx = this.ctx;
    if (!this.unlocked || ctx === null || this.mixer === null || ctx.state !== 'running') return false;
    this.clock[0] = ctx.currentTime;
    return true;
  }

  /**
   * Plays `id` with [pan, gain, detune] from `req` at the latched clock (call only after running()). The
   * coalesced path (most requests under load) allocates nothing: no double crosses a call, durations and gains
   * come from typed arrays. A started voice needs one AudioBufferSourceNode (one-shot by spec).
   */
  request(id: SfxId): void {
    const ctx = this.ctx;
    const mixer = this.mixer;
    if (ctx === null || mixer === null) return;
    const bank = this.bank;
    const buf = bank.next(id);
    if (buf === null) return;
    const q = this.req;
    const detuneCents = q[2]!;
    const rate = detuneCents === 0 ? 1 : Math.pow(2, detuneCents / 1200);
    const now = this.clock[0]!;
    VOICE_IN[0] = now;
    VOICE_IN[1] = bank.picked[0]! / rate;
    const v = this.pool.acquireIn(id, bank.category(id));
    if (v < 0) return;
    const strip = mixer.strips[v]!;
    const g = strip.gain.gain;
    let start = now;
    if (this.pool.lastStolen) {
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, now + STEAL_FADE_S);
      const old = this.sources[v];
      if (old) {
        try {
          old.stop(now + STEAL_FADE_S);
        } catch {
          // Already stopped: nothing to fade.
        }
      }
      start = now + STEAL_FADE_S;
    }
    const gain = q[1]!;
    const pan = q[0]!;
    const level = (gain > 0 ? (gain < 2 ? gain : 2) : 0) * bank.gains[sfxIndex(id)]!;
    const p = pan > -1 ? (pan < 1 ? pan : 1) : -1;
    g.setValueAtTime(level, start);
    strip.pan.pan.setValueAtTime(Number.isFinite(p) ? p : 0, start);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    if (rate !== 1) src.playbackRate.value = rate;
    src.connect(strip.gain);
    src.start(start);
    this.sources[v] = src;
  }

  consumeEvents(e: SimEvents): void {
    if (!this.running()) return;
    this.router.route(e);
  }

  setMood(m: MusicMood): void {
    this.mood = m;
    this.seq?.setMood(m);
    this.mixer?.setLounge(m === 'shop');
  }

  setIntensity(x: number): void {
    this.intensity = Number.isFinite(x) ? (x < 0 ? 0 : x > 1 ? 1 : x) : 0;
    this.seq?.setIntensity(this.intensity);
  }

  setSector(s: 1 | 2 | 3): void {
    this.composer.setSector(s);
  }

  duck(on: boolean): void {
    this.ducked = on;
    this.mixer?.duck(on);
  }

  setVolumes(master: number, music: number, sfx: number): void {
    this.volumes[0] = master;
    this.volumes[1] = music;
    this.volumes[2] = sfx;
    this.mixer?.setVolumes(master, music, sfx);
  }

  /** Read once per frame by the renderer: doubles as the rAF scheduler tick. */
  get beatPhase(): number {
    const seq = this.seq;
    if (seq === null) return 0;
    seq.tick();
    return seq.beatPhase;
  }

  async suspend(): Promise<void> {
    const ctx = this.ctx;
    if (ctx === null || ctx.state === 'closed') return;
    try {
      await ctx.suspend();
    } catch (err) {
      this.deps.log.warn('audio: suspend failed', err);
    }
  }

  async resume(): Promise<void> {
    const ctx = this.ctx;
    if (ctx === null || ctx.state === 'closed' || this.disposed) return;
    try {
      await ctx.resume();
    } catch (err) {
      this.deps.log.warn('audio: resume failed', err);
    }
  }

  stats(): AudioStats {
    const ctx = this.ctx;
    return {
      voices: ctx === null ? 0 : this.pool.activeAt(ctx.currentTime),
      stolen: this.pool.stolen,
      coalesced: this.pool.coalesced,
      ctxState: ctx === null ? 'none' : ctx.state,
    };
  }

  /** Music nodes currently alive (debug/devApi). */
  musicNodes(): number {
    const ctx = this.ctx;
    return ctx === null || this.music === null ? 0 : this.music.liveNodes(ctx.currentTime);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unlocked = false;
    if (this.timerId >= 0) this.timers.clearInterval(this.timerId);
    this.timerId = -1;
    this.seq?.stop();
    const ctx = this.ctx;
    if (ctx !== null && ctx.state !== 'closed') {
      ctx.close().catch((err: unknown) => {
        this.deps.log.warn('audio: close failed', err);
      });
    }
  }
}

export function createAudioEngine(deps: AudioEngineDeps): AudioEngine {
  return new Engine(deps);
}

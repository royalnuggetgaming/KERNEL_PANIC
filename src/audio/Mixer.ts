/**
 * The persistent realtime graph (plan section 8): master -> DynamicsCompressor limiter (-6 dB, 12:1) ->
 * destination; music (mood low-pass -> duck low-pass -> duck gain -> volume), sfx and ui buses; one procedural
 * reverb fed by post-volume sends; and 32 permanent SFX channel strips (Gain -> StereoPanner).
 */
import type { Rng } from '../contracts/sim';
import { createReverb } from './reverb';
import type { TimbrePreset } from './timbre';

export const LIMITER_THRESHOLD_DB = -6;
export const LIMITER_RATIO = 12;
/** Pause/shop duck: low-pass 700 Hz and -9 dB. */
export const DUCK_CUTOFF_HZ = 700;
export const DUCK_GAIN = Math.pow(10, -9 / 20);
/** Shop lounge variant low-pass. */
export const LOUNGE_CUTOFF_HZ = 1400;
export const OPEN_CUTOFF_HZ = 20000;
const SMOOTH_S = 0.03;
const SFX_REVERB_SEND = 0.14;

export interface ChannelStrip {
  readonly gain: GainNode;
  readonly pan: StereoPannerNode;
}

/** Perceptual volume curve for 0..1 settings sliders. */
export function volumeCurve(v: number): number {
  const x = Number.isFinite(v) ? (v < 0 ? 0 : v > 1 ? 1 : v) : 0;
  return x * x;
}

export class Mixer {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  readonly limiter: DynamicsCompressorNode;
  /** Music input (feeds the mood filter). */
  readonly musicIn: BiquadFilterNode;
  /** Reverb send for music, scaled with music volume and duck. */
  readonly musicSend: GainNode;
  readonly sfxBus: GainNode;
  readonly uiBus: GainNode;
  readonly strips: ChannelStrip[] = [];
  private readonly duckFilter: BiquadFilterNode;
  private readonly duckGain: GainNode;
  private readonly musicVol: GainNode;
  private readonly sfxVol: GainNode;
  private musicLevel = 1;
  private ducked = false;
  private lounge = false;

  constructor(
    ctx: AudioContext,
    timbre: TimbrePreset,
    rng: Rng,
    voiceCount: number,
    uiRange: readonly [number, number],
  ) {
    this.ctx = ctx;
    const t = ctx.currentTime;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.setValueAtTime(LIMITER_THRESHOLD_DB, t);
    this.limiter.ratio.setValueAtTime(LIMITER_RATIO, t);
    this.limiter.knee.setValueAtTime(3, t);
    this.limiter.attack.setValueAtTime(0.003, t);
    this.limiter.release.setValueAtTime(0.2, t);
    this.limiter.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(this.limiter);

    const reverb = createReverb(ctx, timbre.reverbSeconds, timbre.reverbDecay, rng);
    const reverbIn = ctx.createGain();
    reverbIn.gain.value = 0.5;
    reverbIn.connect(reverb);
    reverb.connect(this.master);

    this.musicVol = ctx.createGain();
    this.musicVol.connect(this.master);
    this.duckGain = ctx.createGain();
    this.duckGain.connect(this.musicVol);
    this.duckFilter = this.lowpass(this.duckGain);
    this.musicIn = this.lowpass(this.duckFilter);
    this.musicSend = ctx.createGain();
    this.musicSend.connect(reverbIn);

    this.sfxVol = ctx.createGain();
    this.sfxVol.connect(this.master);
    const sfxSend = ctx.createGain();
    sfxSend.gain.value = SFX_REVERB_SEND;
    this.sfxVol.connect(sfxSend);
    sfxSend.connect(reverbIn);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.sfxVol);
    this.uiBus = ctx.createGain();
    this.uiBus.connect(this.sfxVol);

    for (let i = 0; i < voiceCount; i++) {
      const gain = ctx.createGain();
      const pan = ctx.createStereoPanner();
      gain.gain.value = 0;
      gain.connect(pan);
      pan.connect(i >= uiRange[0] && i < uiRange[1] ? this.uiBus : this.sfxBus);
      this.strips.push({ gain, pan });
    }
  }

  setVolumes(master: number, music: number, sfx: number): void {
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(volumeCurve(master), t, SMOOTH_S);
    this.musicLevel = volumeCurve(music);
    this.musicVol.gain.setTargetAtTime(this.musicLevel, t, SMOOTH_S);
    this.sfxVol.gain.setTargetAtTime(volumeCurve(sfx), t, SMOOTH_S);
    this.applyMusicSend(t);
  }

  duck(on: boolean): void {
    this.ducked = on;
    const t = this.ctx.currentTime;
    this.duckGain.gain.setTargetAtTime(on ? DUCK_GAIN : 1, t, 0.08);
    this.duckFilter.frequency.setTargetAtTime(on ? DUCK_CUTOFF_HZ : this.openCutoff(), t, 0.08);
    this.applyMusicSend(t);
  }

  /** Shop mood: the lounge variant is low-passed. */
  setLounge(on: boolean): void {
    if (on === this.lounge) return;
    this.lounge = on;
    this.musicIn.frequency.setTargetAtTime(
      on ? LOUNGE_CUTOFF_HZ : this.openCutoff(),
      this.ctx.currentTime,
      0.25,
    );
  }

  get isDucked(): boolean {
    return this.ducked;
  }

  private applyMusicSend(t: number): void {
    this.musicSend.gain.setTargetAtTime(this.musicLevel * (this.ducked ? DUCK_GAIN : 1), t, SMOOTH_S);
  }

  private openCutoff(): number {
    return Math.min(OPEN_CUTOFF_HZ, this.ctx.sampleRate * 0.45);
  }

  private lowpass(out: AudioNode): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = this.openCutoff();
    f.Q.value = 0.7;
    f.connect(out);
    return f;
  }
}

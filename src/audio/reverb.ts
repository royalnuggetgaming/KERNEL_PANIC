/**
 * Procedural reverb: an impulse response of exponentially decaying noise that also darkens over time
 * (a one-pole low-pass whose coefficient falls with the tail), fed to a ConvolverNode.
 */
import type { Rng } from '../contracts/sim';

/**
 * Fills one IR channel. `decay` is the exponential rate (amplitude e^(-decay * t)); a short pre-delay keeps
 * the direct sound clear. Pure and node-testable.
 */
export function fillImpulse(data: Float32Array, sampleRate: number, decay: number, rng: Rng, preDelayS = 0.012): void {
  const n = data.length;
  const pre = Math.min(n, Math.floor(preDelayS * sampleRate));
  let lp = 0;
  for (let i = 0; i < n; i++) {
    if (i < pre) {
      data[i] = 0;
      continue;
    }
    const t = (i - pre) / sampleRate;
    const env = Math.exp(-decay * t);
    // Brightness falls from ~0.9 to ~0.15 over the tail.
    const k = 0.15 + 0.75 * Math.exp(-2.5 * t);
    lp += k * (rng.next() * 2 - 1 - lp);
    data[i] = lp * env;
  }
}

/** A stereo impulse response (independent noise per channel for width). */
export function makeImpulseResponse(ctx: BaseAudioContext, seconds: number, decay: number, rng: Rng): AudioBuffer {
  const len = Math.max(1, Math.ceil(seconds * ctx.sampleRate));
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  fillImpulse(buf.getChannelData(0), ctx.sampleRate, decay, rng);
  fillImpulse(buf.getChannelData(1), ctx.sampleRate, decay, rng);
  return buf;
}

/** A ConvolverNode loaded with a procedural impulse response. */
export function createReverb(ctx: BaseAudioContext, seconds: number, decay: number, rng: Rng): ConvolverNode {
  const conv = ctx.createConvolver();
  conv.normalize = true;
  conv.buffer = makeImpulseResponse(ctx, seconds, decay, rng);
  return conv;
}

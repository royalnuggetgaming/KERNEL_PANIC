import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/core/rng';
import { fillImpulse, makeImpulseResponse, createReverb } from '../../src/audio/reverb';
import {
  SILENCE,
  crunch,
  envelope,
  fillNoise,
  fmVoice,
  makeDriveCurve,
  makeNoiseBuffer,
  noiseBurst,
  percEnvelope,
  tone,
} from '../../src/audio/synth';
import { FakeContext } from './fakeWebAudio';

function ctxOf(fake: FakeContext): BaseAudioContext {
  return fake as unknown as BaseAudioContext;
}

describe('synth', () => {
  it('noise is bounded, seeded and coloured', () => {
    const rms = (d: Float32Array): number => Math.sqrt(d.reduce((s, x) => s + x * x, 0) / d.length);
    const diff = (d: Float32Array): number => {
      let s = 0;
      for (let i = 1; i < d.length; i++) s += Math.abs(d[i]! - d[i - 1]!);
      return s / (d.length - 1);
    };
    const kinds = ['white', 'pink', 'brown'] as const;
    const out: Record<string, Float32Array> = {};
    for (const k of kinds) {
      const a = new Float32Array(20000);
      const b = new Float32Array(20000);
      fillNoise(a, k, createRng(3));
      fillNoise(b, k, createRng(3));
      expect(a).toEqual(b);
      for (const x of a) expect(Math.abs(x)).toBeLessThanOrEqual(1);
      expect(rms(a)).toBeGreaterThan(0.01);
      out[k] = a;
    }
    // Redder noise changes more slowly sample to sample.
    expect(diff(out.white!)).toBeGreaterThan(diff(out.pink!));
    expect(diff(out.pink!)).toBeGreaterThan(diff(out.brown!));
  });

  it('drive curve is odd, monotonic and normalised', () => {
    const c = makeDriveCurve(0.5, 257);
    expect(c).toHaveLength(257);
    expect(c[0]).toBeCloseTo(-1, 6);
    expect(c[256]).toBeCloseTo(1, 6);
    expect(c[128]).toBeCloseTo(0, 6);
    for (let i = 1; i < c.length; i++) expect(c[i]!).toBeGreaterThanOrEqual(c[i - 1]!);
    expect(makeDriveCurve(2, 1)).toHaveLength(2);
    // More drive = more saturation at a quarter input.
    expect(makeDriveCurve(1, 5)[3]!).toBeGreaterThan(makeDriveCurve(0, 5)[3]!);
  });

  it('impulse response decays and starts after a pre-delay', () => {
    const sr = 8000;
    const d = new Float32Array(sr * 2);
    fillImpulse(d, sr, 3, createRng(1));
    expect(d[0]).toBe(0);
    const energy = (a: number, b: number): number => {
      let s = 0;
      for (let i = a; i < b; i++) s += d[i]! * d[i]!;
      return s;
    };
    expect(energy(200, 2200)).toBeGreaterThan(energy(sr + 200, sr + 2200) * 5);
    const fake = new FakeContext(8000);
    const ir = makeImpulseResponse(ctxOf(fake), 1, 3, createRng(2));
    expect(ir.numberOfChannels).toBe(2);
    expect(ir.length).toBe(8000);
    expect(ir.getChannelData(0)).not.toEqual(ir.getChannelData(1));
    const conv = createReverb(ctxOf(fake), 0.5, 3, createRng(2));
    expect(conv.buffer?.length).toBe(4000);
  });

  it('envelopes only schedule positive exponential targets and return their end', () => {
    const fake = new FakeContext();
    const g = fake.createGain();
    const end = envelope(g.gain as unknown as AudioParam, 1, { a: 0.1, d: 0.2, s: 0.5, r: 0.3 }, 0.8, 1);
    expect(end).toBeCloseTo(2.3, 9);
    const g2 = fake.createGain();
    expect(
      envelope(g2.gain as unknown as AudioParam, 0, { a: 0.1, d: 0.5, s: 0, r: 0.1 }, 1, 0.05),
    ).toBeCloseTo(0.2, 9);
    const g3 = fake.createGain();
    expect(percEnvelope(g3.gain as unknown as AudioParam, 2, 1, 0.01, 0.2)).toBeCloseTo(2.21, 9);
    for (const e of [...g.gain.events, ...g2.gain.events, ...g3.gain.events]) {
      if (e.type === 'exp') expect(e.value).toBeGreaterThanOrEqual(SILENCE);
    }
  });

  it('voices start and explicitly stop every source and reach the output', () => {
    const fake = new FakeContext();
    const ctx = ctxOf(fake);
    const out = fake.destination as unknown as AudioNode;
    const rng = createRng(4);
    const e1 = tone(ctx, out, 'square', 0.5, 1000, 200, 0.1, 0.5, 0.01, 0.2);
    const e2 = fmVoice(ctx, out, 0, 0.3, 440, 2, 3, 0.4);
    const e3 = noiseBurst(
      ctx,
      out,
      makeNoiseBuffer(ctx, 'pink', 0.5, rng),
      0,
      'bandpass',
      2000,
      300,
      2,
      0.5,
      0.01,
      0.2,
    );
    const ws = crunch(ctx, 0.4);
    ws.connect(out);
    expect(e1).toBeGreaterThan(0.5);
    expect(e2).toBeGreaterThan(0.3);
    expect(e3).toBeGreaterThan(0.2);
    expect(fake.unstopped()).toHaveLength(0);
    expect(fake.unreachable()).toHaveLength(0);
    expect(fake.count('oscillator')).toBe(3);
  });
});

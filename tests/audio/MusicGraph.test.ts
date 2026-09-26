import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/core/rng';
import { KERNEL_PANIC } from '../../src/themes/kernelPanic';
import { type NoteEvent, createComposer } from '../../src/audio/Composer';
import { INSTRUMENT_IDS } from '../../src/audio/instrumentIds';
import { INSTRUMENTS } from '../../src/audio/instruments';
import { MAX_LIVE_NODES, MusicGraph, SIDECHAIN_FLOOR } from '../../src/audio/MusicGraph';
import { createSequencer } from '../../src/audio/Sequencer';
import { makeNoiseBuffer } from '../../src/audio/synth';
import { TIMBRES } from '../../src/audio/timbre';
import { FakeContext } from './fakeWebAudio';

function graph(fake: FakeContext): MusicGraph {
  const ctx = fake as unknown as BaseAudioContext;
  const musicIn = fake.createGain();
  musicIn.connect(fake.destination);
  const reverb = fake.createGain();
  reverb.connect(fake.destination);
  return new MusicGraph(
    ctx,
    musicIn as unknown as AudioNode,
    reverb as unknown as AudioNode,
    TIMBRES.synthwave,
    112,
    createRng(1),
  );
}

describe('instruments', () => {
  it('each note creates exactly `nodes` nodes, all stopped explicitly and connected', () => {
    for (const id of INSTRUMENT_IDS) {
      const fake = new FakeContext();
      const ctx = fake as unknown as BaseAudioContext;
      const noise = makeNoiseBuffer(ctx, 'white', 0.1, createRng(1));
      const before = fake.nodes.length;
      const end = INSTRUMENTS[id].play(
        ctx,
        fake.destination as unknown as AudioNode,
        57,
        1,
        0.5,
        0.8,
        TIMBRES.synthwave,
        noise,
      );
      expect(fake.nodes.length - before, id).toBe(INSTRUMENTS[id].nodes);
      expect(end).toBeGreaterThan(1);
      expect(fake.unstopped(), id).toHaveLength(0);
      expect(fake.unreachable(), id).toHaveLength(0);
      for (const n of fake.nodes)
        if (n.stoppedAt !== null) expect(n.stoppedAt).toBeLessThanOrEqual(end + 1e-9);
    }
  });
});

describe('MusicGraph', () => {
  it('builds persistent buses that all reach the output', () => {
    const fake = new FakeContext();
    graph(fake);
    expect(fake.unreachable()).toHaveLength(0);
    expect(fake.count('waveShaper')).toBe(1);
  });

  it('keeps live music nodes under the budget while sequencing the densest mood', () => {
    const fake = new FakeContext();
    const g = graph(fake);
    const seq = createSequencer({
      now: () => fake.currentTime,
      composer: createComposer(KERNEL_PANIC, 3),
      schedule: g.schedule,
      bpm: 112,
    });
    seq.setMood('boss');
    seq.setIntensity(1);
    seq.start();
    let maxLive = 0;
    for (let i = 0; i < 1600; i++) {
      fake.currentTime += 0.025;
      seq.tick();
      maxLive = Math.max(maxLive, g.liveNodes(fake.currentTime));
    }
    expect(g.played).toBeGreaterThan(500);
    expect(maxLive).toBeLessThanOrEqual(MAX_LIVE_NODES + INSTRUMENTS.kick.nodes);
    expect(fake.unstopped()).toHaveLength(0);
    expect(fake.unreachable()).toHaveLength(0);
  });

  it('ducks the pad on each kick and ignores unknown instruments', () => {
    const fake = new FakeContext();
    const g = graph(fake);
    const kick: NoteEvent = { instrument: 'kick', midi: 36, startBeat: 0, lengthBeats: 0.5, velocity: 1 };
    g.schedule(kick, 0.5);
    const duck = fake.nodes.find(
      (n) =>
        n.kind === 'gain' &&
        n.gain.events.some((e) => e.type === 'linear' && Math.abs(e.value - SIDECHAIN_FLOOR) < 1e-9),
    );
    expect(duck).toBeDefined();
    const n = fake.nodes.length;
    g.schedule({ instrument: 'theremin', midi: 60, startBeat: 0, lengthBeats: 1, velocity: 1 }, 1);
    expect(fake.nodes.length).toBe(n);
    g.setBpm(60);
    g.setBpm(-1);
    expect(g.dropped).toBe(0);
  });

  it('drops low-priority notes when the budget is exhausted', () => {
    const fake = new FakeContext();
    const g = graph(fake);
    const pad: NoteEvent = { instrument: 'pad', midi: 57, startBeat: 0, lengthBeats: 8, velocity: 1 };
    for (let i = 0; i < 20; i++) g.schedule(pad, 0.1);
    expect(g.dropped).toBeGreaterThan(0);
    expect(g.liveNodes(0.2)).toBeLessThanOrEqual(MAX_LIVE_NODES);
  });
});

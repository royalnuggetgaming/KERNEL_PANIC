import { describe, expect, it } from 'vitest';
import { SFX_IDS } from '../../src/contracts/audio';
import { createMemoryLogger } from '../../src/core/logger';
import { createRng } from '../../src/core/rng';
import { BUFFER_PEAK, SfxBank, normalizePeak, sfxIndex } from '../../src/audio/SfxBank';
import { RecipeContextImpl, SFX_VARIANTS, variantPitch } from '../../src/audio/sfxRecipeKit';
import { SFX_RECIPES, recipeSeconds } from '../../src/audio/sfxRecipes';
import { TIMBRES } from '../../src/audio/timbre';
import { CATEGORY_LIMITS } from '../../src/audio/VoicePool';
import { FakeContext, FakeOfflineContext } from './fakeWebAudio';

function offlineFactory(made: FakeOfflineContext[], failEvery = 0) {
  return (channels: number, length: number, sampleRate: number): OfflineAudioContext => {
    const c = new FakeOfflineContext(channels, length, sampleRate);
    if (failEvery > 0 && made.length % failEvery === 0) c.fail = true;
    made.push(c);
    return c as unknown as OfflineAudioContext;
  };
}

describe('sfx recipes', () => {
  it('there is exactly one recipe per SfxId with a valid category', () => {
    expect(Object.keys(SFX_RECIPES).sort()).toEqual([...SFX_IDS].sort());
    for (const id of SFX_IDS) {
      const r = SFX_RECIPES[id];
      expect(Object.keys(CATEGORY_LIMITS)).toContain(r.category);
      expect(r.duration).toBeGreaterThan(0);
      expect(r.duration).toBeLessThan(3);
      expect(r.gain).toBeGreaterThan(0);
      expect(r.gain).toBeLessThanOrEqual(1);
    }
    expect(SFX_RECIPES.uiMove.category).toBe('ui');
    expect(SFX_RECIPES.laser.category).toBe('weapon');
    expect(SFX_RECIPES.explodeBoss.category).toBe('explosion');
  });

  it('every recipe, variant and timbre builds a valid graph: all sources stopped inside the buffer, all nodes reach the output', () => {
    for (const timbreName of ['synthwave', 'abyssal', 'industrial'] as const) {
      const timbre = TIMBRES[timbreName];
      for (const id of SFX_IDS) {
        for (let v = 0; v < SFX_VARIANTS; v++) {
          const fake = new FakeContext(48000);
          const rc = new RecipeContextImpl(
            fake as unknown as BaseAudioContext,
            fake.destination as unknown as AudioNode,
            v,
            timbre,
            createRng(9).fork(id, v),
          );
          SFX_RECIPES[id].build(rc);
          const sources = fake.nodes.filter((n) => n.startedAt !== null);
          expect(sources.length, `${id} has sources`).toBeGreaterThan(0);
          expect(fake.unstopped(), `${id} stops every source`).toHaveLength(0);
          expect(fake.unreachable(), `${id} is fully connected`).toHaveLength(0);
          const len = recipeSeconds(SFX_RECIPES[id], timbre);
          for (const s of sources)
            expect(s.stoppedAt!, `${id} ends within its buffer`).toBeLessThanOrEqual(len + 0.35);
        }
      }
    }
  });

  it('variant pitches differ and follow the timbre transpose', () => {
    const rng = createRng(1);
    const p0 = variantPitch(TIMBRES.synthwave, 0, rng);
    const p1 = variantPitch(TIMBRES.synthwave, 1, rng);
    const p2 = variantPitch(TIMBRES.synthwave, 2, rng);
    expect(p1).toBeGreaterThan(p0);
    expect(p2).toBeLessThan(p0);
    expect(variantPitch(TIMBRES.abyssal, 0, rng)).toBeLessThan(0.8);
  });
});

describe('SfxBank', () => {
  it('pre-renders every variant through OfflineAudioContext once, normalised', async () => {
    const made: FakeOfflineContext[] = [];
    const bank = new SfxBank(TIMBRES.synthwave, 7);
    expect(bank.ready).toBe(false);
    expect(bank.next('laser')).toBeNull();
    const factory = offlineFactory(made);
    const p1 = bank.render(factory, 48000);
    const p2 = bank.render(factory, 48000);
    expect(p2).toBe(p1);
    await p1;
    expect(bank.ready).toBe(true);
    expect(made).toHaveLength(SFX_IDS.length * SFX_VARIANTS);
    expect(bank.size).toBe(SFX_IDS.length * SFX_VARIANTS);
    for (const c of made) {
      expect(c.channels).toBe(1);
      expect(c.sampleRate).toBe(48000);
    }
    const buf = bank.buffer('explodeL', 1)!;
    expect(buf.length).toBe(Math.ceil(recipeSeconds(SFX_RECIPES.explodeL, TIMBRES.synthwave) * 48000));
    let peak = 0;
    for (const x of buf.getChannelData(0)) peak = Math.max(peak, Math.abs(x));
    expect(peak).toBeLessThanOrEqual(BUFFER_PEAK + 1e-6);
    expect(bank.category('uiBuy')).toBe('ui');
    expect(bank.gain('laser')).toBe(SFX_RECIPES.laser.gain);
    expect(sfxIndex('laser')).toBe(0);
  });

  it('round-robins variants and skips failed renders', async () => {
    const made: FakeOfflineContext[] = [];
    const log = createMemoryLogger();
    const bank = new SfxBank(TIMBRES.industrial, 7, log);
    await bank.render(offlineFactory(made, 3), 44100);
    // Every third render failed: slot 0, 3, 6, ... -> variant 0 of each id.
    expect(bank.failed).toBe(SFX_IDS.length);
    expect(bank.buffer('laser', 0)).toBeNull();
    const a = bank.next('laser');
    const b = bank.next('laser');
    const c = bank.next('laser');
    expect(a).not.toBeNull();
    expect(a).not.toBe(b);
    expect(c).toBe(a);
    expect(log.entries.some((e) => e.level === 'warn')).toBe(true);
  });

  it('normalizePeak only scales down', () => {
    const d = new Float32Array([0.2, -2, 1]);
    expect(normalizePeak(d, 0.5)).toBe(2);
    expect(Math.max(...d.map(Math.abs))).toBeCloseTo(0.5, 6);
    const q = new Float32Array([0.1, -0.2]);
    normalizePeak(q, 0.5);
    expect(q[1]).toBeCloseTo(-0.2, 6);
  });
});

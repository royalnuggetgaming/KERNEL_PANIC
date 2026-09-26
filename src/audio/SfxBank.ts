/**
 * Pre-rendered SFX bank (plan section 8): at unlock every recipe variant is rendered through its own
 * OfflineAudioContext (in parallel batches) into an AudioBuffer. play() then needs exactly one
 * AudioBufferSourceNode per sound.
 */
import { SFX_IDS, type SfxCategory, type SfxId } from '../contracts/audio';
import type { Logger } from '../contracts/ids';
import { createRng } from '../core/rng';
import { RecipeContextImpl, SFX_VARIANTS, type SfxRecipe } from './sfxRecipeKit';
import { SFX_RECIPES, recipeSeconds } from './sfxRecipes';
import type { TimbrePreset } from './timbre';

export type OfflineContextFactory = (channels: number, length: number, sampleRate: number) => OfflineAudioContext;

/** Offline renders started at once; keeps memory and thread pressure bounded at unlock. */
export const RENDER_CONCURRENCY = 12;
/** Buffers are normalised down to this peak so stacked voices keep headroom before the limiter. */
export const BUFFER_PEAK = 0.9;

const SFX_INDEX = ((): Readonly<Record<SfxId, number>> => {
  const out: Partial<Record<SfxId, number>> = {};
  for (let i = 0; i < SFX_IDS.length; i++) out[SFX_IDS[i]!] = i;
  return out as Readonly<Record<SfxId, number>>;
})();

/** Index of an SfxId in SFX_IDS. */
export function sfxIndex(id: SfxId): number {
  return SFX_INDEX[id];
}

/** Scales `data` down so its absolute peak is at most `peak`; returns the original peak. */
export function normalizePeak(data: Float32Array, peak: number): number {
  let max = 0;
  for (let i = 0; i < data.length; i++) {
    const a = Math.abs(data[i]!);
    if (a > max) max = a;
  }
  if (max > peak) {
    const k = peak / max;
    for (let i = 0; i < data.length; i++) data[i] = data[i]! * k;
  }
  return max;
}

export class SfxBank {
  private readonly timbre: TimbrePreset;
  private readonly seed: number;
  private readonly recipes: Readonly<Record<SfxId, SfxRecipe>>;
  private readonly log: Logger | null;
  private readonly buffers: (AudioBuffer | null)[];
  private readonly rr = new Uint8Array(SFX_IDS.length);
  private renderPromise: Promise<void> | null = null;
  private done = false;
  failed = 0;

  constructor(timbre: TimbrePreset, seed: number, log: Logger | null = null, recipes = SFX_RECIPES) {
    this.timbre = timbre;
    this.seed = seed >>> 0;
    this.recipes = recipes;
    this.log = log;
    this.buffers = [];
    for (let i = 0; i < SFX_IDS.length * SFX_VARIANTS; i++) this.buffers.push(null);
  }

  get ready(): boolean {
    return this.done;
  }

  /** Number of rendered buffers. */
  get size(): number {
    let n = 0;
    for (let i = 0; i < this.buffers.length; i++) if (this.buffers[i] !== null) n++;
    return n;
  }

  category(id: SfxId): SfxCategory {
    return this.recipes[id].category;
  }

  gain(id: SfxId): number {
    return this.recipes[id].gain;
  }

  /** Renders every recipe variant once; later calls return the same promise. */
  render(createOffline: OfflineContextFactory, sampleRate: number): Promise<void> {
    this.renderPromise ??= this.renderAll(createOffline, sampleRate);
    return this.renderPromise;
  }

  /** The buffer for a specific variant, or null when it is not rendered. */
  buffer(id: SfxId, variant: number): AudioBuffer | null {
    return this.buffers[SFX_INDEX[id] * SFX_VARIANTS + (variant % SFX_VARIANTS)] ?? null;
  }

  /** Next variant for `id` in round-robin order, skipping variants that failed to render. */
  next(id: SfxId): AudioBuffer | null {
    const idx = SFX_INDEX[id];
    const start = this.rr[idx]!;
    for (let k = 0; k < SFX_VARIANTS; k++) {
      const v = (start + k) % SFX_VARIANTS;
      const b = this.buffers[idx * SFX_VARIANTS + v];
      if (b) {
        this.rr[idx] = (v + 1) % SFX_VARIANTS;
        return b;
      }
    }
    return null;
  }

  private async renderAll(createOffline: OfflineContextFactory, sampleRate: number): Promise<void> {
    const jobs: number[] = [];
    for (let i = 0; i < SFX_IDS.length * SFX_VARIANTS; i++) jobs.push(i);
    for (let at = 0; at < jobs.length; at += RENDER_CONCURRENCY) {
      const batch: Promise<void>[] = [];
      const end = Math.min(jobs.length, at + RENDER_CONCURRENCY);
      for (let j = at; j < end; j++) batch.push(this.renderOne(createOffline, sampleRate, jobs[j]!));
      await Promise.all(batch);
    }
    this.done = true;
  }

  private async renderOne(createOffline: OfflineContextFactory, sampleRate: number, slot: number): Promise<void> {
    const id = SFX_IDS[Math.floor(slot / SFX_VARIANTS)]!;
    const variant = slot % SFX_VARIANTS;
    const recipe = this.recipes[id];
    try {
      const length = Math.max(1, Math.ceil(recipeSeconds(recipe, this.timbre) * sampleRate));
      const off = createOffline(1, length, sampleRate);
      const tone = off.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = Math.min(18000 * this.timbre.brightness, sampleRate * 0.45);
      tone.Q.value = 0.5;
      tone.connect(off.destination);
      const rng = createRng(this.seed).fork(id, variant);
      recipe.build(new RecipeContextImpl(off, tone, variant, this.timbre, rng));
      const buf = await off.startRendering();
      for (let c = 0; c < buf.numberOfChannels; c++) normalizePeak(buf.getChannelData(c), BUFFER_PEAK);
      this.buffers[slot] = buf;
    } catch (err) {
      this.failed++;
      this.log?.warn(`audio: sfx render failed for ${id}#${variant}`, err);
    }
  }
}

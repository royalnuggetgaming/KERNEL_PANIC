/**
 * Pure voice-allocation logic for the 32 permanent SFX channel strips (plan section 10 item 10).
 * Each category owns a contiguous range of strips sized by its limit, so a category can never starve
 * another. Inside a full range the oldest voice is stolen. A repeat of the same id within 25 ms is
 * coalesced (returns -1). Voices are reclaimed lazily by their end time: no onended callbacks.
 */
import type { SfxCategory, SfxId } from '../contracts/audio';

export const SFX_CATEGORIES: readonly SfxCategory[] = [
  'weapon',
  'impact',
  'explosion',
  'pickup',
  'player',
  'ui',
  'stinger',
];

export const CATEGORY_LIMITS: Readonly<Record<SfxCategory, number>> = {
  weapon: 8,
  impact: 6,
  explosion: 6,
  pickup: 4,
  player: 4,
  ui: 2,
  stinger: 2,
};

export const VOICE_COUNT = 32;
export const COALESCE_S = 0.025;

/**
 * Scratch inputs for acquireIn(): [nowS, durationS]. The engine's per-request path writes them here instead of
 * passing doubles (a double argument to a call that is not inlined is boxed into a HeapNumber).
 */
export const VOICE_IN = new Float64Array(2);

export class VoicePool {
  readonly size: number;
  private readonly offset: Readonly<Record<SfxCategory, number>>;
  private readonly limits: Readonly<Record<SfxCategory, number>>;
  private readonly ids: (SfxId | null)[];
  private readonly startS: Float64Array;
  private readonly endS: Float64Array;
  private lastNow = 0;
  /** True when the last successful acquire() replaced a still-playing voice (the caller fades it out). */
  lastStolen = false;
  private stolenCount = 0;
  private coalescedCount = 0;

  constructor(size: number, limits: Readonly<Record<SfxCategory, number>>) {
    let total = 0;
    const offset: Partial<Record<SfxCategory, number>> = {};
    for (let i = 0; i < SFX_CATEGORIES.length; i++) {
      const c = SFX_CATEGORIES[i]!;
      const lim = limits[c];
      if (!Number.isInteger(lim) || lim < 1) throw new RangeError(`VoicePool: bad limit for ${c}`);
      offset[c] = total;
      total += lim;
    }
    if (total > size) throw new RangeError(`VoicePool: category limits (${total}) exceed size (${size})`);
    this.size = size;
    this.limits = limits;
    this.offset = offset as Readonly<Record<SfxCategory, number>>;
    this.ids = [];
    for (let i = 0; i < size; i++) this.ids.push(null);
    this.startS = new Float64Array(size).fill(-Infinity);
    this.endS = new Float64Array(size).fill(-Infinity);
  }

  /** First strip index of a category's range. */
  rangeStart(category: SfxCategory): number {
    return this.offset[category];
  }

  /** Voice index to use (stealing the oldest in the category), or -1 when coalesced (same id within 25 ms). */
  acquire(id: SfxId, category: SfxCategory, nowS: number, durationS: number): number {
    VOICE_IN[0] = nowS;
    VOICE_IN[1] = durationS;
    return this.acquireIn(id, category);
  }

  /** acquire() with nowS, durationS read from VOICE_IN. */
  acquireIn(id: SfxId, category: SfxCategory): number {
    const nowS = VOICE_IN[0]!;
    const durationS = VOICE_IN[1]!;
    if (nowS > this.lastNow) this.lastNow = nowS;
    const lo = this.offset[category];
    const hi = lo + this.limits[category];
    let free = -1;
    let oldest = lo;
    for (let i = lo; i < hi; i++) {
      if (this.ids[i] === id && nowS - this.startS[i]! < COALESCE_S && nowS >= this.startS[i]!) {
        this.coalescedCount++;
        return -1;
      }
      if (free < 0 && this.endS[i]! <= nowS) free = i;
      if (this.startS[i]! < this.startS[oldest]!) oldest = i;
    }
    let v = free;
    this.lastStolen = false;
    if (v < 0) {
      v = oldest;
      this.lastStolen = true;
      this.stolenCount++;
    }
    this.ids[v] = id;
    this.startS[v] = nowS;
    this.endS[v] = nowS + (durationS > 0 ? durationS : 0);
    return v;
  }

  /** Voices replaced while still sounding. */
  get stolen(): number {
    return this.stolenCount;
  }

  /** Requests dropped because the same id started within COALESCE_S. */
  get coalesced(): number {
    return this.coalescedCount;
  }

  /** Voices still sounding at `nowS`. */
  activeAt(nowS: number): number {
    let n = 0;
    for (let i = 0; i < this.size; i++) if (this.endS[i]! > nowS) n++;
    return n;
  }

  /** Voices still sounding at the latest time passed to acquire(). */
  get active(): number {
    return this.activeAt(this.lastNow);
  }

  /** Id playing on a voice (null when never used). */
  idAt(voice: number): SfxId | null {
    return this.ids[voice] ?? null;
  }

  /** Marks every voice free (e.g. after the context is recreated). */
  reset(): void {
    for (let i = 0; i < this.size; i++) {
      this.ids[i] = null;
      this.startS[i] = -Infinity;
      this.endS[i] = -Infinity;
    }
    this.lastStolen = false;
  }
}

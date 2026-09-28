/**
 * Fade from a frozen overlay frame back to live play (Pause resume, shop -> next wave). The frozen frame is drawn
 * dimmed (PlayingState FREEZE_DIM); switching straight to the full-brightness live frame is a one-frame
 * luminance step that reads as a flash at 120 Hz. Instead the live frame starts at the frozen dim and eases to 0.
 * Pure and allocation-free.
 */

/** Fade length in seconds. */
export const UNFREEZE_FADE_S = 0.28;
/** Fade length with reduce flashes on (gentler ramp). */
export const UNFREEZE_FADE_REDUCED_S = 0.5;

/** Pure: live-frame dim `t` seconds after unfreezing from a frame dimmed by `fromDim` (smoothstep ease-out). */
export function unfreezeDim(fromDim: number, t: number, duration: number): number {
  if (!(fromDim > 0)) return 0;
  const from = fromDim < 1 ? fromDim : 1;
  if (!(duration > 0) || t >= duration) return 0;
  const x = t > 0 ? t / duration : 0;
  const k = x * x * (3 - 2 * x);
  return from * (1 - k);
}

/** Tracks one fade: `begin` when the first live frame follows a frozen one, then `step` every live frame. */
export class UnfreezeFade {
  private from = 0;
  private t = 0;

  get active(): boolean {
    return this.from > 0;
  }

  begin(fromDim: number): void {
    this.from = fromDim > 0 ? fromDim : 0;
    this.t = 0;
  }

  /** Dim for this frame, then advances by dt (`reduced`: reduce-flashes fade length). */
  step(dt: number, reduced: boolean): number {
    if (this.from <= 0) return 0;
    const d = unfreezeDim(this.from, this.t, reduced ? UNFREEZE_FADE_REDUCED_S : UNFREEZE_FADE_S);
    this.t += dt > 0 ? dt : 0;
    if (d <= 0) this.from = 0;
    return d;
  }
}

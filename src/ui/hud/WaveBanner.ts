/**
 * Centre banner for countdowns, sector/cycle titles, CLEAR, SYNC popups and versus round results. Shown/hidden
 * through a class so the CSS can fade and scale it (transform/opacity only).
 */
import type { HudVM } from '../../contracts/ui';
import { Flag, TextSlot, h } from '../dom';

export class WaveBanner {
  readonly el: HTMLDivElement;
  private readonly text: TextSlot;
  private readonly sub: TextSlot;
  private readonly on: Flag;
  /** The sub line is a live number (countdown digit, versus round score): shown large under the title. */
  private readonly count: Flag;

  constructor(doc: Document) {
    const textEl = h(doc, 'div', { className: 'kp-banner-text' });
    const subEl = h(doc, 'div', { className: 'kp-banner-sub' });
    this.el = h(doc, 'div', { className: 'kp-banner', attrs: { 'aria-live': 'polite' } }, textEl, subEl);
    this.text = new TextSlot(textEl);
    this.sub = new TextSlot(subEl);
    this.on = new Flag(this.el, 'is-on');
    this.count = new Flag(this.el, 'is-count');
  }

  render(banner: HudVM['banner']): void {
    // Keep the last text while fading out so the exit animation does not flash empty.
    if (banner.visible) {
      this.text.set(banner.text);
      if (banner.sub !== this.sub.value) this.count.set(isScoreText(banner.sub));
      this.sub.set(banner.sub);
    }
    this.on.set(banner.visible);
  }
}

/** True for a non-empty sub line made only of digits, spaces and ':' ("3", "1 : 0"). No allocation. */
export function isScoreText(s: string): boolean {
  if (s.length === 0) return false;
  let digits = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 48 && c <= 57) digits++;
    else if (c !== 32 && c !== 58) return false;
  }
  return digits > 0;
}

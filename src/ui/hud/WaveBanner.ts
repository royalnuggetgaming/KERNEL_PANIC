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

  constructor(doc: Document) {
    const textEl = h(doc, 'div', { className: 'kp-banner-text' });
    const subEl = h(doc, 'div', { className: 'kp-banner-sub' });
    this.el = h(doc, 'div', { className: 'kp-banner', attrs: { 'aria-live': 'polite' } }, textEl, subEl);
    this.text = new TextSlot(textEl);
    this.sub = new TextSlot(subEl);
    this.on = new Flag(this.el, 'is-on');
  }

  render(banner: HudVM['banner']): void {
    // Keep the last text while fading out so the exit animation does not flash empty.
    if (banner.visible) {
      this.text.set(banner.text);
      this.sub.set(banner.sub);
    }
    this.on.set(banner.visible);
  }
}

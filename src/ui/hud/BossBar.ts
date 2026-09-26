/** Boss health bar across the top of the arena view (name + transform-driven fill). */
import type { HudVM } from '../../contracts/ui';
import { Flag, TextSlot, h } from '../dom';
import { Meter } from '../widgets/Meter';

export class BossBar {
  readonly el: HTMLDivElement;
  private readonly name: TextSlot;
  private readonly meter: Meter;
  private readonly on: Flag;

  constructor(doc: Document) {
    const nameEl = h(doc, 'span', { className: 'kp-boss-name' });
    this.meter = new Meter(doc, 'kp-boss-hp');
    this.el = h(doc, 'div', { className: 'kp-boss' }, nameEl, this.meter.el);
    this.name = new TextSlot(nameEl);
    this.on = new Flag(this.el, 'is-on');
  }

  render(boss: HudVM['boss']): void {
    this.on.set(boss.visible);
    if (!boss.visible) return;
    this.name.set(boss.name);
    this.meter.set(boss.hpFrac);
  }
}

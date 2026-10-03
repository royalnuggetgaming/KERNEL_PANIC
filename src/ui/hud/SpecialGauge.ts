/**
 * The special-ability row of a player panel: 'RAILBURST [E]' (live key), the Overdrive meter and its percentage.
 * Full meter: the row switches to a glowing, pulsing READY state (the pulse is dropped under reduce flashes by
 * hud.css). While the special runs, the meter shows the remaining time and the text reads ACTIVE. Bars/flags
 * update every render, text only on change; percentage strings come from a shared table (no allocation).
 */
import type { HudPlayerVM } from '../../contracts/ui';
import { Flag, TextSlot, h } from '../dom';
import { Meter } from '../widgets/Meter';

const PCT: readonly string[] = Array.from({ length: 101 }, (_, i) => `${i}%`);
export const SPECIAL_READY_TEXT = 'READY';
export const SPECIAL_ACTIVE_TEXT = 'ACTIVE';

/** Right-hand status text for a gauge state. */
export function specialStatusText(vm: Readonly<HudPlayerVM>): string {
  if (vm.specialActiveFrac > 0) return SPECIAL_ACTIVE_TEXT;
  if (vm.overdriveFrac >= 1) return SPECIAL_READY_TEXT;
  const i = Math.max(0, Math.min(100, Math.floor(vm.specialPercent)));
  return PCT[i]!;
}

export class SpecialGauge {
  readonly el: HTMLDivElement;
  private readonly label: TextSlot;
  private readonly status: TextSlot;
  private readonly meter: Meter;
  private readonly ready: Flag;
  private readonly active: Flag;

  constructor(doc: Document) {
    const labelEl = h(doc, 'span', { className: 'kp-sp-label' });
    const statusEl = h(doc, 'span', { className: 'kp-sp-status' });
    this.meter = new Meter(doc, 'kp-pp-od');
    this.el = h(
      doc,
      'div',
      { className: 'kp-sp' },
      h(doc, 'div', { className: 'kp-sp-head' }, labelEl, statusEl),
      this.meter.el,
    );
    this.label = new TextSlot(labelEl);
    this.status = new TextSlot(statusEl);
    this.ready = new Flag(this.el, 'is-ready');
    this.active = new Flag(this.el, 'is-active');
  }

  render(vm: Readonly<HudPlayerVM>): void {
    const active = vm.specialActiveFrac > 0;
    this.active.set(active);
    this.ready.set(!active && vm.overdriveFrac >= 1);
    this.meter.set(active ? vm.specialActiveFrac : vm.overdriveFrac);
    this.label.set(vm.specialLabel);
    this.status.set(specialStatusText(vm));
  }
}

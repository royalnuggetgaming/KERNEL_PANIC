/** Boot: title, build progress, 'PRESS ANY KEY' once ready (a click anywhere counts), or the fatal panel. */
import type { BootVM } from '../../contracts/ui';
import type { ScreenView, UiContext } from '../view';
import { ClassSwitch, Shown, TextSlot, h, markClick } from '../dom';
import { formatPercent } from '../format';
import { screenRoot } from '../view';
import { Meter } from '../widgets/Meter';

const PHASE_CLASS: Readonly<Record<BootVM['phase'], string>> = {
  loading: 'phase-loading',
  ready: 'phase-ready',
  fatal: 'phase-fatal',
};

export class BootScreen implements ScreenView<'boot'> {
  readonly id = 'boot' as const;
  readonly el: HTMLElement;
  private readonly title: TextSlot;
  private readonly meter: Meter;
  private readonly percent: TextSlot;
  private readonly label: TextSlot;
  private readonly loadingShown: Shown;
  private readonly readyShown: Shown;
  private readonly fatalShown: Shown;
  private readonly error: TextSlot;
  private readonly phase: ClassSwitch;

  constructor(ctx: UiContext) {
    const doc = ctx.doc;
    this.el = screenRoot(ctx, 'boot', 'kp-center');
    markClick(this.el, 'confirm', 'any', 'boot');
    const titleEl = h(doc, 'h1', { className: 'kp-title kp-glitch' });
    this.meter = new Meter(doc, 'kp-boot-meter');
    const percentEl = h(doc, 'span', { className: 'kp-boot-pct' });
    const labelEl = h(doc, 'p', { className: 'kp-boot-label' });
    const loading = h(
      doc,
      'div',
      { className: 'kp-boot-loading' },
      h(doc, 'div', { className: 'kp-boot-bar' }, this.meter.el, percentEl),
      labelEl,
    );
    const ready = h(doc, 'p', { className: 'kp-boot-ready kp-blink', text: 'PRESS ANY KEY' });
    const errorEl = h(doc, 'pre', { className: 'kp-boot-error' });
    const fatal = h(
      doc,
      'div',
      { className: 'kp-panel kp-boot-fatal', attrs: { role: 'alert' } },
      h(doc, 'h2', { className: 'kp-danger', text: 'KERNEL PANIC: FATAL' }),
      errorEl,
      h(doc, 'p', {
        className: 'kp-dim',
        text: 'Reload the page. KERNEL PANIC needs WebGL2 (a current Chrome, Edge, Firefox or Safari).',
      }),
    );
    this.el.appendChild(h(doc, 'div', { className: 'kp-boot' }, titleEl, loading, ready, fatal));
    this.title = new TextSlot(titleEl);
    this.percent = new TextSlot(percentEl);
    this.label = new TextSlot(labelEl);
    this.loadingShown = new Shown(loading);
    this.readyShown = new Shown(ready, false);
    this.fatalShown = new Shown(fatal, false);
    this.error = new TextSlot(errorEl);
    this.phase = new ClassSwitch(this.el);
  }

  render(vm: BootVM): boolean {
    this.title.set(vm.title);
    this.phase.set(PHASE_CLASS[vm.phase]);
    this.loadingShown.set(vm.phase === 'loading');
    this.readyShown.set(vm.phase === 'ready');
    this.fatalShown.set(vm.phase === 'fatal');
    this.meter.set(vm.progress);
    this.percent.set(formatPercent(vm.progress));
    this.label.set(vm.label);
    this.error.set(vm.error ?? '');
    return false;
  }
}

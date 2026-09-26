/**
 * Patch Bay (mid-run shop): two side-by-side ShopPanels, each driven by its owner's cursor; a shared team strip
 * with the Spare Kernel stock (hidden in versus); the EXTRACT / PUSH DEEPER banner on the final visit; the
 * all-ready launch countdown.
 */
import type { ShopVM } from '../../contracts/ui';
import type { ScreenView, UiContext } from '../view';
import { ClassSwitch, Flag, NumSlot, Shown, TextSlot, button, h } from '../dom';
import { formatTenths } from '../format';
import { screenRoot } from '../view';
import { ShopPanel } from '../widgets/ShopPanel';

export class ShopScreen implements ScreenView<'shop'> {
  readonly id = 'shop' as const;
  readonly el: HTMLElement;
  private readonly title: TextSlot;
  private readonly subtitle: TextSlot;
  private readonly panels: readonly [ShopPanel, ShopPanel];
  private readonly teamShown: Shown;
  private readonly kernels: NumSlot;
  private readonly finalShown: Shown;
  private readonly extractText: TextSlot;
  private readonly pushText: TextSlot;
  private readonly extractOn: Flag;
  private readonly pushOn: Flag;
  private readonly countdownShown: Shown;
  private readonly countdown: TextSlot;
  private readonly modeClass: ClassSwitch;

  constructor(ctx: UiContext) {
    const doc = ctx.doc;
    const names = ctx.theme.names;
    this.el = screenRoot(ctx, 'shop', 'kp-overlay kp-shop');
    const titleEl = h(doc, 'h2', { className: 'kp-panel-title kp-shop-title' });
    const subtitleEl = h(doc, 'p', { className: 'kp-shop-subtitle kp-dim' });
    this.panels = [new ShopPanel(ctx, 0), new ShopPanel(ctx, 1)];
    const kernelsEl = h(doc, 'span', { className: 'kp-team-kernels-num' });
    const teamStrip = h(
      doc,
      'div',
      { className: 'kp-team-strip' },
      h(doc, 'span', { className: 'kp-dim', text: names.lives.toUpperCase() + ' ' }),
      kernelsEl,
    );
    const extractBtn = button(doc, 'kp-final-btn kp-final-extract', '', 'confirm', 'any', 'extract');
    const pushBtn = button(doc, 'kp-final-btn kp-final-push', '', 'confirm', 'any', 'pushDeeper');
    const finalEl = h(
      doc,
      'div',
      { className: 'kp-final' },
      h(doc, 'p', { className: 'kp-final-q', text: 'THE KERNEL IS DOWN. CHOOSE:' }),
      h(doc, 'div', { className: 'kp-final-btns' }, extractBtn, pushBtn),
    );
    const countdownEl = h(doc, 'div', { className: 'kp-shop-countdown' });
    this.el.appendChild(
      h(
        doc,
        'div',
        { className: 'kp-shop-wrap' },
        h(doc, 'header', { className: 'kp-shop-top' }, titleEl, subtitleEl, teamStrip),
        finalEl,
        h(doc, 'div', { className: 'kp-shop-panels' }, this.panels[0].el, this.panels[1].el),
      ),
    );
    this.el.appendChild(countdownEl);
    this.title = new TextSlot(titleEl);
    this.subtitle = new TextSlot(subtitleEl);
    this.teamShown = new Shown(teamStrip);
    this.kernels = new NumSlot(kernelsEl, formatStock);
    this.finalShown = new Shown(finalEl, false);
    this.extractText = new TextSlot(extractBtn);
    this.pushText = new TextSlot(pushBtn);
    this.extractOn = new Flag(extractBtn, 'is-selected');
    this.pushOn = new Flag(pushBtn, 'is-selected');
    this.countdownShown = new Shown(countdownEl, false);
    this.countdown = new TextSlot(countdownEl);
    this.modeClass = new ClassSwitch(this.el);
  }

  onShow(): void {
    this.panels[0].reset();
    this.panels[1].reset();
  }

  render(vm: ShopVM, nowMs: number): boolean {
    this.modeClass.set(vm.mode === 'versus' ? 'mode-versus' : vm.mode === 'solo' ? 'mode-solo' : 'mode-coop');
    this.title.set(vm.title);
    this.subtitle.set(vm.subtitle);
    this.teamShown.set(vm.teamVisible);
    if (vm.teamVisible) this.kernels.set(vm.kernels);
    const fc = vm.finalChoice;
    this.finalShown.set(fc.visible);
    if (fc.visible) {
      this.extractText.set(fc.extractLabel);
      this.pushText.set(fc.pushLabel);
      this.extractOn.set(fc.selected === 'extract');
      this.pushOn.set(fc.selected === 'pushDeeper');
    }
    this.countdownShown.set(vm.countdown !== null);
    if (vm.countdown !== null) this.countdown.set('LAUNCH ' + formatTenths(vm.countdown));
    const a = this.panels[0].render(vm.panels[0], nowMs);
    const b = this.panels[1].render(vm.panels[1], nowMs);
    return a || b;
  }
}

function formatStock(n: number): string {
  return '×' + String(Math.max(0, Math.floor(n)));
}

/** Settings / Controls / Credits sub-panels shared by MainMenu and Pause (not FSM states). */
import type { ControlsPanelVM, SettingsPanelVM, SubPanel } from '../../contracts/ui';
import { Shown, TextSlot, ViewPool, button, h } from '../dom';
import { ControlsPanel } from './ControlsPanel';
import { SettingsPanel } from './SettingsPanel';

class CreditLine {
  readonly el: HTMLParagraphElement;
  readonly text: TextSlot;

  constructor(doc: Document) {
    this.el = h(doc, 'p', { className: 'kp-credit' });
    this.text = new TextSlot(this.el);
  }
}

export class SubPanels {
  readonly el: HTMLDivElement;
  private readonly settings: SettingsPanel;
  private readonly controls: ControlsPanel;
  private readonly credits: ViewPool<CreditLine>;
  private readonly settingsShown: Shown;
  private readonly controlsShown: Shown;
  private readonly creditsShown: Shown;

  constructor(doc: Document) {
    this.settings = new SettingsPanel(doc);
    this.controls = new ControlsPanel(doc);
    const creditList = h(doc, 'div', { className: 'kp-credit-list' });
    const creditsEl = h(
      doc,
      'div',
      { className: 'kp-panel kp-credits' },
      h(doc, 'h2', { className: 'kp-panel-title', text: 'CREDITS' }),
      creditList,
      button(doc, 'kp-btn kp-back', 'BACK', 'back', 'any', 'back'),
    );
    this.credits = new ViewPool(creditList, () => new CreditLine(doc));
    this.el = h(doc, 'div', { className: 'kp-subpanels' }, this.settings.el, this.controls.el, creditsEl);
    this.settingsShown = new Shown(this.settings.el, false);
    this.controlsShown = new Shown(this.controls.el, false);
    this.creditsShown = new Shown(creditsEl, false);
  }

  /** Returns true when a sub-panel is open (the caller hides its menu list). */
  render(
    panel: SubPanel,
    settings: SettingsPanelVM | null,
    controls: ControlsPanelVM | null,
    credits: readonly string[],
  ): boolean {
    const showSettings = panel === 'settings' && settings !== null;
    const showControls = panel === 'controls' && controls !== null;
    const showCredits = panel === 'credits';
    this.settingsShown.set(showSettings);
    this.controlsShown.set(showControls);
    this.creditsShown.set(showCredits);
    if (showSettings) this.settings.render(settings);
    if (showControls) this.controls.render(controls);
    if (showCredits) {
      this.credits.ensure(credits.length);
      for (let i = 0; i < credits.length; i++) this.credits.get(i).text.set(credits[i]!);
    }
    return showSettings || showControls || showCredits;
  }
}

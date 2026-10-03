/** Settings / Controls / Credits / HOW TO PLAY sub-panels shared by MainMenu and Pause (not FSM states). */
import type { ControlsPanelVM, ManualVM, SettingsPanelVM, SubPanel, TerminalVM } from '../../contracts/ui';
import { Shown, TextSlot, ViewPool, button, h } from '../dom';
import { ControlsPanel } from './ControlsPanel';
import { ManualPanel } from './ManualPanel';
import { SettingsPanel } from './SettingsPanel';
import { TerminalPanel } from './TerminalPanel';

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
  private readonly manual: ManualPanel;
  private readonly manualShown: Shown;
  private readonly terminal: TerminalPanel;
  private readonly terminalShown: Shown;

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
    this.manual = new ManualPanel(doc);
    this.terminal = new TerminalPanel(doc);
    this.el = h(
      doc,
      'div',
      { className: 'kp-subpanels' },
      this.settings.el,
      this.controls.el,
      creditsEl,
      this.manual.el,
      this.terminal.el,
    );
    this.terminalShown = new Shown(this.terminal.el, false);
    this.manualShown = new Shown(this.manual.el, false);
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
    manual: ManualVM | null = null,
    terminal: TerminalVM | null = null,
  ): boolean {
    const showTerminal = panel === 'terminal' && terminal !== null;
    this.terminalShown.set(showTerminal);
    if (showTerminal) this.terminal.render(terminal);
    const showSettings = panel === 'settings' && settings !== null;
    const showControls = panel === 'controls' && controls !== null;
    const showCredits = panel === 'credits';
    const showManual = panel === 'manual' && manual !== null;
    this.manualShown.set(showManual);
    if (showManual) this.manual.render(manual);
    this.settingsShown.set(showSettings);
    this.controlsShown.set(showControls);
    this.creditsShown.set(showCredits);
    if (showSettings) this.settings.render(settings);
    if (showControls) this.controls.render(controls);
    if (showCredits) {
      this.credits.ensure(credits.length);
      for (let i = 0; i < credits.length; i++) this.credits.get(i).text.set(credits[i]!);
    }
    return showSettings || showControls || showCredits || showManual || showTerminal;
  }
}

/**
 * TERMINAL sub-panel (main menu): green-on-black scrollback, the prompt with a blinking caret, the unlocked
 * cheats as clickable ON/OFF rows and the no-Cores warning. Keys are captured by the state layer (no DOM input
 * element, so typing never reaches the page or the game).
 */
import type { TerminalCheatVM, TerminalVM } from '../../contracts/ui';
import { ATTR_ITEM, AttrSlot, ClassSwitch, Flag, Shown, TextSlot, ViewPool, button, h, markClick } from '../dom';

class LineView {
  readonly el: HTMLParagraphElement;
  readonly text: TextSlot;
  private readonly kind: ClassSwitch;

  constructor(doc: Document) {
    this.el = h(doc, 'p', { className: 'kp-term-line' });
    this.text = new TextSlot(this.el);
    this.kind = new ClassSwitch(this.el);
  }

  set(line: string): void {
    this.text.set(line);
    this.kind.set(
      line.startsWith('ACCESS GRANTED')
        ? 'is-granted'
        : line.startsWith('ACCESS DENIED')
          ? 'is-denied'
          : line.startsWith('> ')
            ? 'is-echo'
            : '',
    );
  }
}

class CheatRowView {
  readonly el: HTMLDivElement;
  private readonly state: TextSlot;
  private readonly label: TextSlot;
  private readonly code: TextSlot;
  private readonly desc: TextSlot;
  private readonly item: AttrSlot;
  private readonly on: Flag;
  private readonly cursor: Flag;

  constructor(doc: Document) {
    const stateEl = h(doc, 'span', { className: 'kp-term-state' });
    const labelEl = h(doc, 'span', { className: 'kp-term-label' });
    const codeEl = h(doc, 'span', { className: 'kp-term-code kp-dim' });
    const descEl = h(doc, 'span', { className: 'kp-term-desc kp-dim' });
    this.el = h(doc, 'div', { className: 'kp-term-cheat' }, stateEl, labelEl, codeEl, descEl);
    markClick(this.el, 'confirm', 'any', null);
    this.state = new TextSlot(stateEl);
    this.label = new TextSlot(labelEl);
    this.code = new TextSlot(codeEl);
    this.desc = new TextSlot(descEl);
    this.item = new AttrSlot(this.el, ATTR_ITEM);
    this.on = new Flag(this.el, 'is-on');
    this.cursor = new Flag(this.el, 'is-cursor');
  }

  set(vm: TerminalCheatVM, cursor: boolean): void {
    this.state.set(vm.enabled ? '[ON]' : '[OFF]');
    this.label.set(vm.label);
    this.code.set(vm.code);
    this.desc.set(vm.desc);
    this.item.set(vm.id);
    this.on.set(vm.enabled);
    this.cursor.set(cursor);
  }
}

export class TerminalPanel {
  readonly el: HTMLDivElement;
  private readonly lines: ViewPool<LineView>;
  private readonly input: TextSlot;
  private readonly cheats: ViewPool<CheatRowView>;
  private readonly cheatsShown: Shown;
  private readonly hint: TextSlot;
  private readonly warning: TextSlot;
  private readonly flash: ClassSwitch;
  private readonly promptCursor: Flag;

  constructor(doc: Document) {
    const log = h(doc, 'div', { className: 'kp-term-log' });
    const inputEl = h(doc, 'span', { className: 'kp-term-input' });
    const prompt = h(
      doc,
      'p',
      { className: 'kp-term-prompt' },
      h(doc, 'span', { className: 'kp-term-ps1', text: 'root@kernel:~# ' }),
      inputEl,
      h(doc, 'span', { className: 'kp-term-caret', text: '█' }),
    );
    const cheatList = h(doc, 'div', { className: 'kp-term-cheats' });
    const cheatBox = h(
      doc,
      'div',
      { className: 'kp-term-cheatbox' },
      h(doc, 'h3', { className: 'kp-term-sub', text: 'UNLOCKED CHEATS (click or ↑ ↓ + ENTER to toggle)' }),
      cheatList,
    );
    const warnEl = h(doc, 'p', { className: 'kp-term-warn kp-warn' });
    const hintEl = h(doc, 'p', { className: 'kp-term-hint kp-dim' });
    this.el = h(
      doc,
      'div',
      { className: 'kp-panel kp-terminal' },
      h(doc, 'h2', { className: 'kp-panel-title', text: 'TERMINAL' }),
      h(doc, 'div', { className: 'kp-term-screen' }, log, prompt),
      warnEl,
      cheatBox,
      hintEl,
      button(doc, 'kp-btn kp-back', 'CLOSE', 'back', 'any', 'back'),
    );
    this.lines = new ViewPool(log, () => new LineView(doc));
    this.input = new TextSlot(inputEl);
    this.cheats = new ViewPool(cheatList, () => new CheatRowView(doc));
    this.cheatsShown = new Shown(cheatBox, false);
    this.hint = new TextSlot(hintEl);
    this.warning = new TextSlot(warnEl);
    this.flash = new ClassSwitch(this.el);
    this.promptCursor = new Flag(prompt, 'is-cursor');
  }

  render(vm: TerminalVM): void {
    this.lines.ensure(vm.lines.length);
    for (let i = 0; i < vm.lines.length; i++) this.lines.get(i).set(vm.lines[i]!);
    this.input.set(vm.input);
    this.cheats.ensure(vm.cheats.length);
    for (let i = 0; i < vm.cheats.length; i++) this.cheats.get(i).set(vm.cheats[i]!, i === vm.cursor);
    this.cheatsShown.set(vm.cheats.length > 0);
    this.hint.set(vm.hint);
    this.warning.set(vm.warning);
    this.flash.set(vm.flash === '' ? '' : `flash-${vm.flash}`);
    this.promptCursor.set(vm.cursor < 0);
  }
}

/**
 * Controls sub-panel: per-player rebinding lists (keycaps per action), the capture-next-key flow with its swap
 * offer, and the Key Test rollover readout (live held keycaps + max simultaneous keys).
 */
import type { PlayerIndex } from '../../contracts/ids';
import type { ControlsPanelVM, ControlsRowVM, KeyCapVM } from '../../contracts/ui';
import { AttrSlot, Flag, NumSlot, Shown, TextSlot, ViewPool, button, h, markClick } from '../dom';
import { playerTag } from '../format';
import { KeyCap } from '../widgets/KeyCap';

class KeyCapView {
  readonly el: HTMLSpanElement;
  readonly cap: KeyCap;

  constructor(doc: Document) {
    this.cap = new KeyCap(doc);
    this.el = this.cap.el;
  }
}

function renderCaps(pool: ViewPool<KeyCapView>, caps: readonly KeyCapVM[]): void {
  pool.ensure(caps.length);
  for (let i = 0; i < caps.length; i++) pool.get(i).cap.set(caps[i]!);
}

class ControlsRowView {
  readonly el: HTMLButtonElement;
  private readonly label: TextSlot;
  private readonly caps: ViewPool<KeyCapView>;
  private readonly capsShown: Shown;
  private readonly promptShown: Shown;
  private readonly item: AttrSlot;
  private readonly cursor: Flag;
  private readonly capturing: Flag;

  constructor(doc: Document, player: PlayerIndex) {
    const labelEl = h(doc, 'span', { className: 'kp-ctl-label' });
    const capsEl = h(doc, 'span', { className: 'kp-ctl-caps' });
    const promptEl = h(doc, 'span', { className: 'kp-ctl-prompt kp-blink', text: 'PRESS A KEY  (ESC CANCELS)' });
    this.el = h(
      doc,
      'button',
      { className: 'kp-ctl-row', attrs: { type: 'button', tabindex: '-1' } },
      h(doc, 'span', { className: 'kp-caret', text: '>' }),
      labelEl,
      capsEl,
      promptEl,
    );
    markClick(this.el, 'confirm', player, null);
    this.label = new TextSlot(labelEl);
    this.caps = new ViewPool(capsEl, () => new KeyCapView(doc));
    this.capsShown = new Shown(capsEl);
    this.promptShown = new Shown(promptEl, false);
    this.item = new AttrSlot(this.el, 'data-item');
    this.cursor = new Flag(this.el, 'is-cursor');
    this.capturing = new Flag(this.el, 'is-capturing');
  }

  set(vm: ControlsRowVM, cursor: boolean, capturing: boolean): void {
    this.label.set(vm.label);
    this.item.set(vm.action);
    this.cursor.set(cursor);
    this.capturing.set(capturing);
    this.capsShown.set(!capturing);
    this.promptShown.set(capturing);
    renderCaps(this.caps, vm.keys);
  }
}

class PlayerColumn {
  readonly el: HTMLDivElement;
  private readonly rows: ViewPool<ControlsRowView>;
  private readonly player: PlayerIndex;

  constructor(doc: Document, player: PlayerIndex) {
    this.player = player;
    const list = h(doc, 'div', { className: 'kp-ctl-list' });
    const tag = playerTag(player);
    this.el = h(
      doc,
      'div',
      { className: `kp-ctl-col kp-${tag.toLowerCase()}` },
      h(doc, 'h3', { className: 'kp-ctl-head', text: tag }),
      list,
    );
    this.rows = new ViewPool(list, () => new ControlsRowView(doc, player));
  }

  render(rows: readonly ControlsRowVM[], vm: ControlsPanelVM): void {
    this.rows.ensure(rows.length);
    const cap = vm.capturing;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const cursor = vm.cursor.player === this.player && vm.cursor.row === i;
      const capturing = cap !== null && cap.player === this.player && cap.action === row.action;
      this.rows.get(i).set(row, cursor, capturing);
    }
  }
}

export class ControlsPanel {
  readonly el: HTMLElement;
  private readonly cols: readonly [PlayerColumn, PlayerColumn];
  private readonly swap: TextSlot;
  private readonly swapShown: Shown;
  private readonly message: TextSlot;
  private readonly keyTestShown: Shown;
  private readonly keyTestPrompt: TextSlot;
  private readonly held: ViewPool<KeyCapView>;
  private readonly maxHeld: NumSlot;
  private readonly keyTestBtn: TextSlot;
  private readonly keyTestOn: Flag;

  constructor(doc: Document) {
    this.cols = [new PlayerColumn(doc, 0), new PlayerColumn(doc, 1)];
    const swapEl = h(doc, 'p', { className: 'kp-ctl-swap kp-warn' });
    const msgEl = h(doc, 'p', { className: 'kp-ctl-msg kp-dim' });
    const promptEl = h(doc, 'p', { className: 'kp-kt-prompt' });
    const heldEl = h(doc, 'div', { className: 'kp-kt-held' });
    const maxEl = h(doc, 'span', { className: 'kp-kt-max-num' });
    const keyTest = h(
      doc,
      'div',
      { className: 'kp-keytest' },
      h(doc, 'h3', { className: 'kp-panel-sub', text: 'KEY TEST' }),
      promptEl,
      heldEl,
      h(doc, 'p', { className: 'kp-kt-max' }, h(doc, 'span', { text: 'MAX HELD AT ONCE: ' }), maxEl),
    );
    const ktBtn = button(doc, 'kp-btn', 'KEY TEST', 'confirm', 'any', 'keyTest');
    this.el = h(
      doc,
      'div',
      { className: 'kp-panel kp-controls' },
      h(doc, 'h2', { className: 'kp-panel-title', text: 'CONTROLS' }),
      h(doc, 'div', { className: 'kp-ctl-cols' }, this.cols[0].el, this.cols[1].el),
      swapEl,
      keyTest,
      msgEl,
      h(
        doc,
        'div',
        { className: 'kp-btn-row' },
        ktBtn,
        button(doc, 'kp-btn kp-back', 'BACK', 'back', 'any', 'back'),
      ),
    );
    this.swap = new TextSlot(swapEl);
    this.swapShown = new Shown(swapEl, false);
    this.message = new TextSlot(msgEl);
    this.keyTestShown = new Shown(keyTest, false);
    this.keyTestPrompt = new TextSlot(promptEl);
    this.held = new ViewPool(heldEl, () => new KeyCapView(doc));
    this.maxHeld = new NumSlot(maxEl, String);
    this.keyTestBtn = new TextSlot(ktBtn);
    this.keyTestOn = new Flag(ktBtn, 'is-on');
  }

  render(vm: ControlsPanelVM): void {
    this.cols[0].render(vm.players[0], vm);
    this.cols[1].render(vm.players[1], vm);
    this.swapShown.set(vm.swapOffer !== null);
    this.swap.set(vm.swapOffer ?? '');
    this.message.set(vm.message);
    const kt = vm.keyTest;
    this.keyTestShown.set(kt.active);
    this.keyTestOn.set(kt.active);
    this.keyTestBtn.set(kt.active ? 'END KEY TEST' : 'KEY TEST');
    if (kt.active) {
      this.keyTestPrompt.set(kt.prompt);
      renderCaps(this.held, kt.held);
      this.maxHeld.set(kt.maxSimultaneous);
    }
  }
}

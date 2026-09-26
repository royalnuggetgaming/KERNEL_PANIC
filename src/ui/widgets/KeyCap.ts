/** A live keycap for the Key Test and the controls list: the key label plus a held highlight. */
import type { KeyCapVM } from '../../contracts/ui';
import { AttrSlot, Flag, TextSlot, h } from '../dom';

export class KeyCap {
  readonly el: HTMLSpanElement;
  private readonly label: TextSlot;
  private readonly held: Flag;
  private readonly code: AttrSlot;

  constructor(doc: Document) {
    this.el = h(doc, 'span', { className: 'kp-keycap' });
    this.label = new TextSlot(this.el);
    this.held = new Flag(this.el, 'is-held');
    this.code = new AttrSlot(this.el, 'data-code');
  }

  set(vm: KeyCapVM): void {
    this.label.set(vm.label);
    this.held.set(vm.held);
    this.code.set(vm.code);
  }
}

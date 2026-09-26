/**
 * Settings sub-panel (MainMenu and Pause): volumes, quality, frame cap, shake, reduce flashes/motion, colourblind,
 * per-player autofire and focus mode, theme (applies on reload), FPS. Sliders get clickable left/right arrows;
 * other rows are confirm targets.
 */
import type { SettingKind, SettingRowVM, SettingsPanelVM } from '../../contracts/ui';
import { AttrSlot, ClassSwitch, Flag, Shown, TextSlot, ViewPool, button, h, markClick } from '../dom';
import { Meter } from '../widgets/Meter';

const KIND_CLASS: Readonly<Record<SettingKind, string>> = {
  slider: 'set-slider',
  toggle: 'set-toggle',
  choice: 'set-choice',
  action: 'set-action',
};

class SettingRowView {
  readonly el: HTMLDivElement;
  private readonly label: TextSlot;
  private readonly value: TextSlot;
  private readonly meter: Meter;
  private readonly sliderShown: Shown;
  private readonly leftItem: AttrSlot;
  private readonly rightItem: AttrSlot;
  private readonly valueItem: AttrSlot;
  private readonly kind: ClassSwitch;
  private readonly cursor: Flag;
  private readonly on: Flag;

  constructor(doc: Document) {
    const labelEl = h(doc, 'span', { className: 'kp-set-label' });
    const valueBtn = h(doc, 'button', {
      className: 'kp-set-value',
      attrs: { type: 'button', tabindex: '-1' },
    });
    markClick(valueBtn, 'confirm', 'any', null);
    const left = button(doc, 'kp-arrow', '◀', 'left', 'any', null);
    const right = button(doc, 'kp-arrow', '▶', 'right', 'any', null);
    this.meter = new Meter(doc, 'kp-set-meter');
    const slider = h(doc, 'span', { className: 'kp-set-slider' }, left, this.meter.el, right);
    this.el = h(
      doc,
      'div',
      { className: 'kp-set-row' },
      h(doc, 'span', { className: 'kp-caret', text: '>' }),
      labelEl,
      slider,
      valueBtn,
    );
    this.label = new TextSlot(labelEl);
    this.value = new TextSlot(valueBtn);
    this.sliderShown = new Shown(slider, false);
    this.leftItem = new AttrSlot(left, 'data-item');
    this.rightItem = new AttrSlot(right, 'data-item');
    this.valueItem = new AttrSlot(valueBtn, 'data-item');
    this.kind = new ClassSwitch(this.el);
    this.cursor = new Flag(this.el, 'is-cursor');
    this.on = new Flag(this.el, 'is-on');
  }

  set(vm: SettingRowVM, cursor: boolean): void {
    this.label.set(vm.label);
    this.value.set(vm.value);
    this.kind.set(KIND_CLASS[vm.kind]);
    this.cursor.set(cursor);
    this.valueItem.set(vm.id);
    const slider = vm.kind === 'slider';
    this.sliderShown.set(slider);
    if (slider) {
      this.meter.set(vm.fraction);
      this.leftItem.set(vm.id);
      this.rightItem.set(vm.id);
    }
    this.on.set(vm.kind === 'toggle' && vm.value === 'ON');
  }
}

export class SettingsPanel {
  readonly el: HTMLElement;
  private readonly rows: ViewPool<SettingRowView>;
  private readonly note: TextSlot;

  constructor(doc: Document) {
    const list = h(doc, 'div', { className: 'kp-set-list' });
    const noteEl = h(doc, 'p', { className: 'kp-set-note kp-dim' });
    this.el = h(
      doc,
      'div',
      { className: 'kp-panel kp-settings' },
      h(doc, 'h2', { className: 'kp-panel-title', text: 'SETTINGS' }),
      list,
      noteEl,
      button(doc, 'kp-btn kp-back', 'BACK', 'back', 'any', 'back'),
    );
    this.rows = new ViewPool(list, () => new SettingRowView(doc));
    this.note = new TextSlot(noteEl);
  }

  render(vm: SettingsPanelVM): void {
    this.rows.ensure(vm.rows.length);
    for (let i = 0; i < vm.rows.length; i++) this.rows.get(i).set(vm.rows[i]!, i === vm.cursor);
    this.note.set(vm.note);
  }
}

/**
 * CharacterSelect: two player slots (drop-in join, vehicle picker, stat bars, lock price, Ready) with per-player
 * cursors, and the MODE row (CO-OP / VERSUS) once P2 has joined. Either player's cursor can sit on the mode row.
 */
import type { PlayerIndex, VehicleId } from '../../contracts/ids';
import type { CharacterSelectVM, SelectSlotVM, StatBarVM } from '../../contracts/ui';
import type { ScreenView, UiContext } from '../view';
import { ClassSwitch, Flag, NumSlot, Shown, TextSlot, ViewPool, button, h, markClick } from '../dom';
import { formatShards, formatTenths, playerTag } from '../format';
import { screenRoot } from '../view';
import { Meter } from '../widgets/Meter';

class StatBarView {
  readonly el: HTMLDivElement;
  private readonly label: TextSlot;
  private readonly value: TextSlot;
  private readonly meter: Meter;

  constructor(doc: Document) {
    const labelEl = h(doc, 'span', { className: 'kp-stat-label' });
    const valueEl = h(doc, 'span', { className: 'kp-stat-value' });
    this.meter = new Meter(doc, 'kp-stat-meter');
    this.el = h(doc, 'div', { className: 'kp-stat' }, labelEl, this.meter.el, valueEl);
    this.label = new TextSlot(labelEl);
    this.value = new TextSlot(valueEl);
  }

  set(vm: StatBarVM): void {
    this.label.set(vm.label);
    this.meter.set(vm.fraction);
    this.value.set(vm.value);
  }
}

class SlotView {
  readonly el: HTMLElement;
  private readonly joinShown: Shown;
  private readonly joinHint: TextSlot;
  private readonly bodyShown: Shown;
  private readonly vehicleName: TextSlot;
  private readonly blurb: TextSlot;
  private readonly special: TextSlot;
  private readonly stats: ViewPool<StatBarView>;
  private readonly lockShown: Shown;
  private readonly lockText: TextSlot;
  private readonly readyText: TextSlot;
  private readonly ready: Flag;
  private readonly locked: Flag;
  private readonly vehicleCursor: Flag;
  private readonly vehicleClass: ClassSwitch;
  private vehicle: VehicleId | null = null;

  constructor(doc: Document, player: PlayerIndex) {
    const tag = playerTag(player);
    const joinHintEl = h(doc, 'span', { className: 'kp-join-hint kp-blink' });
    const join = h(
      doc,
      'button',
      { className: 'kp-join', attrs: { type: 'button', tabindex: '-1' } },
      h(doc, 'span', { className: 'kp-join-plus', text: '+' }),
      joinHintEl,
    );
    markClick(join, 'confirm', player, 'join');
    const nameEl = h(doc, 'span', { className: 'kp-veh-name' });
    const vehRow = h(
      doc,
      'div',
      { className: 'kp-veh-row' },
      button(doc, 'kp-arrow', '◀', 'left', player, 'vehicle'),
      nameEl,
      button(doc, 'kp-arrow', '▶', 'right', player, 'vehicle'),
    );
    const blurbEl = h(doc, 'p', { className: 'kp-veh-blurb' });
    const specialEl = h(doc, 'span', { className: 'kp-veh-special-name' });
    const statsEl = h(doc, 'div', { className: 'kp-stats' });
    const lockTextEl = h(doc, 'span', { className: 'kp-veh-lock-text' });
    const lockEl = h(doc, 'div', { className: 'kp-veh-lock' }, lockTextEl);
    const readyBtn = button(doc, 'kp-btn kp-ready-btn', 'READY', 'ready', player, 'ready');
    const body = h(
      doc,
      'div',
      { className: 'kp-slot-body' },
      vehRow,
      blurbEl,
      h(
        doc,
        'p',
        { className: 'kp-veh-special' },
        h(doc, 'span', { className: 'kp-dim', text: 'SPECIAL ' }),
        specialEl,
      ),
      statsEl,
      lockEl,
      readyBtn,
    );
    this.el = h(
      doc,
      'article',
      { className: `kp-slot kp-${tag.toLowerCase()}` },
      h(doc, 'header', { className: 'kp-slot-head' }, h(doc, 'span', { className: 'kp-tag', text: tag })),
      join,
      body,
    );
    this.joinShown = new Shown(join, false);
    this.joinHint = new TextSlot(joinHintEl);
    this.bodyShown = new Shown(body);
    this.vehicleName = new TextSlot(nameEl);
    this.blurb = new TextSlot(blurbEl);
    this.special = new TextSlot(specialEl);
    this.stats = new ViewPool(statsEl, () => new StatBarView(doc));
    this.lockShown = new Shown(lockEl, false);
    this.lockText = new TextSlot(lockTextEl);
    this.readyText = new TextSlot(readyBtn);
    this.ready = new Flag(this.el, 'is-ready');
    this.locked = new Flag(this.el, 'is-locked');
    this.vehicleCursor = new Flag(vehRow, 'is-cursor');
    this.vehicleClass = new ClassSwitch(this.el);
  }

  render(vm: SelectSlotVM, metaCurrency: string): void {
    this.joinShown.set(!vm.joined);
    this.bodyShown.set(vm.joined);
    this.joinHint.set(vm.joinHint);
    this.ready.set(vm.joined && vm.ready);
    if (!vm.joined) return;
    if (vm.vehicle !== this.vehicle) {
      this.vehicle = vm.vehicle;
      this.vehicleClass.set('veh-' + vm.vehicle);
    }
    this.vehicleName.set(vm.vehicleName);
    this.blurb.set(vm.blurb);
    this.special.set(vm.specialName);
    this.stats.ensure(vm.stats.length);
    for (let i = 0; i < vm.stats.length; i++) this.stats.get(i).set(vm.stats[i]!);
    this.locked.set(vm.locked);
    this.lockShown.set(vm.locked);
    if (vm.locked) {
      this.lockText.set(
        vm.unlockPrice === null
          ? 'LOCKED'
          : `LOCKED · UNLOCK FOR ${formatShards(vm.unlockPrice)} ${metaCurrency}`,
      );
    }
    this.readyText.set(vm.ready ? 'READY ✓' : 'READY');
    this.vehicleCursor.set(vm.cursorRow === 'vehicle');
  }
}

export class CharacterSelectScreen implements ScreenView<'characterSelect'> {
  readonly id = 'characterSelect' as const;
  readonly el: HTMLElement;
  private readonly slots: readonly [SlotView, SlotView];
  private readonly modeShown: Shown;
  private readonly modeLabel: TextSlot;
  private readonly modeClass: ClassSwitch;
  private readonly modeCursor0: Flag;
  private readonly modeCursor1: Flag;
  private readonly countdownShown: Shown;
  private readonly countdown: TextSlot;
  private readonly cores: NumSlot;
  private readonly currency: TextSlot;
  private readonly message: TextSlot;
  private readonly difficulty: TextSlot;
  private readonly difficultyClass: ClassSwitch;

  constructor(ctx: UiContext) {
    const doc = ctx.doc;
    this.el = screenRoot(ctx, 'characterSelect', 'kp-select');
    this.slots = [new SlotView(doc, 0), new SlotView(doc, 1)];
    const modeLabelEl = h(doc, 'span', { className: 'kp-mode-label' });
    const modeRow = h(
      doc,
      'div',
      { className: 'kp-mode-row' },
      h(doc, 'span', { className: 'kp-mode-cur kp-p1', text: 'P1' }),
      h(doc, 'span', { className: 'kp-dim kp-mode-key', text: 'MODE' }),
      button(doc, 'kp-arrow', '◀', 'left', 'any', 'mode'),
      modeLabelEl,
      button(doc, 'kp-arrow', '▶', 'right', 'any', 'mode'),
      h(doc, 'span', { className: 'kp-mode-cur kp-p2', text: 'P2' }),
    );
    const countdownEl = h(doc, 'div', { className: 'kp-select-countdown' });
    const coresEl = h(doc, 'span', { className: 'kp-cores-num' });
    const currencyEl = h(doc, 'span', { className: 'kp-unit' });
    const msgEl = h(doc, 'p', { className: 'kp-select-msg kp-warn' });
    const diffEl = h(doc, 'span', { className: 'kp-select-diff-value' });
    this.el.appendChild(
      h(
        doc,
        'div',
        { className: 'kp-select-wrap' },
        h(
          doc,
          'header',
          { className: 'kp-select-head' },
          h(doc, 'h2', { className: 'kp-panel-title', text: 'SELECT DAEMON' }),
          h(
            doc,
            'span',
            { className: 'kp-select-diff' },
            h(doc, 'span', { className: 'kp-dim', text: 'DIFFICULTY ' }),
            diffEl,
            h(doc, 'span', { className: 'kp-dim kp-select-diff-hint', text: ' · change in SETTINGS' }),
          ),
          h(doc, 'span', { className: 'kp-cores' }, coresEl, currencyEl),
        ),
        h(doc, 'div', { className: 'kp-slots' }, this.slots[0].el, this.slots[1].el),
        modeRow,
        msgEl,
        h(
          doc,
          'footer',
          { className: 'kp-btn-row' },
          button(doc, 'kp-btn kp-back', 'BACK', 'back', 'any', 'back'),
        ),
      ),
    );
    this.el.appendChild(countdownEl);
    this.modeShown = new Shown(modeRow, false);
    this.modeLabel = new TextSlot(modeLabelEl);
    this.modeClass = new ClassSwitch(modeRow);
    this.modeCursor0 = new Flag(modeRow, 'cur-p1');
    this.modeCursor1 = new Flag(modeRow, 'cur-p2');
    this.countdownShown = new Shown(countdownEl, false);
    this.countdown = new TextSlot(countdownEl);
    this.cores = new NumSlot(coresEl, formatShards);
    this.currency = new TextSlot(currencyEl);
    this.message = new TextSlot(msgEl);
    this.difficulty = new TextSlot(diffEl);
    this.difficultyClass = new ClassSwitch(diffEl);
  }

  render(vm: CharacterSelectVM): boolean {
    this.slots[0].render(vm.slots[0], vm.metaCurrency);
    this.slots[1].render(vm.slots[1], vm.metaCurrency);
    this.modeShown.set(vm.modeRowVisible);
    if (vm.modeRowVisible) {
      this.modeLabel.set(vm.modeLabel);
      this.modeClass.set(vm.mode === 'versus' ? 'mode-versus' : 'mode-coop');
      this.modeCursor0.set(vm.slots[0].joined && vm.slots[0].cursorRow === 'mode');
      this.modeCursor1.set(vm.slots[1].joined && vm.slots[1].cursorRow === 'mode');
    }
    this.countdownShown.set(vm.countdown !== null);
    if (vm.countdown !== null) this.countdown.set('LAUNCHING ' + formatTenths(vm.countdown));
    this.cores.set(vm.cores);
    this.currency.set(' ' + vm.metaCurrency);
    this.message.set(vm.message);
    this.difficulty.set(vm.difficulty);
    this.difficultyClass.set('diff-' + vm.difficulty.toLowerCase());
    return false;
  }
}

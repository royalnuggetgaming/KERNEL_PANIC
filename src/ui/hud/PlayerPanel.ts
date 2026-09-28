/**
 * One player's HUD corner: name + life state, HP bar, dash pips, Overdrive bar, wallet, score, combo, bleed-out
 * and revive bars (co-op), round-win pips (versus), the installed-powerup strip (rebuilt only when its key changes). Bars and flags update every render through transforms and
 * class toggles; numeric text only when `text` is true (the Hud's 10 Hz gate) and only on change.
 */
import type { PlayerIndex } from '../../contracts/ids';
import type { HudPlayerVM } from '../../contracts/ui';
import type { UiContext } from '../view';
import { ClassSwitch, Flag, NumSlot, Shown, TextSlot, ViewPool, h } from '../dom';
import { formatCombo, formatHp, formatShards, playerTag } from '../format';
import { InstalledList } from '../widgets/InstalledList';
import { Meter } from '../widgets/Meter';

const LIFE_LABEL: Readonly<Record<HudPlayerVM['life'], string>> = {
  alive: '',
  downed: 'DOWNED',
  offline: 'OFFLINE',
  respawning: 'REBOOTING',
  absent: '',
  eliminated: 'ELIMINATED',
};

const LIFE_CLASS: Readonly<Record<HudPlayerVM['life'], string>> = {
  alive: 'life-alive',
  downed: 'life-downed',
  offline: 'life-offline',
  respawning: 'life-respawning',
  absent: 'life-absent',
  eliminated: 'life-eliminated',
};

const TIER_CLASS = ['tier-0', 'tier-1', 'tier-2', 'tier-3', 'tier-4', 'tier-5'] as const;

class Pip {
  readonly el: HTMLSpanElement;
  readonly fill: Flag;

  constructor(doc: Document, className: string) {
    this.el = h(doc, 'span', { className });
    this.fill = new Flag(this.el, 'is-full');
  }
}

class DashPip {
  readonly el: HTMLDivElement;
  readonly meter: Meter;

  constructor(doc: Document) {
    this.meter = new Meter(doc, 'kp-dash-pip');
    this.el = this.meter.el;
  }
}

export class PlayerPanel {
  readonly el: HTMLElement;
  private readonly shown: Shown;
  private readonly name: TextSlot;
  private readonly life: TextSlot;
  private readonly lifeClass: ClassSwitch;
  private readonly hpMeter: Meter;
  private readonly hpText: TextSlot;
  private readonly dash: ViewPool<DashPip>;
  private readonly overdrive: Meter;
  private readonly odReady: Flag;
  private readonly wallet: NumSlot;
  private readonly score: NumSlot;
  private readonly combo: TextSlot;
  private readonly comboShown: Shown;
  private readonly comboMeter: Meter;
  private readonly tier: ClassSwitch;
  private readonly bleed: Meter;
  private readonly bleedShown: Shown;
  private readonly revive: Meter;
  private readonly reviveShown: Shown;
  private readonly wins: ViewPool<Pip>;
  private readonly winsShown: Shown;
  private readonly lowHp: Flag;
  private readonly loadout: InstalledList;
  private readonly loadoutShown: Shown;
  private loadoutKey = -1;

  constructor(ctx: UiContext, player: PlayerIndex) {
    const doc = ctx.doc;
    const tag = playerTag(player);
    const nameEl = h(doc, 'span', { className: 'kp-pp-name' });
    const lifeEl = h(doc, 'span', { className: 'kp-pp-life' });
    const winsEl = h(doc, 'span', { className: 'kp-pp-wins' });
    const hpText = h(doc, 'span', { className: 'kp-pp-hp-text' });
    const dashEl = h(doc, 'div', { className: 'kp-pp-dash' });
    const walletEl = h(doc, 'span', { className: 'kp-pp-wallet-num' });
    const scoreEl = h(doc, 'span', { className: 'kp-pp-score' });
    const comboEl = h(doc, 'span', { className: 'kp-pp-combo-text' });

    this.hpMeter = new Meter(doc, 'kp-pp-hp');
    this.overdrive = new Meter(doc, 'kp-pp-od');
    this.comboMeter = new Meter(doc, 'kp-pp-combo-bar');
    this.bleed = new Meter(doc, 'kp-pp-bleed');
    this.revive = new Meter(doc, 'kp-pp-revive');
    this.loadout = new InstalledList(doc, 'kp-pp-loadout', '', 'chips');

    const comboBox = h(doc, 'div', { className: 'kp-pp-combo' }, comboEl, this.comboMeter.el);
    const bleedBox = h(
      doc,
      'div',
      { className: 'kp-pp-status kp-pp-bleed-box' },
      h(doc, 'span', { text: 'BLEED-OUT' }),
      this.bleed.el,
    );
    const reviveBox = h(
      doc,
      'div',
      { className: 'kp-pp-status kp-pp-revive-box' },
      h(doc, 'span', { text: 'REVIVE' }),
      this.revive.el,
    );

    this.el = h(
      doc,
      'div',
      { className: `kp-pp kp-${tag.toLowerCase()}` },
      h(
        doc,
        'div',
        { className: 'kp-pp-head' },
        h(doc, 'span', { className: 'kp-tag', text: tag }),
        nameEl,
        lifeEl,
        winsEl,
      ),
      h(doc, 'div', { className: 'kp-pp-hp-row' }, this.hpMeter.el, hpText),
      h(
        doc,
        'div',
        { className: 'kp-pp-row' },
        h(doc, 'span', { className: 'kp-pp-key', text: 'DASH' }),
        dashEl,
        h(doc, 'span', { className: 'kp-pp-key', text: 'OVR' }),
        this.overdrive.el,
      ),
      h(
        doc,
        'div',
        { className: 'kp-pp-row kp-pp-nums' },
        h(
          doc,
          'span',
          { className: 'kp-pp-wallet' },
          walletEl,
          h(doc, 'span', { className: 'kp-unit', text: ' ' + ctx.theme.names.runCurrency }),
        ),
        scoreEl,
      ),
      comboBox,
      bleedBox,
      reviveBox,
      this.loadout.el,
    );

    this.shown = new Shown(this.el, false);
    this.name = new TextSlot(nameEl);
    this.life = new TextSlot(lifeEl);
    this.lifeClass = new ClassSwitch(this.el);
    this.hpText = new TextSlot(hpText);
    this.dash = new ViewPool(dashEl, () => new DashPip(doc));
    this.odReady = new Flag(this.el, 'is-od-ready');
    this.wallet = new NumSlot(walletEl, formatShards);
    this.score = new NumSlot(scoreEl, formatShards);
    this.combo = new TextSlot(comboEl);
    this.comboShown = new Shown(comboBox, false);
    this.tier = new ClassSwitch(comboBox);
    this.bleedShown = new Shown(bleedBox, false);
    this.reviveShown = new Shown(reviveBox, false);
    this.wins = new ViewPool(winsEl, () => new Pip(doc, 'kp-win-pip'));
    this.winsShown = new Shown(winsEl, false);
    this.lowHp = new Flag(this.el, 'is-low-hp');
    this.loadoutShown = new Shown(this.loadout.el, false);
  }

  /** A new run starts its loadout keys again: forget the last one so the strip is rebuilt. */
  resetLoadout(): void {
    this.loadoutKey = -1;
  }

  /** `versus` shows round-win pips; `winsNeeded` is the pip count (grown if a player has more wins). */
  render(vm: HudPlayerVM, text: boolean, versus: boolean, winsNeeded: number): void {
    const present = vm.present && vm.life !== 'absent';
    this.shown.set(present);
    if (!present) return;

    // Every render: bars, pips, flags.
    this.hpMeter.set(vm.hpFrac);
    this.lowHp.set(vm.life === 'alive' && vm.hpFrac <= 0.25);
    this.lifeClass.set(LIFE_CLASS[vm.life]);
    const dashMax = Math.max(0, Math.floor(vm.dashMax));
    this.dash.ensure(dashMax);
    for (let i = 0; i < dashMax; i++) {
      const m = this.dash.get(i).meter;
      if (i < vm.dashCharges) m.set(1);
      else if (i === vm.dashCharges) m.set(vm.dashFrac);
      else m.set(0);
    }
    this.overdrive.set(vm.overdriveFrac);
    this.odReady.set(vm.overdriveFrac >= 1);
    const comboOn = vm.combo >= 2;
    this.comboShown.set(comboOn);
    if (comboOn) {
      this.comboMeter.set(vm.comboFrac);
      const t = Math.max(0, Math.min(TIER_CLASS.length - 1, Math.floor(vm.comboTier)));
      this.tier.set(TIER_CLASS[t]!);
    }
    const bleedOn = vm.life === 'downed' && vm.bleedFrac > 0;
    this.bleedShown.set(bleedOn);
    if (bleedOn) this.bleed.set(vm.bleedFrac);
    const reviveOn = vm.reviveFrac > 0 && (vm.life === 'downed' || vm.life === 'alive');
    this.reviveShown.set(reviveOn);
    if (reviveOn) this.revive.set(vm.reviveFrac);
    this.winsShown.set(versus);
    if (versus) {
      const pips = Math.max(winsNeeded, vm.roundWins);
      this.wins.ensure(pips);
      for (let i = 0; i < pips; i++) this.wins.get(i).fill.set(i < vm.roundWins);
    }

    // Life tag changes are rare and important: never throttled.
    this.life.set(LIFE_LABEL[vm.life]);
    this.name.set(vm.name);
    if (!text) return;
    if (vm.loadoutKey !== this.loadoutKey) {
      this.loadoutKey = vm.loadoutKey;
      this.loadoutShown.set(vm.loadout.length > 0);
      this.loadout.render(vm.loadout);
    }
    this.hpText.set(formatHp(vm.hp, vm.maxHp));
    this.wallet.set(vm.wallet);
    this.score.set(vm.score);
    this.combo.set(formatCombo(vm.combo));
  }
}

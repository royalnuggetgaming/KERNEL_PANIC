/**
 * GameOver: outcome title, versus match winner, per-player table (MVP / WINNER badges), Cores breakdown with
 * cap and new-best notes, Retry / Menu. Co-op shows revives; versus shows round wins instead.
 */
import type { GameOverPlayerVM, GameOverVM, CoresLineVM } from '../../contracts/ui';
import type { ScreenView, UiContext } from '../view';
import { ClassSwitch, Flag, NumSlot, Shown, TextSlot, ViewPool, h } from '../dom';
import { formatShards, formatSigned, playerTag } from '../format';
import { screenRoot } from '../view';
import { MenuList } from '../widgets/MenuList';

class PlayerRowView {
  readonly el: HTMLTableRowElement;
  private readonly tag: TextSlot;
  private readonly name: TextSlot;
  private readonly badge: TextSlot;
  private readonly vehicle: TextSlot;
  private readonly score: NumSlot;
  private readonly kills: NumSlot;
  private readonly damage: NumSlot;
  private readonly shards: NumSlot;
  private readonly extra: NumSlot;
  private readonly combo: NumSlot;
  private readonly playerClass: ClassSwitch;
  private readonly highlight: Flag;

  constructor(doc: Document) {
    const cell = (cls: string): HTMLTableCellElement => h(doc, 'td', { className: cls });
    const tagEl = h(doc, 'span', { className: 'kp-tag' });
    const nameEl = h(doc, 'span', { className: 'kp-go-name' });
    const badgeEl = h(doc, 'span', { className: 'kp-badge' });
    const who = h(doc, 'td', { className: 'kp-go-who' }, tagEl, nameEl, badgeEl);
    const vehicle = cell('kp-go-veh');
    const score = cell('kp-num');
    const kills = cell('kp-num');
    const damage = cell('kp-num');
    const shards = cell('kp-num');
    const extra = cell('kp-num');
    const combo = cell('kp-num');
    this.el = h(doc, 'tr', { className: 'kp-go-row' }, who, vehicle, score, kills, damage, shards, extra, combo);
    this.tag = new TextSlot(tagEl);
    this.name = new TextSlot(nameEl);
    this.badge = new TextSlot(badgeEl);
    this.vehicle = new TextSlot(vehicle);
    this.score = new NumSlot(score, formatShards);
    this.kills = new NumSlot(kills, formatShards);
    this.damage = new NumSlot(damage, formatShards);
    this.shards = new NumSlot(shards, formatShards);
    this.extra = new NumSlot(extra, formatShards);
    this.combo = new NumSlot(combo, formatShards);
    this.playerClass = new ClassSwitch(this.el);
    this.highlight = new Flag(this.el, 'is-highlight');
  }

  set(vm: GameOverPlayerVM, versus: boolean): void {
    this.tag.set(playerTag(vm.player));
    this.playerClass.set(vm.player === 0 ? 'kp-p1' : 'kp-p2');
    this.name.set(vm.name);
    this.badge.set(versus ? (vm.winner ? 'WINNER' : '') : vm.mvp ? 'MVP' : '');
    this.highlight.set(versus ? vm.winner : vm.mvp);
    this.vehicle.set(vm.vehicleName);
    this.score.set(vm.score);
    this.kills.set(vm.kills);
    this.damage.set(vm.damage);
    this.shards.set(vm.shards);
    this.extra.set(versus ? vm.roundWins : vm.revives);
    this.combo.set(vm.bestCombo);
  }
}

class CoresLineView {
  readonly el: HTMLDivElement;
  private readonly label: TextSlot;
  private readonly amount: NumSlot;

  constructor(doc: Document) {
    const labelEl = h(doc, 'span', { className: 'kp-cores-line-label' });
    const amountEl = h(doc, 'span', { className: 'kp-num' });
    this.el = h(doc, 'div', { className: 'kp-cores-line' }, labelEl, amountEl);
    this.label = new TextSlot(labelEl);
    this.amount = new NumSlot(amountEl, formatSigned);
  }

  set(vm: CoresLineVM): void {
    this.label.set(vm.label);
    this.amount.set(vm.amount);
  }
}

/** Pure: the match result line for versus ('' outside versus). */
export function matchResultText(vm: GameOverVM): string {
  if (vm.mode !== 'versus') return '';
  if (vm.outcome === 'abandoned') return 'MATCH ABANDONED';
  if (vm.winner === null) return 'MATCH DRAWN';
  let name = playerTag(vm.winner);
  for (let i = 0; i < vm.players.length; i++) {
    const p = vm.players[i]!;
    if (p.player === vm.winner && p.name !== '') name = p.name;
  }
  return `${name} WINS THE MATCH`;
}

export class GameOverScreen implements ScreenView<'gameOver'> {
  readonly id = 'gameOver' as const;
  readonly el: HTMLElement;
  private readonly title: TextSlot;
  private readonly subtitle: TextSlot;
  private readonly match: TextSlot;
  private readonly matchShown: Shown;
  private readonly winnerClass: ClassSwitch;
  private readonly outcomeClass: ClassSwitch;
  private readonly rows: ViewPool<PlayerRowView>;
  private readonly extraHead: TextSlot;
  private readonly wave: TextSlot;
  private readonly waveShown: Shown;
  private readonly duration: TextSlot;
  private readonly lines: ViewPool<CoresLineView>;
  private readonly total: NumSlot;
  private readonly currency: TextSlot;
  private readonly capped: Shown;
  private readonly newBest: Shown;
  private readonly menu: MenuList;
  private readonly waveName: string;

  constructor(ctx: UiContext) {
    const doc = ctx.doc;
    const names = ctx.theme.names;
    this.waveName = names.wave.toUpperCase();
    this.el = screenRoot(ctx, 'gameOver', 'kp-gameover');
    const titleEl = h(doc, 'h1', { className: 'kp-title kp-go-title' });
    const subtitleEl = h(doc, 'p', { className: 'kp-go-subtitle' });
    const matchEl = h(doc, 'p', { className: 'kp-go-match' });
    const th = (text: string, cls = 'kp-num'): HTMLTableCellElement => h(doc, 'th', { className: cls, text });
    const extraHeadEl = th('REVIVES');
    const tbody = h(doc, 'tbody');
    const table = h(
      doc,
      'table',
      { className: 'kp-go-table' },
      h(
        doc,
        'thead',
        undefined,
        h(
          doc,
          'tr',
          undefined,
          th('PLAYER', ''),
          th('DAEMON', ''),
          th('SCORE'),
          th('KILLS'),
          th('DAMAGE'),
          th(names.runCurrency.toUpperCase()),
          extraHeadEl,
          th('BEST COMBO'),
        ),
      ),
      tbody,
    );
    const waveEl = h(doc, 'span', { className: 'kp-go-wave' });
    const durationEl = h(doc, 'span', { className: 'kp-go-duration' });
    const linesEl = h(doc, 'div', { className: 'kp-cores-lines' });
    const totalEl = h(doc, 'span', { className: 'kp-cores-total-num' });
    const currencyEl = h(doc, 'span', { className: 'kp-unit' });
    const cappedEl = h(doc, 'span', { className: 'kp-dim kp-cores-cap', text: ' (CAP REACHED)' });
    const newBestEl = h(doc, 'p', { className: 'kp-new-best kp-blink', text: 'NEW BEST' });
    this.menu = new MenuList(doc, 'kp-go-menu kp-menu-row');
    this.el.appendChild(
      h(
        doc,
        'div',
        { className: 'kp-go-wrap' },
        titleEl,
        subtitleEl,
        matchEl,
        h(doc, 'p', { className: 'kp-go-meta kp-dim' }, waveEl, durationEl),
        table,
        h(
          doc,
          'div',
          { className: 'kp-panel kp-cores-box' },
          h(doc, 'h3', { className: 'kp-panel-sub', text: names.metaCurrency.toUpperCase() + ' EARNED' }),
          linesEl,
          h(doc, 'div', { className: 'kp-cores-total' }, totalEl, currencyEl, cappedEl),
          newBestEl,
        ),
        this.menu.el,
      ),
    );
    this.title = new TextSlot(titleEl);
    this.subtitle = new TextSlot(subtitleEl);
    this.match = new TextSlot(matchEl);
    this.matchShown = new Shown(matchEl, false);
    this.winnerClass = new ClassSwitch(matchEl);
    this.outcomeClass = new ClassSwitch(this.el);
    this.rows = new ViewPool(tbody, () => new PlayerRowView(doc));
    this.extraHead = new TextSlot(extraHeadEl);
    this.wave = new TextSlot(waveEl);
    this.waveShown = new Shown(waveEl);
    this.duration = new TextSlot(durationEl);
    this.lines = new ViewPool(linesEl, () => new CoresLineView(doc));
    this.total = new NumSlot(totalEl, formatShards);
    this.currency = new TextSlot(currencyEl);
    this.capped = new Shown(cappedEl, false);
    this.newBest = new Shown(newBestEl, false);
  }

  render(vm: GameOverVM): boolean {
    const versus = vm.mode === 'versus';
    this.outcomeClass.set(`outcome-${vm.outcome}`);
    this.title.set(vm.title);
    this.subtitle.set(vm.subtitle);
    this.matchShown.set(versus);
    this.match.set(matchResultText(vm));
    this.winnerClass.set(vm.winner === null ? null : vm.winner === 0 ? 'kp-p1' : 'kp-p2');
    this.extraHead.set(versus ? 'ROUNDS' : 'REVIVES');
    this.rows.ensure(vm.players.length);
    for (let i = 0; i < vm.players.length; i++) this.rows.get(i).set(vm.players[i]!, versus);
    this.waveShown.set(!versus);
    this.wave.set(`${this.waveName} ${vm.waveReached} · `);
    this.duration.set(vm.duration);
    this.lines.ensure(vm.cores.length);
    for (let i = 0; i < vm.cores.length; i++) this.lines.get(i).set(vm.cores[i]!);
    this.total.set(vm.coresTotal);
    this.currency.set(' ' + vm.metaCurrency);
    this.capped.set(vm.coresCapped);
    this.newBest.set(vm.newBest);
    this.menu.render(vm.items, vm.cursor);
    return false;
  }
}

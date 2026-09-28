/**
 * UpgradesShop{midrun} controller: a ShopApi visit from run.openShop() driven by per-player MenuIntents
 * (each player's keys move only their own cursor), transactions applied P1 then P2 every frame after
 * shop.update(). Fire buys (Lock column on cards), Dash undoes, Special toggles Ready; on the final visit
 * left/right on the READY row (or the banner buttons) choose EXTRACT / PUSH DEEPER. A shared Back
 * (Escape/Backspace) opens Pause. When the ready countdown ends: pop back to Playing, or GameOver{victory}
 * on EXTRACT. Versus uses the same flow between rounds (team row and gift hidden by the snapshot).
 */
import type { CardId, PlayerIndex } from '../contracts/ids';
import { cardDef } from '../config/cards';
import type { PlayerLoadout, ShopApi, ShopPlayerSnapshot, ShopVisitSnapshot } from '../contracts/run';
import type { Services } from '../contracts/services';
import type { ShopVM } from '../contracts/ui';
import type { PurchaseFailure, PurchaseResult, ShopTx } from '../contracts/upgrades';
import { wrapIndex, type UiIntent } from './intents';
import {
  buildShopVM,
  cardSlotOfItem,
  shopLayoutOf,
  statRowOfItem,
  teamOfItem,
  LOCK_ITEM_PREFIX,
  type ShopLayout,
} from './shopViewModel';

const TOAST_S = 1.6;

interface Cursor {
  row: number;
  col: 0 | 1;
}

export function failureText(reason: PurchaseFailure, tx: ShopTx, runCurrency: string): string | null {
  switch (reason) {
    case 'funds':
      return `Not enough ${runCurrency}`;
    case 'maxLevel':
      return 'Already at max level';
    case 'capped':
      return 'That stat is capped';
    case 'soldOut':
      return tx.kind === 'buyTeam' ? 'Partner bought it' : 'Sold out';
    case 'unavailable':
      return 'Not available';
    case 'absent':
    case 'guard':
      return null;
    case 'fullHp':
      return 'Already at full HP';
    case 'visitLimit':
      return 'Limit reached this visit';
    case 'heldCap':
      return tx.kind === 'undo' ? 'Wallet is full' : 'Holding the maximum';
    case 'alreadyOwned':
      return 'Already owned';
    case 'nothingToUndo':
      return 'Nothing to undo';
    case 'teamDependency':
      return 'A later team purchase blocks this undo';
    case 'invalid':
      return tx.kind === 'undo' || tx.kind.startsWith('buy') ? 'Un-ready first' : 'Not possible';
  }
}

export class MidrunShopController {
  private readonly s: Services;
  private shop: ShopApi | null = null;
  private readonly cursors: [Cursor, Cursor] = [
    { row: 0, col: 0 },
    { row: 0, col: 0 },
  ];
  private readonly toasts: [string | null, string | null] = [null, null];
  private readonly mythicShown: [boolean, boolean] = [false, false];
  private readonly toastLeft: [number, number] = [0, 0];
  private readonly txs: [ShopTx[], ShopTx[]] = [[], []];
  private lastSnap: ShopVisitSnapshot | null = null;
  private dirty = true;
  private leaving = false;

  constructor(s: Services) {
    this.s = s;
  }

  /** False when there is no live run (the shop cannot open). */
  enter(): boolean {
    const s = this.s;
    const run = s.session.current;
    if (run === null) {
      s.log.error('UpgradesShop{midrun} entered without a run');
      return false;
    }
    this.shop = run.openShop();
    for (const c of this.cursors) {
      c.row = 0;
      c.col = 0;
    }
    this.toasts[0] = null;
    this.toasts[1] = null;
    this.mythicShown[0] = false;
    this.mythicShown[1] = false;
    this.leaving = false;
    this.lastSnap = null;
    s.input.setContext('menu');
    s.audio.setMood('shop');
    s.audio.duck(false);
    s.ui.show('shop', this.vm(this.shop.snapshot()));
    return true;
  }

  exit(): void {
    this.shop?.commit();
    this.shop = null;
    this.s.ui.hide('shop');
  }

  onCovered(): void {
    this.s.audio.duck(true);
  }

  onUncovered(): void {
    this.s.input.setContext('menu');
    this.s.audio.duck(false);
    this.dirty = true;
  }

  update(frameDt: number, intents: readonly UiIntent[]): void {
    const shop = this.shop;
    if (shop === null || this.leaving) return;
    shop.update(frameDt * 1000);
    const snap = shop.snapshot();
    this.txs[0].length = 0;
    this.txs[1].length = 0;
    let paused = false;
    for (const i of intents) if (this.route(i, snap, paused)) paused = true;
    // P1's transactions first, then P2's (team stock: first come, first served).
    for (let p = 0; p < 2; p++) {
      const list = this.txs[p === 0 ? 0 : 1];
      for (const tx of list) this.apply(shop, tx);
    }
    this.tickToasts(frameDt);
    if (shop.countdownDone && !paused) {
      this.leaving = true;
      if (shop.finalVisit && shop.choice === 'extract')
        this.s.fsm.request('GameOver', { outcome: 'victory' });
      else this.s.fsm.requestPop();
      return;
    }
    const next = shop.snapshot();
    if (next !== this.lastSnap || this.dirty) this.s.ui.update('shop', this.vm(next));
  }

  /** Banner + fanfare the first time a MYTHIC card shows up in a player's offers (again after it leaves). */
  private noteMythic(snap: ShopVisitSnapshot): void {
    for (let i = 0; i < 2; i++) {
      const p: PlayerIndex = i === 0 ? 0 : 1;
      const pl = snap.players[p];
      let found: CardId | null = null;
      for (const c of pl.cards) if (c.rarity === 'M' && c.id !== null) found = c.id;
      if (found !== null && !this.mythicShown[p]) {
        const who = snap.players[1].joined ? `P${p + 1}: ` : '';
        this.s.ui.toast(`${who}MYTHIC PATCH DETECTED: ${cardDef(found).label}`, 'warn');
        this.s.audio.play('specialReady');
      }
      this.mythicShown[p] = found !== null;
    }
  }

  private vm(snap: ShopVisitSnapshot): ShopVM {
    this.noteMythic(snap);
    this.lastSnap = snap;
    this.dirty = false;
    for (let p = 0; p < 2; p++) this.clampCursor(p === 0 ? 0 : 1, snap);
    return buildShopVM(
      snap,
      [
        { row: this.cursors[0].row, col: this.cursors[0].col },
        { row: this.cursors[1].row, col: this.cursors[1].col },
      ],
      this.s.theme(),
      [this.toasts[0], this.toasts[1]],
      this.loadouts(),
    );
  }

  /** Installed powerups incl. this visit's purchases (null when the session has no loadout reader). */
  private loadouts(): readonly [PlayerLoadout | null, PlayerLoadout | null] {
    const run = this.s.session.current;
    if (run?.loadout === undefined) return [null, null];
    return [run.loadout(0), run.loadout(1)];
  }

  private layout(snap: ShopVisitSnapshot, p: PlayerIndex): ShopLayout {
    return shopLayoutOf(snap.players[p], snap.teamVisible, snap.giftVisible);
  }

  private clampCursor(p: PlayerIndex, snap: ShopVisitSnapshot): void {
    const l = this.layout(snap, p);
    const c = this.cursors[p];
    if (c.row >= l.total) c.row = l.total - 1;
    if (c.row < l.cardsStart || c.row >= l.teamStart) c.col = 0;
  }

  /** Routes one intent into this frame's transaction lists; true when it requested Pause. */
  private route(i: UiIntent, snap: ShopVisitSnapshot, paused: boolean): boolean {
    if (i.pointer && (i.itemId === 'extract' || i.itemId === 'pushDeeper')) {
      this.txs[0].push({ kind: 'choose', player: 0, choice: i.itemId });
      return false;
    }
    if (i.player === 'any') {
      // Plan 5 "Pause: Escape or KeyP, from either player"; Backspace (shared back) also pauses here.
      const wantsPause = i.kind === 'back' || i.kind === 'pause';
      if (wantsPause && !i.pointer && !paused) return this.s.fsm.request('Paused', { reason: 'user' });
      return false;
    }
    if (i.pointer) {
      const ps = snap.players[i.player];
      if (ps.joined) this.routePointer(i.player, i, ps, snap);
      return false;
    }
    // SOLO (plan 5): both binding sets drive P1, so keys tagged with the unjoined player act for the other one.
    const p: PlayerIndex = snap.players[i.player].joined ? i.player : i.player === 0 ? 1 : 0;
    const ps = snap.players[p];
    if (ps.joined) this.routeKey(p, i, ps, snap);
    return false;
  }

  private routeKey(p: PlayerIndex, i: UiIntent, ps: ShopPlayerSnapshot, snap: ShopVisitSnapshot): void {
    const l = this.layout(snap, p);
    const c = this.cursors[p];
    switch (i.kind) {
      case 'up':
      case 'down':
        c.row = wrapIndex(c.row, i.kind === 'up' ? -1 : 1, l.total);
        if (c.row < l.cardsStart || c.row >= l.teamStart) c.col = 0;
        this.moved();
        return;
      case 'left':
      case 'right':
        if (c.row === l.ready && snap.finalVisit) {
          this.txs[p].push({
            kind: 'choose',
            player: p,
            choice: i.kind === 'left' ? 'extract' : 'pushDeeper',
          });
        } else if (c.row >= l.cardsStart && c.row < l.teamStart) {
          c.col = c.col === 0 ? 1 : 0;
          this.moved();
        }
        return;
      case 'confirm':
        this.actAt(p, c.row, c.col, ps, l);
        return;
      case 'back':
        this.txs[p].push({ kind: 'undo', player: p });
        return;
      case 'ready':
        this.txs[p].push({ kind: 'toggleReady', player: p });
        return;
      case 'pause':
        return;
    }
  }

  private routePointer(p: PlayerIndex, i: UiIntent, ps: ShopPlayerSnapshot, snap: ShopVisitSnapshot): void {
    const id = i.itemId;
    if (i.kind === 'ready') {
      this.txs[p].push({ kind: 'toggleReady', player: p });
      return;
    }
    if (i.kind === 'back') {
      this.txs[p].push({ kind: 'undo', player: p });
      return;
    }
    if (i.kind !== 'confirm' || id === null) return;
    const l = this.layout(snap, p);
    const row = this.rowOfItem(id, ps, l);
    if (row < 0) return;
    const c = this.cursors[p];
    c.row = row;
    c.col = id.startsWith(LOCK_ITEM_PREFIX) ? 1 : 0;
    this.dirty = true;
    this.actAt(p, c.row, c.col, ps, l);
  }

  private rowOfItem(id: string, ps: ShopPlayerSnapshot, l: ShopLayout): number {
    if (id === 'repair') return l.repair;
    if (id === 'reroll') return l.reroll;
    if (id === 'gift') return l.gift;
    const slot = cardSlotOfItem(id);
    if (slot !== null) return l.cardsStart + slot;
    const stat = statRowOfItem(id, ps);
    if (stat !== null) return ps.rows.findIndex((r) => r.id === stat);
    const team = teamOfItem(id, ps);
    if (team !== null && l.team > 0) return l.teamStart + ps.team.findIndex((t) => t.id === team);
    return -1;
  }

  private actAt(p: PlayerIndex, row: number, col: 0 | 1, ps: ShopPlayerSnapshot, l: ShopLayout): void {
    const out = this.txs[p];
    if (row < l.repair) {
      const r = ps.rows[row];
      if (r !== undefined) out.push({ kind: 'buyRow', player: p, id: r.id });
    } else if (row === l.repair) out.push({ kind: 'repair', player: p });
    else if (row < l.teamStart) {
      const slot = row - l.cardsStart;
      if (slot === 0 || slot === 1 || slot === 2)
        out.push(col === 1 ? { kind: 'lock', player: p, slot } : { kind: 'buyCard', player: p, slot });
    } else if (row < l.reroll) {
      const t = ps.team[row - l.teamStart];
      if (t !== undefined) out.push({ kind: 'buyTeam', player: p, id: t.id });
    } else if (row === l.reroll) out.push({ kind: 'reroll', player: p });
    else if (row === l.gift) out.push({ kind: 'gift', player: p });
    else if (row === l.ready) out.push({ kind: 'toggleReady', player: p });
  }

  private apply(shop: ShopApi, tx: ShopTx): void {
    const r: PurchaseResult = shop.apply(tx);
    const p = tx.player;
    this.dirty = true;
    if (r.ok) {
      const quiet = tx.kind === 'toggleReady' || tx.kind === 'choose' || tx.kind === 'lock';
      this.s.audio.play(quiet ? 'uiConfirm' : tx.kind === 'undo' ? 'uiBack' : 'uiBuy');
      this.toast(p, null);
      return;
    }
    const text = failureText(r.reason, tx, this.s.theme().names.runCurrency);
    if (text === null) return;
    this.s.audio.play('uiDeny');
    this.toast(p, text);
  }

  private toast(p: PlayerIndex, text: string | null): void {
    this.toasts[p] = text;
    this.toastLeft[p] = text === null ? 0 : TOAST_S;
  }

  private tickToasts(dt: number): void {
    for (let i = 0; i < 2; i++) {
      const p: PlayerIndex = i === 0 ? 0 : 1;
      if (this.toasts[p] === null) continue;
      this.toastLeft[p] -= dt;
      if (this.toastLeft[p] <= 0) {
        this.toasts[p] = null;
        this.dirty = true;
      }
    }
  }

  private moved(): void {
    this.dirty = true;
    this.s.audio.play('uiMove');
  }
}

/**
 * Patch Bay view model (pure) plus the flat cursor layout shared with the shop controller. The layout matches
 * ui/widgets/ShopPanel.ts: [stat rows, repair, cards, team, reroll, gift, ready]. Row ids (pointer itemIds):
 * 'row:<statRowId>', 'repair', 'card:<slot>', 'team:<teamItemId>', 'reroll', 'gift'; the Lock column of a card
 * is 'lock:card:<slot>' (ui LOCK_PREFIX + card id).
 */
import type { PlayerIndex, StatRowId, TeamItemId } from '../contracts/ids';
import type { PlayerLoadout, ShopPlayerSnapshot, ShopVisitSnapshot } from '../contracts/run';
import type { ThemeDef } from '../contracts/theme';
import type { ShopCardVM, ShopPanelVM, ShopRowVM, ShopVM } from '../contracts/ui';
import { cardDef } from '../config/cards';
import { REPAIR, statRowDef } from '../config/runCatalog';
import { sectorOf } from '../config/waves';
import { NO_ITEMS, installedItems } from './loadoutViewModel';
import {
  cardDesc,
  cardOwnedText,
  giftDesc,
  lockDesc,
  repairDesc,
  rerollDesc,
  statRowDesc,
  statRowNext,
  teamDesc,
  teamNext,
} from './powerupText';

export interface ShopCursor {
  readonly row: number;
  readonly col: 0 | 1;
}

export interface ShopLayout {
  readonly rows: number;
  readonly repair: number;
  readonly cardsStart: number;
  readonly cards: number;
  readonly teamStart: number;
  readonly team: number;
  readonly reroll: number;
  /** -1 when Gift is hidden. */
  readonly gift: number;
  readonly ready: number;
  readonly total: number;
}

export function shopLayoutOf(p: ShopPlayerSnapshot, teamVisible: boolean, giftVisible: boolean): ShopLayout {
  const rows = p.rows.length;
  const cards = p.cards.length;
  const team = teamVisible ? p.team.length : 0;
  const repair = rows;
  const cardsStart = repair + 1;
  const teamStart = cardsStart + cards;
  const reroll = teamStart + team;
  const gift = giftVisible ? reroll + 1 : -1;
  const ready = reroll + (giftVisible ? 2 : 1);
  return { rows, repair, cardsStart, cards, teamStart, team, reroll, gift, ready, total: ready + 1 };
}

export const ROW_PREFIX = 'row:';
export const CARD_PREFIX = 'card:';
export const TEAM_PREFIX = 'team:';
export const LOCK_ITEM_PREFIX = 'lock:';

const NO_TOASTS: readonly [string | null, string | null] = [null, null];
const NO_LOADOUTS: readonly [PlayerLoadout | null, PlayerLoadout | null] = [null, null];

function rowVM(p: ShopPlayerSnapshot, i: number): ShopRowVM {
  const r = p.rows[i]!;
  const def = statRowDef(r.id);
  return {
    id: ROW_PREFIX + r.id,
    label: def.label.toUpperCase(),
    blurb: statRowDesc(r.id),
    next: statRowNext(r.id, r.level),
    level: r.level,
    maxLevel: r.maxLevel,
    price: r.price,
    status: r.status,
  };
}

function cardVM(p: ShopPlayerSnapshot, i: number, l: PlayerLoadout | null, currency: string): ShopCardVM {
  const c = p.cards[i]!;
  const def = c.id === null ? null : cardDef(c.id);
  const owned = def === null || l === null ? 0 : (l.cards[def.bit] ?? 0);
  return {
    id: CARD_PREFIX + String(c.slot),
    label: def === null ? 'SOLD' : def.label.toUpperCase(),
    blurb: c.id === null ? 'Bought this visit.' : cardDesc(c.id, currency),
    next:
      c.id === null
        ? ''
        : c.locked
          ? `${cardOwnedText(c.id, owned)} · LOCKED for next visit`
          : cardOwnedText(c.id, owned),
    level: 0,
    maxLevel: 0,
    price: c.id === null ? null : c.price,
    status: c.id === null ? 'soldOut' : c.status,
    rarity: c.rarity,
    locked: c.locked,
  };
}

function teamVM(p: ShopPlayerSnapshot, i: number, theme: ThemeDef): ShopRowVM {
  const t = p.team[i]!;
  return {
    id: TEAM_PREFIX + t.id,
    label: theme.names.teamItems[t.id].toUpperCase(),
    blurb: teamDesc(t.id),
    next: teamNext(t.id, t.level),
    level: t.level,
    maxLevel: Number.isFinite(t.maxLevel) ? t.maxLevel : 0,
    price: t.price,
    status: t.status,
  };
}

function panelVM(
  snap: ShopVisitSnapshot,
  p: ShopPlayerSnapshot,
  cursor: ShopCursor,
  theme: ThemeDef,
  toast: string | null,
  loadout: PlayerLoadout | null,
): ShopPanelVM {
  const n = theme.names;
  const rows: ShopRowVM[] = [];
  for (let i = 0; i < p.rows.length; i++) rows.push(rowVM(p, i));
  const cards: ShopCardVM[] = [];
  for (let i = 0; i < p.cards.length; i++) cards.push(cardVM(p, i, loadout, n.runCurrency));
  const team: ShopRowVM[] = [];
  if (snap.teamVisible) for (let i = 0; i < p.team.length; i++) team.push(teamVM(p, i, theme));
  const free = p.reroll.freeLeft;
  const rerollPrice = free > 0 ? 0 : p.reroll.price;
  return {
    player: p.player,
    present: p.joined,
    name: n.vehicles[p.vehicle],
    wallet: p.wallet,
    hp: p.hp,
    maxHp: p.maxHp,
    rows,
    repair: {
      id: 'repair',
      label: 'REPAIR',
      blurb: repairDesc(),
      next: `HP ${Math.max(0, Math.ceil(p.hp))}/${Math.ceil(p.maxHp)} · ${p.repair.boughtThisVisit}/${REPAIR.maxPerVisit} bought`,
      level: 0,
      maxLevel: 0,
      price: p.repair.price,
      status: p.repair.status,
    },
    cards,
    team,
    reroll: {
      id: 'reroll',
      label: free > 0 ? `REROLL (${free} FREE)` : 'REROLL',
      blurb: rerollDesc(),
      next: free > 0 ? `${free} free reroll${free > 1 ? 's' : ''} left · ${lockDesc()}` : lockDesc(),
      level: 0,
      maxLevel: 0,
      price: rerollPrice,
      status: rerollPrice <= p.wallet ? 'available' : 'unaffordable',
    },
    gift: snap.giftVisible
      ? {
          id: 'gift',
          label: `GIFT ${p.gift.amount} ${n.runCurrency.toUpperCase()}`,
          blurb: giftDesc(n.runCurrency),
          next: '',
          level: 0,
          maxLevel: 0,
          price: p.gift.amount,
          status: p.gift.status,
        }
      : null,
    cursor,
    ready: p.ready,
    canUndo: p.canUndo,
    lastResult: p.lastResult,
    toast,
    installed: loadout === null || !p.joined ? NO_ITEMS : installedItems(loadout, theme, snap.teamVisible),
  };
}

function subtitleOf(snap: ShopVisitSnapshot, theme: ThemeDef): string {
  const n = theme.names;
  if (snap.mode === 'versus') return `ROUND ${snap.round} COMPLETE · FIRE BUY · DASH UNDO · SPECIAL READY`;
  if (snap.finalVisit) return `ON THE READY ROW: ◀ ${n.extract} · ${n.pushDeeper} ▶`;
  return `${n.sector.toUpperCase()} ${sectorOf(snap.wave)} · ${n.wave.toUpperCase()} ${snap.wave} · FIRE BUY · DASH UNDO · SPECIAL READY`;
}

/**
 * Pure Patch Bay VM. `toasts` are per-player transient messages (for example "Partner bought it"); `loadouts`
 * are the players' installed powerups (RunSessionApi.loadout, live during the visit) for the INSTALLED lists.
 */
export function buildShopVM(
  snap: ShopVisitSnapshot,
  cursors: readonly [ShopPanelVM['cursor'], ShopPanelVM['cursor']],
  theme: ThemeDef,
  toasts: readonly [string | null, string | null] = NO_TOASTS,
  loadouts: readonly [PlayerLoadout | null, PlayerLoadout | null] = NO_LOADOUTS,
): ShopVM {
  const n = theme.names;
  const panel = (i: PlayerIndex): ShopPanelVM =>
    panelVM(snap, snap.players[i], cursors[i], theme, toasts[i], loadouts[i]);
  return {
    mode: snap.mode,
    title: n.shop.toUpperCase(),
    subtitle: subtitleOf(snap, theme),
    runCurrency: n.runCurrency,
    panels: [panel(0), panel(1)],
    teamVisible: snap.teamVisible,
    kernels: snap.kernels,
    finalChoice: {
      visible: snap.finalVisit,
      selected: snap.choice,
      extractLabel: n.extract,
      pushLabel: n.pushDeeper,
    },
    countdown: snap.countdownMs === null ? null : snap.countdownMs / 1000,
  };
}

/** Parses a stat row item id. */
export function statRowOfItem(id: string, p: ShopPlayerSnapshot): StatRowId | null {
  if (!id.startsWith(ROW_PREFIX)) return null;
  const rest = id.slice(ROW_PREFIX.length);
  for (const r of p.rows) if (r.id === rest) return r.id;
  return null;
}

/** Parses a team item id. */
export function teamOfItem(id: string, p: ShopPlayerSnapshot): TeamItemId | null {
  if (!id.startsWith(TEAM_PREFIX)) return null;
  const rest = id.slice(TEAM_PREFIX.length);
  for (const t of p.team) if (t.id === rest) return t.id;
  return null;
}

/** Parses 'card:<slot>' (after an optional 'lock:' prefix). */
export function cardSlotOfItem(id: string): 0 | 1 | 2 | null {
  const rest = id.startsWith(LOCK_ITEM_PREFIX) ? id.slice(LOCK_ITEM_PREFIX.length) : id;
  if (rest === 'card:0') return 0;
  if (rest === 'card:1') return 1;
  if (rest === 'card:2') return 2;
  return null;
}

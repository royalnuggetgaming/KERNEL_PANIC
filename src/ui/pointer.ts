/**
 * Mouse clicks -> PointerIntents. Clickable elements carry data-kind / data-player / data-item (dom.ts markClick);
 * each screen root carries data-screen. Resolution walks from the event target up to the UI root.
 *
 * itemId conventions (consumed by states/):
 * - menu items, settings rows, hangar items, shop rows/cards: the VM item id, kind 'confirm'
 * - shop card Lock column: LOCK_PREFIX + card id ('lock:<id>'), kind 'confirm'
 * - shop READY: kind 'ready' itemId 'ready'; shop UNDO: kind 'back' itemId 'undo'
 * - final choice: 'extract' / 'pushDeeper', kind 'confirm'
 * - settings sliders: kind 'left'/'right' with the setting id
 * - character select: 'join' (confirm), 'vehicle' (left/right), 'mode' (left/right), 'ready' (ready)
 * - controls panel rows: the Action (confirm, per player); 'keyTest' (confirm)
 * - back buttons: kind 'back' itemId 'back'; boot screen: kind 'confirm' itemId 'boot'
 * - HOW TO PLAY: table-of-contents entries 'manual:<page index>' (confirm); PREV / NEXT kind 'left' / 'right'
 */
import type { PlayerIndex } from '../contracts/ids';
import type { MenuIntentKind } from '../contracts/input';
import type { PointerIntent, ScreenId } from '../contracts/ui';
import { ATTR_ITEM, ATTR_KIND, ATTR_PLAYER, ATTR_SCREEN } from './dom';

export const LOCK_PREFIX = 'lock:';

const KINDS: readonly MenuIntentKind[] = ['up', 'down', 'left', 'right', 'confirm', 'back', 'ready', 'pause'];
export const SCREEN_IDS: readonly ScreenId[] = [
  'boot',
  'mainMenu',
  'characterSelect',
  'hud',
  'shop',
  'hangar',
  'pause',
  'gameOver',
];

/** The structural subset of Element that resolution needs (real DOM elements and test fakes both satisfy it). */
export interface PointerNode {
  getAttribute(name: string): string | null;
  readonly parentElement: PointerNode | null;
}

export function isPointerNode(x: unknown): x is PointerNode {
  return (
    typeof x === 'object' &&
    x !== null &&
    'getAttribute' in x &&
    typeof x.getAttribute === 'function' &&
    'parentElement' in x
  );
}

function parseKind(v: string | null): MenuIntentKind | null {
  if (v === null) return null;
  for (let i = 0; i < KINDS.length; i++) if (KINDS[i] === v) return KINDS[i]!;
  return null;
}

function parseScreen(v: string | null): ScreenId | null {
  if (v === null) return null;
  for (let i = 0; i < SCREEN_IDS.length; i++) if (SCREEN_IDS[i] === v) return SCREEN_IDS[i]!;
  return null;
}

function parsePlayer(v: string | null): PlayerIndex | 'any' {
  if (v === '0') return 0;
  if (v === '1') return 1;
  return 'any';
}

/**
 * Finds the nearest clickable ancestor of `start` (inclusive) and the screen that contains it, stopping at
 * `root`. Returns null when the click hit no target, the target is disabled (aria-disabled="true"), or it is
 * outside any screen.
 */
export function resolvePointerIntent(start: PointerNode | null, root: PointerNode): PointerIntent | null {
  let node: PointerNode | null = start;
  let kind: MenuIntentKind | null = null;
  let player: PlayerIndex | 'any' = 'any';
  let itemId: string | null = null;
  while (node !== null) {
    if (kind === null) {
      const k = parseKind(node.getAttribute(ATTR_KIND));
      if (k !== null) {
        if (node.getAttribute('aria-disabled') === 'true') return null;
        kind = k;
        player = parsePlayer(node.getAttribute(ATTR_PLAYER));
        itemId = node.getAttribute(ATTR_ITEM);
      }
    }
    const screen = parseScreen(node.getAttribute(ATTR_SCREEN));
    if (screen !== null) {
      if (kind === null) return null;
      return { screen, kind, player, itemId };
    }
    if (node === root) return null;
    node = node.parentElement;
  }
  return null;
}

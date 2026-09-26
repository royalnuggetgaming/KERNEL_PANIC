/**
 * CharacterSelect rules (pure): drop-in join, per-player cursors (vehicle row, MODE row once P2 joined),
 * vehicle cycling with locked vehicles shown at their Core price, Ready toggling (refused on a locked vehicle),
 * the MODE row (co-op / versus) and the 0.6 s start countdown that runs while every joined player is Ready.
 */
import {
  VEHICLE_IDS,
  type LoadoutPick,
  type PlayerIndex,
  type RunMode,
  type VehicleId,
} from '../contracts/ids';
import type { MenuIntentKind } from '../contracts/input';
import { wrapIndex } from './intents';
import type { CharacterSelectModel, SelectRow } from './viewModels';

export const START_COUNTDOWN_S = 0.6;
export const DEFAULT_PICKS: readonly [VehicleId, VehicleId] = ['lancer', 'bulwark'];

export interface MutableSelectModel extends CharacterSelectModel {
  joined: [boolean, boolean];
  picks: [VehicleId, VehicleId];
  ready: [boolean, boolean];
  cursorRows: [SelectRow, SelectRow];
  mode: 'coop' | 'versus';
  countdown: number | null;
  message: string;
}

/** What the state must do after an intent. */
export type SelectEffect = 'none' | 'changed' | 'denied' | 'backToMenu';

export function createSelectModel(
  prefill: readonly LoadoutPick[] | null,
  prefillMode: RunMode | null,
  lastLoadout: readonly LoadoutPick[],
): MutableSelectModel {
  const m: MutableSelectModel = {
    joined: [true, false],
    picks: [DEFAULT_PICKS[0], DEFAULT_PICKS[1]],
    ready: [false, false],
    cursorRows: ['vehicle', 'vehicle'],
    mode: 'coop',
    countdown: null,
    message: '',
  };
  for (const pick of lastLoadout) m.picks[pick.player] = pick.vehicle;
  if (prefill !== null) {
    for (const pick of prefill) {
      m.picks[pick.player] = pick.vehicle;
      m.joined[pick.player] = true;
    }
  }
  if (prefillMode === 'coop' || prefillMode === 'versus') m.mode = prefillMode;
  return m;
}

/** Ready state changed: arm or cancel the countdown. */
export function syncCountdown(m: MutableSelectModel): void {
  const all = m.ready[0] && (!m.joined[1] || m.ready[1]);
  if (!all) m.countdown = null;
  else m.countdown ??= START_COUNTDOWN_S;
}

export function picksOf(m: CharacterSelectModel): LoadoutPick[] {
  const out: LoadoutPick[] = [{ player: 0, vehicle: m.picks[0] }];
  if (m.joined[1]) out.push({ player: 1, vehicle: m.picks[1] });
  return out;
}

export interface SelectRules {
  readonly isUnlocked: (v: VehicleId) => boolean;
  readonly lockedMessage: (v: VehicleId) => string;
}

/** Flips CO-OP / VERSUS; every Ready is cleared so both players confirm the new mode. */
export function toggleMode(m: MutableSelectModel): void {
  m.mode = m.mode === 'coop' ? 'versus' : 'coop';
  m.ready[0] = false;
  m.ready[1] = false;
  m.message = '';
}

function setReady(m: MutableSelectModel, p: PlayerIndex, on: boolean, rules: SelectRules): SelectEffect {
  if (on && !rules.isUnlocked(m.picks[p])) {
    m.message = rules.lockedMessage(m.picks[p]);
    return 'denied';
  }
  if (m.ready[p] === on) return 'none';
  m.ready[p] = on;
  m.message = '';
  return 'changed';
}

function join(m: MutableSelectModel, p: PlayerIndex): SelectEffect {
  if (m.joined[p]) return 'none';
  m.joined[p] = true;
  m.ready[p] = false;
  m.cursorRows[p] = 'vehicle';
  m.message = '';
  return 'changed';
}

function leave(m: MutableSelectModel): SelectEffect {
  m.joined[1] = false;
  m.ready[1] = false;
  m.cursorRows[0] = 'vehicle';
  m.cursorRows[1] = 'vehicle';
  m.message = '';
  return 'changed';
}

/** One player-tagged intent (keyboard or pointer with a player). */
export function applyPlayerIntent(
  m: MutableSelectModel,
  p: PlayerIndex,
  kind: MenuIntentKind,
  rules: SelectRules,
): SelectEffect {
  if (!m.joined[p]) return kind === 'confirm' ? join(m, p) : 'none';
  const row: SelectRow = m.joined[1] ? m.cursorRows[p] : 'vehicle';
  let effect: SelectEffect = 'none';
  switch (kind) {
    case 'up':
    case 'down':
      if (!m.joined[1]) return 'none';
      m.cursorRows[p] = row === 'vehicle' ? 'mode' : 'vehicle';
      effect = 'changed';
      break;
    case 'left':
    case 'right':
      if (row === 'mode') {
        toggleMode(m);
        effect = 'changed';
      } else if (!m.ready[p]) {
        const i = VEHICLE_IDS.indexOf(m.picks[p]);
        m.picks[p] = VEHICLE_IDS[wrapIndex(i, kind === 'left' ? -1 : 1, VEHICLE_IDS.length)]!;
        m.message = '';
        effect = 'changed';
      }
      break;
    case 'confirm':
      if (row === 'mode') {
        toggleMode(m);
        effect = 'changed';
      } else effect = setReady(m, p, true, rules);
      break;
    case 'ready':
      effect = setReady(m, p, !m.ready[p], rules);
      break;
    case 'back':
      if (m.ready[p]) effect = setReady(m, p, false, rules);
      else if (p === 1) effect = leave(m);
      else effect = 'backToMenu';
      break;
    case 'pause':
      return 'none';
  }
  syncCountdown(m);
  return effect;
}

/** Advances the countdown; true when it just reached zero (launch). */
export function tickCountdown(m: MutableSelectModel, dt: number): boolean {
  if (m.countdown === null) return false;
  m.countdown = Math.max(0, m.countdown - dt);
  return m.countdown === 0;
}

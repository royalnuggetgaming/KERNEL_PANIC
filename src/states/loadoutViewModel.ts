/**
 * Installed-powerup lists (Patch Bay INSTALLED section, HUD strip, Pause) from a PlayerLoadout. Text comes from
 * the powerup table in powerupText.ts. Order: stat rows (catalog order), patch cards (card order), team items.
 */
import {
  CARD_IDS,
  STAT_ROW_IDS,
  type CardId,
  type PlayerIndex,
  type StatRowId,
  type TeamItemId,
} from '../contracts/ids';
import type { PlayerLoadout, RunSessionApi } from '../contracts/run';
import type { ThemeDef } from '../contracts/theme';
import type { InstalledItemVM, PauseLoadoutVM } from '../contracts/ui';
import { cardDef } from '../config/cards';
import { statRowDef } from '../config/runCatalog';
import { INSTALLED_TEAM_ITEMS, cardDesc, statRowTotal, teamTotal } from './powerupText';

/** Compact HUD chip names. */
const ROW_SHORT: Readonly<Record<StatRowId, string>> = {
  thrusters: 'THR',
  plating: 'PLT',
  overclock: 'OVC',
  payload: 'PAY',
  magnet: 'MAG',
  coolant: 'COOL',
  capacitor: 'CAP',
  specialTuning: 'TUNE',
};

const CARD_SHORT: Readonly<Record<CardId, string>> = {
  splitShot: 'SPLIT',
  overdriveBattery: 'BATT',
  bounty: 'BNTY',
  pierce: 'PIRC',
  afterimage: 'AFTR',
  doubleBuffer: 'DBUF',
  vampireCode: 'VAMP',
  overheat: 'HEAT',
  ricochet: 'RICO',
  chainArc: 'ARC',
  microMissiles: 'MSL',
  nanoshield: 'SHLD',
  orbitals: 'ORB',
  glassLens: 'LENS',
  forkCall: 'FORK',
  sudo: 'SUDO',
  rootAccess: 'ROOT',
  shardCache: 'CACHE',
};

const TEAM_SHORT: Readonly<Record<TeamItemId, string>> = {
  spareKernel: 'KRNL',
  linkAmp: 'AMP',
  linkRange: 'RNG',
  reviveProtocol: 'REV',
};

export const NO_ITEMS: readonly InstalledItemVM[] = [];

export function installedItems(l: PlayerLoadout, theme: ThemeDef, includeTeam: boolean): InstalledItemVM[] {
  const out: InstalledItemVM[] = [];
  const currency = theme.names.runCurrency;
  for (const id of STAT_ROW_IDS) {
    const level = l.rows[id];
    if (level <= 0) continue;
    out.push({
      id: 'row:' + id,
      kind: 'stat',
      label: statRowDef(id).label,
      short: ROW_SHORT[id],
      count: String(level),
      desc: statRowTotal(id, level),
    });
  }
  for (let bit = 0; bit < CARD_IDS.length; bit++) {
    const id = CARD_IDS[bit]!;
    const stacks = l.cards[bit] ?? 0;
    if (stacks <= 0 || id === 'shardCache') continue;
    const def = cardDef(id);
    out.push({
      id: 'card:' + id,
      kind: 'card',
      label: def.label,
      short: CARD_SHORT[id],
      count: stacks > 1 ? `×${stacks}` : '',
      desc: cardDesc(id, currency),
    });
  }
  if (includeTeam) {
    for (const id of INSTALLED_TEAM_ITEMS) {
      const level = l.team[id];
      if (level <= 0) continue;
      const name = theme.names.teamItems[id];
      out.push({
        id: 'team:' + id,
        kind: 'team',
        label: name,
        short: TEAM_SHORT[id],
        count: String(level),
        desc: `${teamTotal(id, level)} (team)`,
      });
    }
  }
  return out;
}

/** Cheap change signature of a loadout (no allocation). */
export function loadoutSignature(l: PlayerLoadout): number {
  let h = 17;
  for (const id of STAT_ROW_IDS) h = (h * 31 + l.rows[id]) | 0;
  for (let i = 0; i < l.cards.length; i++) h = (h * 31 + (l.cards[i] ?? 0)) | 0;
  for (const id of INSTALLED_TEAM_ITEMS) h = (h * 31 + l.team[id]) | 0;
  return h;
}

/** Both players' installed lists for the Pause screen (empty lists when the session has no loadout reader). */
export function buildPauseLoadouts(run: RunSessionApi | null, theme: ThemeDef): readonly PauseLoadoutVM[] {
  if (run === null) return [];
  const out: PauseLoadoutVM[] = [];
  const team = run.config.mode !== 'versus';
  for (let i = 0; i < 2; i++) {
    const p: PlayerIndex = i === 0 ? 0 : 1;
    const pl = run.world.players[p];
    const present = pl.life !== 'absent';
    const l = run.loadout === undefined ? null : run.loadout(p);
    out.push({
      player: p,
      present,
      name: theme.names.vehicles[pl.vehicle],
      items: l === null || !present ? NO_ITEMS : installedItems(l, theme, team),
    });
  }
  return out;
}

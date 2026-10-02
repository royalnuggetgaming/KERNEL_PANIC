/**
 * TERMINAL cheat codes (main menu). A typed code unlocks its cheat for good and switches it on; the Hangar and
 * the TERMINAL toggle unlocked cheats. Enabled cheats are snapshotted into RunConfig at run start (never in
 * versus) and act only through run-start numbers: stat modifiers and raised hard caps (computeStats), starting
 * Bits / special charge / cards, and the IDDQD flag. A run with any cheat pays no Cores and records nothing.
 */
import { CHEAT_IDS, type CardId, type CheatId } from '../contracts/ids';
import type { StatModifier } from '../contracts/upgrades';
import type { STAT_CAPS } from './tuning';

/** Hard-cap names (same keys as upgrades/stats.ts StatCaps). */
type StatCaps = { readonly [K in keyof typeof STAT_CAPS]: number };

export interface CheatDef {
  readonly id: CheatId;
  /** What to type (letters/digits, matched case-insensitively). */
  readonly code: string;
  readonly label: string;
  readonly desc: string;
  readonly modifiers: readonly StatModifier[];
  /** Hard caps raised while this cheat is on (merged over STAT_CAPS; the larger limit wins). */
  readonly caps: Partial<StatCaps>;
  readonly startShards: number;
  /** Special meter at start, 0..100 (the highest of Pre-Charge and cheats wins). */
  readonly startOverdrive: number;
  readonly startCard: CardId | null;
  readonly god: boolean;
}

function cheat(
  id: CheatId,
  code: string,
  label: string,
  desc: string,
  extra: Partial<Omit<CheatDef, 'id' | 'code' | 'label' | 'desc'>>,
): CheatDef {
  return {
    id,
    code,
    label,
    desc,
    modifiers: extra.modifiers ?? [],
    caps: extra.caps ?? {},
    startShards: extra.startShards ?? 0,
    startOverdrive: extra.startOverdrive ?? 0,
    startCard: extra.startCard ?? null,
    god: extra.god ?? false,
  };
}

/** Order follows CHEAT_IDS. */
export const CHEATS: readonly CheatDef[] = [
  cheat('god', 'IDDQD', 'GOD MODE', 'Enemies, bullets and bosses cannot hurt you', { god: true }),
  cheat('glassCannon', 'GLASSCANNON', 'GLASS CANNON', '1 max HP, x5 damage', {
    modifiers: [
      { stat: 'maxHp', op: 'mul', value: 0.001 },
      { stat: 'damageMul', op: 'mul', value: 5 },
    ],
    caps: { damageMulMax: 20 },
  }),
  cheat('bitRain', 'BITRAIN', 'BIT RAIN', '+500 starting Bits, x2.5 Bit pickups', {
    modifiers: [{ stat: 'shardGain', op: 'add', value: 1.5 }],
    startShards: 500,
  }),
  cheat('turbo', 'TURBO', 'TURBO', 'x2 move speed, fire rate and bullet speed', {
    modifiers: [
      { stat: 'moveSpeed', op: 'mul', value: 2 },
      { stat: 'fireRate', op: 'mul', value: 2 },
      { stat: 'projectileSpeed', op: 'mul', value: 2 },
    ],
    caps: { moveSpeedMulMax: 3.2, fireRateMax: 40 },
  }),
  cheat('bulletStorm', 'BULLETSTORM', 'BULLET STORM', '+4 bullets per shot in a wide fan', {
    modifiers: [
      { stat: 'projectiles', op: 'flat', value: 4 },
      { stat: 'spreadDeg', op: 'flat', value: 16 },
    ],
    caps: { projectilesMax: 9 },
  }),
  cheat('blinkBlink', 'BLINKBLINK', 'BLINK BLINK', '+3 dash charges, dash cooldown -60%', {
    modifiers: [
      { stat: 'dashCharges', op: 'flat', value: 3 },
      { stat: 'dashCooldown', op: 'mul', value: 0.4 },
    ],
    caps: { dashChargesMax: 6, dashCooldownMin: 0.25 },
  }),
  cheat('fullCharge', 'FULLCHARGE', 'FULL CHARGE', 'Special starts full and charges x3 faster', {
    modifiers: [{ stat: 'specialChargeMul', op: 'add', value: 2 }],
    startOverdrive: 100,
  }),
  cheat('mythicStart', 'SUDORMRF', 'SUDO RM -RF', 'Start every run with the Mythic ROOT OF ALL EVIL', {
    startCard: 'rootOfAllEvil',
  }),
];

export function cheatDef(id: CheatId): CheatDef {
  const c = CHEATS[CHEAT_IDS.indexOf(id)];
  if (c?.id !== id) throw new RangeError(`unknown cheat ${id}`);
  return c;
}

/** Longest code the TERMINAL accepts (letters and digits). */
export const TERMINAL_MAX_INPUT = 16;

/** The cheat whose code matches `typed` (case and spaces ignored), else null. */
export function cheatByCode(typed: string): CheatDef | null {
  const t = typed.replace(/\s+/g, '').toUpperCase();
  if (t.length === 0) return null;
  for (const c of CHEATS) if (c.code === t) return c;
  return null;
}

/** Everything a run needs from its cheats, resolved once at run start. */
export interface CheatRunMods {
  readonly any: boolean;
  readonly modifiers: readonly StatModifier[];
  readonly caps: Partial<StatCaps> | undefined;
  readonly startShards: number;
  readonly startOverdrive: number;
  readonly startCards: readonly CardId[];
  readonly god: boolean;
}

export const NO_CHEATS: CheatRunMods = Object.freeze({
  any: false,
  modifiers: [],
  caps: undefined,
  startShards: 0,
  startOverdrive: 0,
  startCards: [],
  god: false,
});

function mergeCaps(into: Partial<Record<keyof StatCaps, number>>, caps: Partial<StatCaps>): void {
  for (const k of Object.keys(caps) as (keyof StatCaps)[]) {
    const v = caps[k];
    if (v === undefined) continue;
    const prev = into[k];
    // Minimum-style caps (dashCooldownMin) loosen downwards, the others upwards.
    const lower = k === 'dashCooldownMin';
    into[k] = prev === undefined ? v : lower ? Math.min(prev, v) : Math.max(prev, v);
  }
}

/** Resolves a (possibly untrusted) cheat list; unknown ids and duplicates are ignored. */
export function cheatRunMods(ids: readonly CheatId[] | undefined): CheatRunMods {
  if (ids === undefined || ids.length === 0) return NO_CHEATS;
  const seen = new Set<CheatId>();
  const modifiers: StatModifier[] = [];
  const caps: Partial<Record<keyof StatCaps, number>> = {};
  const startCards: CardId[] = [];
  let startShards = 0;
  let startOverdrive = 0;
  let god = false;
  for (const id of ids) {
    if (seen.has(id) || !CHEAT_IDS.includes(id)) continue;
    seen.add(id);
    const c = cheatDef(id);
    modifiers.push(...c.modifiers);
    mergeCaps(caps, c.caps);
    startShards += c.startShards;
    startOverdrive = Math.max(startOverdrive, c.startOverdrive);
    if (c.startCard !== null && !startCards.includes(c.startCard)) startCards.push(c.startCard);
    god = god || c.god;
  }
  if (seen.size === 0) return NO_CHEATS;
  return {
    any: true,
    modifiers,
    caps: Object.keys(caps).length > 0 ? caps : undefined,
    startShards,
    startOverdrive,
    startCards,
    god,
  };
}

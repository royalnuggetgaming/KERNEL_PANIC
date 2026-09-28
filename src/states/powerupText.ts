/**
 * The one powerup description table: plain-language text for every stat row, patch card, team item, Firmware
 * upgrade and shop utility, built from the config numbers (config/cards.ts, config/runCatalog.ts,
 * config/metaCatalog.ts, config/specials.ts). The Patch Bay, the Hangar, the HUD/Pause installed lists, the
 * in-game manual and MANUAL.md all read it, so a retune in config changes every text at once.
 */
import type { CardId, MetaUpgradeId, StatRowId, TeamItemId } from '../contracts/ids';
import type { NumericStat, StatModifier } from '../contracts/upgrades';
import { CARD_PARAMS, cardDef } from '../config/cards';
import { META_EFFECTS, metaDef } from '../config/metaCatalog';
import { REPAIR, TEAM_ITEMS, UTILITY_PRICES, statRowDef, teamItemDef } from '../config/runCatalog';
import { SPECIAL_TIER_BONUS } from '../config/specials';
import { COOP } from '../config/tuning';

/** How a stat reads in a sentence. 'pp' stats are fractions whose flat bonus reads as percentage points. */
interface StatPhrase {
  readonly noun: string;
  readonly flat: 'num' | 'pp' | 's' | 'u';
  /** Plural noun for flat counts above 1 (defaults to noun). */
  readonly plural?: string;
}

const STAT_PHRASE: Readonly<Record<NumericStat, StatPhrase>> = {
  maxHp: { noun: 'max HP', flat: 'num' },
  moveSpeed: { noun: 'move speed', flat: 'num' },
  fireRate: { noun: 'fire rate', flat: 'num' },
  damageMul: { noun: 'damage', flat: 'pp' },
  projectiles: { noun: 'projectile', flat: 'num', plural: 'projectiles' },
  spreadDeg: { noun: 'spread', flat: 'num' },
  pierce: { noun: 'pierce', flat: 'num' },
  bounces: { noun: 'wall bounce', flat: 'num', plural: 'wall bounces' },
  projectileSpeed: { noun: 'shot speed', flat: 'num' },
  critChance: { noun: 'crit chance', flat: 'pp' },
  magnetRadius: { noun: 'pickup radius', flat: 'u' },
  dashCooldown: { noun: 'dash cooldown', flat: 's' },
  dashCharges: { noun: 'dash charge', flat: 'num', plural: 'dash charges' },
  specialChargeMul: { noun: 'special charge rate', flat: 'pp' },
  specialTier: { noun: 'special tier', flat: 'num', plural: 'special tiers' },
  shardGain: { noun: 'Bits from pickups', flat: 'pp' },
  linkDps: { noun: 'link beam damage', flat: 'num' },
  linkRange: { noun: 'max link length', flat: 'u' },
  reviveTime: { noun: 'revive time', flat: 's' },
  reviveHpFrac: { noun: 'HP after a revive', flat: 'pp' },
  armor: { noun: 'contact damage reduction', flat: 'pp' },
};

/** Trims a number to at most 2 decimals ("1.5", "12", "0.25"). */
export function trimNum(x: number): string {
  const r = Math.round(x * 100) / 100;
  return String(r);
}

function signed(x: number, text: string): string {
  return (x < 0 ? '-' : '+') + text;
}

function pct(x: number): string {
  return `${trimNum(Math.abs(x) * 100)}%`;
}

/** The effect of one modifier applied `times` times ("+14% move speed", "-15% damage", "+2 dash charges"). */
export function modifierText(m: StatModifier, times = 1): string {
  const ph = STAT_PHRASE[m.stat];
  if (m.op === 'mul') {
    const total = Math.pow(m.value, times) - 1;
    return `${signed(total, pct(total))} ${ph.noun}`;
  }
  if (m.op === 'add') {
    const total = m.value * times;
    return `${signed(total, pct(total))} ${ph.noun}`;
  }
  const total = m.value * times;
  const mag = Math.abs(total);
  if (ph.flat === 'pp') return `${signed(total, pct(total))} ${ph.noun}`;
  if (ph.flat === 's') return `${signed(total, trimNum(mag) + ' s')} ${ph.noun}`;
  if (ph.flat === 'u') return `${signed(total, trimNum(mag) + ' u')} ${ph.noun}`;
  const noun = mag === 1 || ph.plural === undefined ? ph.noun : ph.plural;
  return `${signed(total, trimNum(mag))} ${noun}`;
}

/** Joined modifier effects ("+35% damage, -20% max HP"). */
export function modifiersText(mods: readonly StatModifier[], times = 1): string {
  const parts: string[] = [];
  for (const m of mods) parts.push(modifierText(m, times));
  return parts.join(', ');
}

function tierText(): string {
  return `special tier +1: +${pct(SPECIAL_TIER_BONUS)} special radius, duration and damage`;
}

// ---------------------------------------------------------------- stat rows

/** One level's effect, e.g. "+7% move speed per level". */
export function statRowDesc(id: StatRowId): string {
  const def = statRowDef(id);
  if (id === 'specialTuning') return `Each level: ${tierText()} (max tier ${def.maxLevel + 1})`;
  const extra = id === 'plating' ? ' (heals you by the same amount)' : '';
  return `${modifiersText(def.perLevel)} per level${extra}`;
}

/** Total effect at a level ("+14% move speed"); "" at level 0. */
export function statRowTotal(id: StatRowId, level: number): string {
  if (level <= 0) return '';
  const def = statRowDef(id);
  if (id === 'specialTuning') return `special tier ${level + 1} (+${pct(SPECIAL_TIER_BONUS * level)} power)`;
  return modifiersText(def.perLevel, level);
}

/** Current vs next level ("Lv 2: +14% move speed -> Lv 3: +21% move speed", "MAX: ..."). */
export function levelStep(total: (level: number) => string, level: number, maxLevel: number): string {
  const now = level > 0 ? `Lv ${level}: ${total(level)}` : 'Not installed';
  if (level >= maxLevel) return `MAX · ${now}`;
  return `${now} → Lv ${level + 1}: ${total(level + 1)}`;
}

export function statRowNext(id: StatRowId, level: number): string {
  return levelStep((l) => statRowTotal(id, l), level, statRowDef(id).maxLevel);
}

// ---------------------------------------------------------------- patch cards

function cardEffect(id: CardId, runCurrency: string): string {
  const def = cardDef(id);
  switch (id) {
    case 'splitShot': {
      const c = CARD_PARAMS.splitShot;
      return `Fire ${c.sideBullets} extra side bullets at ±${c.angleDeg}° (${modifiersText(def.modifiers)})`;
    }
    case 'afterimage': {
      const c = CARD_PARAMS.afterimage;
      return `Your dash leaves a damaging trail for ${trimNum(c.trailTime)} s (${c.dps} damage/s)`;
    }
    case 'vampireCode':
      return `Heal 1 HP for every ${CARD_PARAMS.vampireCode.killsPerHp} kills`;
    case 'overheat': {
      const c = CARD_PARAMS.overheat;
      return `+${pct(c.fireRateBonus)} fire rate while you are below ${pct(c.hpFrac)} HP`;
    }
    case 'chainArc': {
      const c = CARD_PARAMS.chainArc;
      return `${pct(c.chance)} of hits arc to ${c.targets} nearby enemies for ${pct(c.damageMul)} damage`;
    }
    case 'microMissiles': {
      const c = CARD_PARAMS.microMissiles;
      return `Launch ${c.count} homing missiles every ${trimNum(c.interval)} s (${c.damage} damage each)`;
    }
    case 'nanoshield':
      return `A shield blocks one hit, then recharges for ${CARD_PARAMS.nanoshield.interval} s`;
    case 'orbitals': {
      const c = CARD_PARAMS.orbitals;
      return `${c.blades} blades orbit your craft, dealing ${c.dps} damage/s on contact`;
    }
    case 'forkCall':
      return `Every ${CARD_PARAMS.forkCall.every}th volley fires twice`;
    case 'sudo':
      return `Your special fires ${CARD_PARAMS.sudo.casts === 2 ? 'twice' : `${CARD_PARAMS.sudo.casts} times`} per use`;
    case 'rootAccess':
      return `Combo tier +${CARD_PARAMS.rootAccess.tierBonus} permanently (more score and ${runCurrency})`;
    case 'shardCache':
      return `Instantly gain ${CARD_PARAMS.shardCache.shards} ${runCurrency} (free)`;
    case 'pierce':
      return `${modifiersText(def.modifiers)}: shots pass through one more enemy`;
    case 'ricochet':
      return `${modifiersText(def.modifiers)}: shots bounce off the arena wall`;
    case 'overdriveBattery':
    case 'bounty':
    case 'doubleBuffer':
    case 'glassLens':
      return modifiersText(def.modifiers).replace('Bits', runCurrency);
  }
}

/** Plain-language card effect plus how it stacks. */
export function cardDesc(id: CardId, runCurrency = 'Bits'): string {
  const def = cardDef(id);
  const base = cardEffect(id, runCurrency);
  if (id === 'shardCache' || def.stackMax <= 1) return base;
  return `${base}; stacks ×${def.stackMax}`;
}

/** Owned stacks vs the card's max ("Owned ×1 of 2", "Not owned", "MAX · owned ×2"). */
export function cardOwnedText(id: CardId, stacks: number): string {
  const def = cardDef(id);
  if (id === 'shardCache') return 'One-shot: the Bits go straight to your wallet';
  if (stacks <= 0) return def.stackMax > 1 ? `Not owned (stacks up to ×${def.stackMax})` : 'Not owned';
  if (stacks >= def.stackMax) return `MAX · owned ×${stacks}`;
  return `Owned ×${stacks} of ${def.stackMax}`;
}

// ---------------------------------------------------------------- team items

function flatSum(mods: readonly StatModifier[], stat: NumericStat): number {
  let sum = 0;
  for (const m of mods) if (m.stat === stat && m.op === 'flat') sum += m.value;
  return sum;
}

export function teamDesc(id: TeamItemId): string {
  const def = teamItemDef(id);
  switch (id) {
    case 'spareKernel':
      return `Team extra life: a downed player with no partner left reboots instead of the run ending (hold ${def.holdCap ?? 0})`;
    case 'linkAmp':
      return `${modifiersText(def.modifiers)} per level for both players`;
    case 'linkRange':
      return `${modifiersText(def.modifiers)} per level (base ${COOP.LINK_MAX} u)`;
    case 'reviveProtocol': {
      const time = COOP.REVIVE_TIME + flatSum(def.modifiers, 'reviveTime');
      const hp = COOP.REVIVE_HP_FRAC + flatSum(def.modifiers, 'reviveHpFrac');
      return `Revives take ${trimNum(time)} s instead of ${trimNum(COOP.REVIVE_TIME)} s and restore ${pct(hp)} HP instead of ${pct(COOP.REVIVE_HP_FRAC)}`;
    }
  }
}

export function teamTotal(id: TeamItemId, level: number): string {
  if (level <= 0) return '';
  if (id === 'spareKernel') return `${level} held`;
  if (id === 'linkRange') {
    const per = flatSum(teamItemDef(id).modifiers, 'linkRange');
    return `max link length ${trimNum(COOP.LINK_MAX + per * level)} u`;
  }
  return modifiersText(teamItemDef(id).modifiers, level);
}

export function teamNext(id: TeamItemId, level: number): string {
  const def = teamItemDef(id);
  if (id === 'spareKernel') return `Holding ${level} of ${def.holdCap ?? 0} · shared by the team`;
  return levelStep((l) => teamTotal(id, l), level, def.maxLevel);
}

// ---------------------------------------------------------------- firmware (Hangar)

export function metaDesc(id: MetaUpgradeId, runCurrency = 'Bits'): string {
  const def = metaDef(id);
  const per = def.prices.length > 1 ? ' per level' : '';
  switch (id) {
    case 'bootCache':
      return `Start every run with +${META_EFFECTS.bootCacheShards} ${runCurrency}${per}`;
    case 'rerollCache':
      return `+${META_EFFECTS.rerollCachePerLevel} free Patch Bay reroll every visit${per}`;
    case 'preCharge':
      return `Your special starts every run ${META_EFFECTS.preChargeOverdrive}% charged`;
    case 'secondBoot':
      return `Start every run with +${META_EFFECTS.secondBootKernels} Spare Kernel`;
    case 'legendaryPool':
      return 'Legendary patch cards (FORK(), SUDO, ROOT ACCESS) can appear in the Patch Bay';
    case 'hullFw':
    case 'magnetFw':
    case 'overclockFw':
    case 'fieldMedic':
      return `${modifiersText(def.modifiers)}${per}, permanently`;
  }
}

export function metaTotal(id: MetaUpgradeId, level: number, runCurrency = 'Bits'): string {
  if (level <= 0) return '';
  const def = metaDef(id);
  switch (id) {
    case 'bootCache':
      return `+${META_EFFECTS.bootCacheShards * level} starting ${runCurrency}`;
    case 'rerollCache':
      return `${META_EFFECTS.rerollCachePerLevel * level} free rerolls per visit`;
    case 'preCharge':
    case 'secondBoot':
    case 'legendaryPool':
      return 'active';
    case 'hullFw':
    case 'magnetFw':
    case 'overclockFw':
    case 'fieldMedic':
      return modifiersText(def.modifiers, level);
  }
}

export function metaNext(id: MetaUpgradeId, level: number, runCurrency = 'Bits'): string {
  return levelStep((l) => metaTotal(id, l, runCurrency), level, metaDef(id).prices.length);
}

// ---------------------------------------------------------------- utilities

export function repairDesc(): string {
  return `Heal ${pct(REPAIR.healFrac)} of your max HP (up to ${REPAIR.maxPerVisit} per visit; price rises each time)`;
}

export function rerollDesc(): string {
  return 'Replace your 3 patch cards with new ones (a locked card stays); price rises each reroll';
}

export function giftDesc(runCurrency = 'Bits'): string {
  return `Give ${UTILITY_PRICES.giftAmount} ${runCurrency} to your partner (Undo refunds it)`;
}

export function lockDesc(): string {
  return `Lock keeps ${UTILITY_PRICES.maxLocks} card for your next visit at today's price`;
}

/** Team item ids shown in installed lists (Spare Kernels have their own HUD counter). */
export const INSTALLED_TEAM_ITEMS: readonly TeamItemId[] = TEAM_ITEMS.map((t) => t.id).filter(
  (id) => id !== 'spareKernel',
);

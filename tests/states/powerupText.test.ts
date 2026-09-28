import { describe, expect, it } from 'vitest';
import { CARD_IDS, META_UPGRADE_IDS, STAT_ROW_IDS, TEAM_ITEM_IDS } from '../../src/contracts/ids';
import { CARD_PARAMS, cardDef } from '../../src/config/cards';
import { META_EFFECTS, metaDef } from '../../src/config/metaCatalog';
import { REPAIR, statRowDef, teamItemDef } from '../../src/config/runCatalog';
import { COOP } from '../../src/config/tuning';
import {
  cardDesc,
  cardOwnedText,
  giftDesc,
  metaDesc,
  metaNext,
  modifierText,
  repairDesc,
  rerollDesc,
  statRowDesc,
  statRowNext,
  statRowTotal,
  teamDesc,
  teamNext,
  trimNum,
} from '../../src/states/powerupText';

const pct = (x: number): string => `${trimNum(Math.abs(x) * 100)}%`;

function allTexts(): string[] {
  const out: string[] = [repairDesc(), rerollDesc(), giftDesc()];
  for (const id of STAT_ROW_IDS) {
    out.push(statRowDesc(id));
    for (let l = 0; l <= statRowDef(id).maxLevel; l++) out.push(statRowNext(id, l), statRowTotal(id, l));
  }
  for (const id of CARD_IDS) out.push(cardDesc(id), cardOwnedText(id, 0), cardOwnedText(id, 1));
  for (const id of TEAM_ITEM_IDS) out.push(teamDesc(id), teamNext(id, 0), teamNext(id, 1));
  for (const id of META_UPGRADE_IDS) {
    out.push(metaDesc(id));
    for (let l = 0; l <= metaDef(id).prices.length; l++) out.push(metaNext(id, l));
  }
  return out;
}

describe('powerup description table', () => {
  it('every powerup has a plain-language description with no unfilled values', () => {
    for (const t of allTexts()) {
      expect(t).not.toMatch(/undefined|NaN|Infinity|\[object/);
    }
    for (const id of STAT_ROW_IDS) expect(statRowDesc(id).length).toBeGreaterThan(8);
    for (const id of CARD_IDS) expect(cardDesc(id).length).toBeGreaterThan(8);
    for (const id of TEAM_ITEM_IDS) expect(teamDesc(id).length).toBeGreaterThan(8);
    for (const id of META_UPGRADE_IDS) expect(metaDesc(id).length).toBeGreaterThan(8);
  });

  it('stat rows read the per-level value from config and show current -> next', () => {
    const thr = statRowDef('thrusters').perLevel[0]!;
    expect(statRowDesc('thrusters')).toBe(`+${pct(thr.value)} move speed per level`);
    expect(statRowNext('thrusters', 0)).toBe(`next: +${pct(thr.value)}`);
    expect(statRowNext('thrusters', 2)).toBe(`now +${pct(thr.value * 2)} → next +${pct(thr.value * 3)}`);
    const max = statRowDef('thrusters').maxLevel;
    expect(statRowNext('thrusters', max)).toBe(`MAX: +${pct(thr.value * max)}`);
    expect(statRowTotal('thrusters', 2)).toBe(`+${pct(thr.value * 2)} move speed`);
    const plate = statRowDef('plating').perLevel[0]!;
    expect(statRowDesc('plating')).toContain(`+${plate.value} max HP per level`);
    expect(statRowDesc('coolant')).toMatch(/^-\d+% dash cooldown per level$/);
    expect(statRowNext('specialTuning', 0)).toBe('next: tier 2');
  });

  it('patch cards describe their behaviour numbers from CARD_PARAMS', () => {
    const split = CARD_PARAMS.splitShot;
    expect(cardDesc('splitShot')).toContain(`${split.sideBullets} extra side bullets`);
    expect(cardDesc('splitShot')).toContain(`-${pct(1 - split.damageMul)} damage`);
    expect(cardDesc('splitShot')).toContain(`stacks ×${cardDef('splitShot').stackMax}`);
    expect(cardDesc('afterimage')).toContain(
      `dash leaves a damaging trail for ${CARD_PARAMS.afterimage.trailTime} s`,
    );
    expect(cardDesc('microMissiles')).toContain(`${CARD_PARAMS.microMissiles.count} homing missiles`);
    const lens = cardDef('glassLens').modifiers;
    expect(cardDesc('glassLens')).toBe(`+${pct(lens[0]!.value)} damage, -${pct(1 - lens[1]!.value)} max HP`);
    expect(cardDesc('shardCache', 'Credits')).toBe(
      `Instantly gain ${CARD_PARAMS.shardCache.shards} Credits (free)`,
    );
    expect(cardDesc('bounty', 'Credits')).toContain('Credits from pickups');
    expect(cardOwnedText('splitShot', 1)).toBe(`Owned ×1 of ${cardDef('splitShot').stackMax}`);
    expect(cardOwnedText('afterimage', 1)).toBe('MAX · owned ×1');
  });

  it('team items and firmware use their config values', () => {
    const amp = teamItemDef('linkAmp').modifiers[0]!;
    expect(teamDesc('linkAmp')).toContain(`+${pct(amp.value)} link beam damage`);
    const range = teamItemDef('linkRange').modifiers[0]!.value;
    expect(teamNext('linkRange', 1)).toBe(
      `now ${COOP.LINK_MAX + range} u → next ${COOP.LINK_MAX + 2 * range} u`,
    );
    expect(teamDesc('reviveProtocol')).toContain(`instead of ${COOP.REVIVE_TIME} s`);
    expect(metaDesc('bootCache')).toContain(`+${META_EFFECTS.bootCacheShards} Bits`);
    const hull = metaDef('hullFw').modifiers[0]!.value;
    expect(metaNext('hullFw', 1)).toBe(`now +${pct(hull)} → next +${pct(hull * 2)}`);
    expect(metaNext('legendaryPool', 1)).toBe('MAX: active');
    expect(repairDesc()).toContain(pct(REPAIR.healFrac));
  });

  it('modifier phrasing covers flat, add and mul operations', () => {
    expect(modifierText({ stat: 'dashCharges', op: 'flat', value: 1 })).toBe('+1 dash charge');
    expect(modifierText({ stat: 'dashCharges', op: 'flat', value: 1 }, 2)).toBe('+2 dash charges');
    expect(modifierText({ stat: 'damageMul', op: 'mul', value: 0.85 })).toBe('-15% damage');
    expect(modifierText({ stat: 'reviveTime', op: 'flat', value: -0.8 })).toBe('-0.8 s revive time');
    expect(modifierText({ stat: 'linkRange', op: 'flat', value: 4 }, 2)).toBe('+8 u max link length');
  });
});

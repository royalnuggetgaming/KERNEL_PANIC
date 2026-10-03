/**
 * HOW TO PLAY reference pages: every powerup (from the powerupText table), enemies, bosses, sectors/OVERFLOW
 * and Firmware/Cores. All numbers come from config.
 */
import { ENEMY_KINDS, type EnemyKind } from '../contracts/ids';
import type { ThemeDef } from '../contracts/theme';
import type { ManualBlockVM, ManualPageVM } from '../contracts/ui';
import type { Rarity } from '../contracts/upgrades';
import { BOSS_COMMON, BOSS_DEFS, FORK_BOMB_SPLITS } from '../config/bosses';
import { CARDS, MYTHIC } from '../config/cards';
import { CORRUPTED, ENEMY_DEFS } from '../config/enemies';
import { META_GROUPS, META_GROUP_OF, META_UPGRADES, VEHICLE_UNLOCKS } from '../config/metaCatalog';
import { STAT_ROWS, TEAM_ITEMS } from '../config/runCatalog';
import { COOP, ECONOMY } from '../config/tuning';
import { OVERFLOW, WAVES } from '../config/waves';
import { hd, item, page, para, pctText } from './manualBlocks';
import {
  cardDesc,
  giftDesc,
  lockDesc,
  metaDesc,
  repairDesc,
  rerollDesc,
  statRowDesc,
  teamDesc,
  trimNum,
} from './powerupText';

const RARITY_NAME: Readonly<Record<Rarity, string>> = {
  C: 'Common',
  U: 'Uncommon',
  R: 'Rare',
  L: 'Legendary',
  M: 'MYTHIC (super rare)',
};

function levels(n: number): string {
  return Number.isFinite(n) ? `${n} level${n === 1 ? '' : 's'}` : 'no level cap';
}

function systemsPage(t: ThemeDef): ManualPageVM {
  const blocks: ManualBlockVM[] = [
    para(
      `Stat rows are always on sale. Each level adds the listed amount; prices rise with level and ${t.names.wave.toLowerCase()}.`,
    ),
  ];
  for (const r of STAT_ROWS) blocks.push(item(r.label, `${statRowDesc(r.id)} (${levels(r.maxLevel)})`));
  blocks.push(item('Repair', repairDesc()));
  return page('systems', `Powerups: Systems (${t.names.shop})`, blocks);
}

function cardsPage(t: ThemeDef, id: string, title: string, rarities: readonly Rarity[]): ManualPageVM {
  const blocks: ManualBlockVM[] = [];
  for (const r of rarities) {
    blocks.push(hd(RARITY_NAME[r]));
    for (const c of CARDS)
      if (c.rarity === r) blocks.push(item(c.label, cardDesc(c.id, t.names.runCurrency)));
  }
  if (rarities.includes('L')) {
    blocks.push(para(`Legendary cards appear only after you buy the Legendary Pool ${t.names.meta}.`));
    blocks.push(
      para(
        `MYTHIC: from sector ${MYTHIC.fromSector} on, every fresh card slot has a ${trimNum(MYTHIC.offerChance * 100)}% chance to hold the one Mythic card instead (no Firmware needed). It glows gold in the ${t.names.shop}; grab it if you can afford it.`,
      ),
    );
  } else {
    blocks.push(para('Unique cards can be owned once; the others stack up to the listed count.'));
  }
  return page(id, title, blocks);
}

function teamPage(t: ThemeDef): ManualPageVM {
  const n = t.names;
  const blocks: ManualBlockVM[] = [
    para(
      `Team items are shared: either player can pay from their own wallet and both benefit. Hidden in ${n.versus}.`,
    ),
  ];
  for (const ti of TEAM_ITEMS) {
    const cap = ti.id === 'spareKernel' ? '' : ` (${levels(ti.maxLevel)})`;
    blocks.push(item(n.teamItems[ti.id], `${teamDesc(ti.id)}${cap}`));
  }
  blocks.push(hd('Utility'));
  blocks.push(item('Reroll', rerollDesc()));
  blocks.push(item('Lock', lockDesc()));
  blocks.push(item('Gift', `${giftDesc(n.runCurrency)}; ${n.coop} only`));
  blocks.push(item('Undo', 'Dash undoes your last purchase this visit for a full refund'));
  return page('team', 'Powerups: Team & Utility', blocks);
}

function enemyText(kind: EnemyKind, t: ThemeDef): string {
  switch (kind) {
    case 'shard':
      return 'Swarms straight at you. Weak alone, dangerous in packs: sweep them with shots or the Link Beam.';
    case 'dart': {
      const p = ENEMY_DEFS.dart.params;
      return `Stops, shows a line for ${trimNum(p.telegraph)} s, then lunges along it. Sidestep the line or dash through it.`;
    }
    case 'fork': {
      const p = ENEMY_DEFS.fork.params;
      return `Splits into ${p.splitCount} ${t.names.enemies.shard}s when destroyed. Kill it at range so the pieces do not land on you.`;
    }
    case 'spiker': {
      const p = ENEMY_DEFS.spiker.params;
      return `Keeps its distance and, after a warning pulse, fires a ring of ${p.bullets} bullets every ${trimNum(p.interval)} s. Slip through the gaps and close in between bursts.`;
    }
    case 'warden': {
      const p = ENEMY_DEFS.warden.params;
      return `A ${p.shieldArcDeg}° front shield blocks your shots and it fires ${p.volleyShots}-shot volleys. It turns slowly: flank it or hit it from behind.`;
    }
    case 'leech':
      return 'Fast; latches onto the Link Beam and cuts it. Kill it or dash through it to restore the beam.';
  }
}

function enemiesPage(t: ThemeDef): ManualPageVM {
  const n = t.names;
  const blocks: ManualBlockVM[] = [
    para(
      `Enemies arrive in formations at the portals farthest from you, each announced by a warning ring. New kinds unlock as the ${n.wave.toLowerCase()}s go on.`,
    ),
  ];
  for (const k of ENEMY_KINDS) {
    const d = ENEMY_DEFS[k];
    blocks.push(item(`${n.enemies[k]} (${n.wave} ${d.unlockWave}+)`, enemyText(k, t)));
  }
  blocks.push(
    item(
      'CORRUPTED elites',
      `From ${n.sector} ${CORRUPTED.fromSector}, some enemies glitch: ×${CORRUPTED.hpMul} HP and ×${CORRUPTED.dropMul} ${n.runCurrency}.`,
    ),
  );
  blocks.push(para('Enemy bullets are always hot orange: anything orange hurts.'));
  return page('enemies', 'Enemies', blocks);
}

function bossesPage(t: ThemeDef): ManualPageVM {
  const n = t.names;
  const fb = BOSS_DEFS.forkBomb;
  const rc = BOSS_DEFS.raceCondition;
  const kn = BOSS_DEFS.kernel;
  return page('bosses', 'Bosses', [
    para(
      `A boss ends every ${n.sector.toLowerCase()}. Its HP bar is at the top of the screen. Bosses have ×${BOSS_COMMON.TWO_PLAYER_HP_MUL} HP with two players and ENRAGE after ${BOSS_COMMON.ENRAGE_AT} s (attacks ×${BOSS_COMMON.ENRAGE_RATE_MUL} faster).`,
    ),
    item(
      `${n.bosses.forkBomb} (${n.wave} ${fb.wave})`,
      `${fb.hp} HP. Splits into 2 at ${pctText(FORK_BOMB_SPLITS[0])} HP and into 4 at ${pctText(FORK_BOMB_SPLITS[1])}. Focus one piece at a time and keep moving around the edge.`,
    ),
    item(
      `${n.bosses.raceCondition} (${n.wave} ${rc.wave})`,
      `Twin processes of ${rc.hp} HP each. Both must die within ${COOP.RACE_WINDOW_COOP} s of each other (${COOP.RACE_WINDOW_SOLO} s solo) or the dead one respawns at ${pctText(COOP.RACE_RESPAWN_FRAC)} HP. Bring both low, then finish them together.`,
    ),
    item(
      `${n.bosses.kernel} (${n.wave} ${kn.wave})`,
      `${kn.hp} HP in three phases: rotating firewall segments, bullet spirals, then a desperation phase that summons enemies. Save your special for the last phase.`,
    ),
    para(
      `Bosses drop a big pile of ${n.runCurrency}. In ${n.overflow} they return every ${OVERFLOW.BOSS_EVERY} ${n.wave.toLowerCase()}s.`,
    ),
  ]);
}

function sectorsPage(t: ThemeDef): ManualPageVM {
  const n = t.names;
  const cyc = n.wave.toLowerCase();
  return page('sectors', `${n.sector}s & ${n.overflow}`, [
    item(
      `${n.sector}s`,
      `${WAVES.SECTORS} ${n.sector.toLowerCase()}s of ${WAVES.WAVES_PER_SECTOR} ${cyc}s. Each ${n.sector.toLowerCase()} changes the arena colours, adds tougher enemies and ends with a boss.`,
    ),
    item(
      `${n.wave} timer`,
      `A ${cyc} lasts ${WAVES.DURATION_BASE} s, growing ${WAVES.DURATION_PER_WAVE} s per ${cyc} (max ${WAVES.DURATION_CAP} s). Enemy HP grows ${pctText(WAVES.HP_GROWTH - 1)} per ${cyc}.`,
    ),
    item(
      'PURGE',
      `When the timer runs out, the survivors de-rez and pay ${pctText(WAVES.PURGE_PAYOUT)} of their ${n.runCurrency}: no reason to stall.`,
    ),
    item(
      'Clear',
      `Bullets vanish, time slows, pickups fly to you, downed players reboot and the ${n.shop} opens.`,
    ),
    item(
      `${n.extract} / ${n.pushDeeper}`,
      `After ${n.wave} ${WAVES.TOTAL} the last ${n.shop} visit asks: ${n.extract} ends the run as a victory; ${n.pushDeeper} continues into ${n.overflow}.`,
    ),
    item(
      n.overflow,
      `Endless ${cyc}s: enemy HP +${pctText(OVERFLOW.HP_PER_WAVE)} per ${cyc} and a boss every ${OVERFLOW.BOSS_EVERY}th ${cyc}. Your victory is already banked.`,
    ),
  ]);
}

function firmwarePage(t: ThemeDef): ManualPageVM {
  const n = t.names;
  const blocks: ManualBlockVM[] = [
    para(
      `Every run ends at the results screen, which pays ${n.metaCurrency}: 1 per ${ECONOMY.CORES_PER_SHARDS} ${n.runCurrency} earned, +${ECONOMY.CORES_PER_WAVE} per ${n.wave.toLowerCase()} cleared, +${ECONOMY.CORES_PER_BOSS} per boss, +${ECONOMY.CORES_VICTORY_BONUS} for a victory (max ${ECONOMY.CORES_CAP} per run). Abandoning still pays for progress.`,
    ),
    para(
      `${n.metaCurrency} are earned at the end of every run, even a loss. Spend them in ${n.meta} (main menu) on permanent upgrades: every one applies automatically to every future run, and shows under INSTALLED (tagged FIRMWARE) in the ${n.shop}, the HUD and the pause menu.`,
    ),
  ];
  for (const g of META_GROUPS) {
    blocks.push(hd(`${n.meta}: ${g}`));
    for (const m of META_UPGRADES)
      if (META_GROUP_OF[m.id] === g)
        blocks.push(item(m.label, `${metaDesc(m.id, n.runCurrency)} (${levels(m.prices.length)})`));
  }
  blocks.push(hd('Craft'));
  blocks.push(
    item(
      'Craft unlocks',
      `${n.vehicles.specter} ${VEHICLE_UNLOCKS.specter} ${n.metaCurrency}, ${n.vehicles.tinker} ${VEHICLE_UNLOCKS.tinker} ${n.metaCurrency}. RESPEC refunds all ${n.meta} (unlocks stay).`,
    ),
  );
  blocks.push(
    para(
      'There is also a TERMINAL on the main menu. Rumour says typing the right words into it does strange things...',
    ),
  );
  return page('firmware', `${n.meta} & ${n.metaCurrency}`, blocks);
}

export interface ReferencePages {
  readonly powerups: readonly ManualPageVM[];
  readonly world: readonly ManualPageVM[];
}

export function referencePages(t: ThemeDef): ReferencePages {
  return {
    powerups: [
      systemsPage(t),
      cardsPage(t, 'cardsA', 'Powerups: Patch Cards (Common, Uncommon)', ['C', 'U']),
      cardsPage(t, 'cardsB', 'Powerups: Patch Cards (Rare, Legendary, Mythic)', ['R', 'L', 'M']),
      teamPage(t),
    ],
    world: [enemiesPage(t), bossesPage(t), sectorsPage(t), firmwarePage(t)],
  };
}

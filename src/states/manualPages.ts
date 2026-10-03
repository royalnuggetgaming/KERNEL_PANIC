/**
 * HOW TO PLAY content (in-game manual and MANUAL.md): the rules pages. Numbers are read from config so a retune
 * changes the manual too; key names come from the live bindings. The powerup, enemy, boss and Firmware reference
 * pages live in manualReference.ts.
 */
import type { Action, Bindings, KeyCode } from '../contracts/input';
import type { ThemeDef } from '../contracts/theme';
import type { ManualBlockVM, ManualPageVM } from '../contracts/ui';
import { DIFFICULTY, type DifficultyDef } from '../config/difficulty';
import { MENU_KEYS, keyLabel } from '../config/keys';
import { SPECIALS, SPECIAL_TIER_BONUS } from '../config/specials';
import { COMBO, COOP, DASH, MOVEMENT, OVERDRIVE, PICKUPS } from '../config/tuning';
import { VEHICLES } from '../config/vehicles';
import { THEMES } from '../themes/registry';
import { VERSUS } from '../config/versus';
import { WAVES } from '../config/waves';
import { referencePages } from './manualReference';
import { hd, item, page, para, pctText } from './manualBlocks';
import { trimNum } from './powerupText';

/** Punctuation keys read badly in a list (", , NUM ENTER"), so they are spelled out: "COMMA (,)". */
function keyName(code: KeyCode): string {
  const label = keyLabel(code);
  return /^[!-/:-@[-`{-~]$/.test(label) ? `${code.toUpperCase()} (${label})` : label;
}

function keys(codes: readonly KeyCode[]): string {
  return codes.length === 0 ? '(unbound)' : codes.map(keyName).join(' or ');
}

function moveKeys(b: Bindings, p: 0 | 1): string {
  const pb = b.players[p];
  const first = (a: Action): string => {
    const c = pb[a][0];
    return c === undefined ? '?' : keyName(c);
  };
  return `${first('up')} ${first('left')} ${first('down')} ${first('right')}`;
}

function both(b: Bindings, a: Action): string {
  return `P1: ${keys(b.players[0][a])}   ·   P2: ${keys(b.players[1][a])}`;
}

function goalPage(t: ThemeDef): ManualPageVM {
  const n = t.names;
  const cycles = n.wave;
  return page('goal', 'Goal', [
    para(
      `You are antivirus daemons inside a crashing server. Corrupted processes pour out of portals around the arena: destroy them, survive every ${cycles.toLowerCase()} and keep the kernel alive.`,
    ),
    item(
      'The run',
      `${WAVES.SECTORS} ${n.sector.toLowerCase()}s × ${WAVES.WAVES_PER_SECTOR} ${cycles.toLowerCase()}s = ${WAVES.TOTAL} ${cycles.toLowerCase()}s. The last ${cycles.toLowerCase()} of every ${n.sector.toLowerCase()} is a boss.`,
    ),
    item(
      `Between ${cycles.toLowerCase()}s`,
      `Spend the ${n.runCurrency} you collected in the ${n.shop} on upgrades that last for the rest of the run.`,
    ),
    item(
      'Winning',
      `Beat the final boss, then choose ${n.extract} (bank the victory) or ${n.pushDeeper} into endless ${n.overflow} waves.`,
    ),
    item(
      'Losing',
      `The run ends when every player is down and no ${n.lives} are left. You still earn ${n.metaCurrency} for your progress.`,
    ),
    item('Modes', `SOLO, ${n.coop} (two players, one keyboard) and ${n.versus} (a best-of-five duel).`),
    para(
      `Every run pays ${n.metaCurrency} for permanent ${n.meta} upgrades, so each attempt makes the next one easier.`,
    ),
  ]);
}

function controlsPage(b: Bindings): ManualPageVM {
  return page('controls', 'Controls', [
    para('These are your current key bindings. Change them in CONTROLS (main menu or pause).'),
    item('Move', `P1: ${moveKeys(b, 0)}   ·   P2: ${moveKeys(b, 1)}`),
    item('Fire / Focus', both(b, 'fire')),
    item('Dash', both(b, 'dash')),
    item('Special', both(b, 'special')),
    item('Pause', keys(b.pause)),
    hd('Menus'),
    item('Navigate', 'Either player’s move keys'),
    item('Confirm', `${keys(MENU_KEYS.confirm)} or a player’s Fire key`),
    item('Back', `${keys(MENU_KEYS.back)} or a player’s Dash key`),
    item('Mouse', 'Click any menu item, shop row or button'),
    hd('Patch Bay and character select'),
    para(
      'Each player moves their own cursor with their own keys: Fire buys or confirms, Dash undoes the last purchase, Special toggles READY. Player 2 joins at character select by pressing their Fire key.',
    ),
    item('Solo', 'Both key sets control Player 1, so use whichever hand position you like.'),
  ]);
}

function basicsPage(t: ThemeDef): ManualPageVM {
  const n = t.names;
  const rb = SPECIALS.railburst;
  const fw = SPECIALS.firewall;
  const bs = SPECIALS.blinkSwarm;
  const pd = SPECIALS.patchDrone;
  return page('basics', 'Move, Fire, Focus, Dash, Special', [
    item('Move', 'Steer with your move keys. Your craft has a little inertia, so start turning early.'),
    item(
      'Fire',
      'Autofire is ON by default: your craft shoots where it faces and aim assist snaps to the nearest enemy in front of you. Turn autofire off per player in SETTINGS to hold Fire to shoot.',
    ),
    item(
      'Focus',
      `Hold Fire to focus: your facing locks (strafe!), spread tightens by ${pctText(1 - MOVEMENT.FOCUS_SPREAD_MUL)}, damage rises by ${pctText(MOVEMENT.FOCUS_DAMAGE_BONUS)}, but you move ${pctText(1 - MOVEMENT.FOCUS_MOVE_MUL)} slower.`,
    ),
    item(
      'Dash',
      `A quick ${DASH.DISTANCE} u burst with ${trimNum(DASH.IFRAMES)} s of invulnerability: dash THROUGH bullets and enemies. Recharges in ${trimNum(DASH.BASE_COOLDOWN)} s. It also shakes off latched Leeches.`,
    ),
    item(
      'Special',
      `Fills from damage you deal and +${OVERDRIVE.PER_KILL} per kill (the OVR bar). Press Special when it is full.`,
    ),
    hd('Specials by craft'),
    item(
      `${n.vehicles.lancer}: ${n.specials.railburst}`,
      `A ${rb.length} u piercing rail beam for ${rb.damage} damage.`,
    ),
    item(
      `${n.vehicles.bulwark}: ${n.specials.firewall}`,
      `A ${trimNum(fw.radius)} u bubble for ${trimNum(fw.duration)} s that deletes enemy bullets. Bulwark’s dash also rams for ${VEHICLES.bulwark.ramDamage} damage.`,
    ),
    item(
      `${n.vehicles.specter}: ${n.specials.blinkSwarm}`,
      `Teleport ${bs.distance} u and leave ${bs.mines} seeking mines (${bs.mineDamage} damage each).`,
    ),
    item(
      `${n.vehicles.tinker}: ${n.specials.patchDrone}`,
      `A drone that heals ${pd.healPerS} HP/s within ${pd.radius} u for ${pd.duration} s and shoots nearby enemies.`,
    ),
    para(
      `Special Tuning (${n.shop}) raises the tier: each tier adds ${pctText(SPECIAL_TIER_BONUS)} radius, duration and damage.`,
    ),
  ]);
}

function linkPage(t: ThemeDef): ManualPageVM {
  return page('link', 'Link Beam', [
    para(
      `In ${t.names.coop}, a beam joins the two craft whenever both are alive and between ${COOP.LINK_MIN} and ${COOP.LINK_MAX} u apart.`,
    ),
    item('Damage', `The beam deals ${COOP.LINK_DPS} damage per second to every enemy it crosses.`),
    item('Shared kills', 'Beam kills count for both players’ combos.'),
    item(
      'Positioning',
      'Stay a medium distance apart and sweep the beam through crowds: circle around each other, or let one player kite while the other anchors.',
    ),
    item(
      'Solo: Echo Drone',
      `Playing alone, an Echo Drone orbits you at ${COOP.ECHO_ORBIT} u and forms the beam with you at ${pctText(COOP.ECHO_DAMAGE_MUL)} damage.`,
    ),
    item('Leeches', 'Leech enemies latch onto the beam and cut it. Kill them or dash through them.'),
    item('Upgrades', 'The team row sells Link Amplifier (more beam damage) and Link Range (longer beam).'),
    para(`The beam is disabled in ${t.names.versus}.`),
  ]);
}

function comboPage(t: ThemeDef): ManualPageVM {
  const tiers: ManualBlockVM[] = [];
  for (let i = 0; i < COMBO.TIERS.length; i++) {
    tiers.push(
      item(
        `${COMBO.TIERS[i]} kills`,
        `Score ×${COMBO.SCORE_MUL[i + 1]}, +${pctText(COMBO.SHARD_BONUS[i + 1] ?? 0)} ${t.names.runCurrency}`,
      ),
    );
  }
  return page('combos', 'Combos & Sync Kills', [
    para(
      `Each kill within ${COMBO.WINDOW} s of your previous kill extends your combo chain (the bar under your HUD panel shows the time left).`,
    ),
    hd('Combo tiers'),
    ...tiers,
    item('Getting hit', `Taking damage keeps only ${pctText(COMBO.HIT_KEEP)} of your chain.`),
    hd('Sync kills'),
    para(
      `In ${t.names.coop}, when both players score a kill within ${COOP.SYNC_WINDOW} s of each other, each gets +${COOP.SYNC_SHARDS} ${t.names.runCurrency} and +${COOP.SYNC_OVERDRIVE} special charge. The HUD flashes SYNC KILL.`,
    ),
  ]);
}

function patchBayPage(t: ThemeDef): ManualPageVM {
  const n = t.names;
  return page('patchBay', `${n.runCurrency} & the ${n.shop}`, [
    item(
      n.runCurrency,
      `Enemies drop ${n.runCurrency} pickups. Your magnet (${PICKUPS.MAGNET_BASE} u to start) pulls them in; uncollected ones blink and vanish after ${PICKUPS.DESPAWN_AT} s. Each player has their own wallet.`,
    ),
    item(
      'Catch-up',
      `A player whose wallet is below ${pctText(PICKUPS.CATCHUP_RATIO)} of their partner’s gets +${pctText(PICKUPS.CATCHUP_BONUS)} from pickups.`,
    ),
    item(
      `${n.wave} clear`,
      `Clearing a ${n.wave.toLowerCase()} vacuums every pickup to the nearest player and pays a clear bonus that grows each ${n.wave.toLowerCase()}.`,
    ),
    hd(`The ${n.shop}`),
    para(
      `After every ${n.wave.toLowerCase()} the ${n.shop} opens with one panel per player. Every row shows what it does, and upgrades show what the next level adds. The INSTALLED list shows what you own.`,
    ),
    item(
      'Systems',
      `Eight stat rows you can level up at any visit; prices rise per level and per ${n.wave.toLowerCase()}.`,
    ),
    item('Repair', 'Heal part of your max HP.'),
    item(
      'Patch cards',
      'Three random cards per visit with special effects. Rarer cards appear in later sectors.',
    ),
    item('Lock', 'Keep one card for your next visit at the same price (move right on a card row).'),
    item(
      'Team row',
      `Shared items either player can pay for: ${n.lives}, Link Amplifier, Link Range, Revive Protocol.`,
    ),
    item('Reroll / Gift', `Draw new cards; send ${n.runCurrency} to your partner.`),
    item(
      'Keys',
      `Fire buys, Dash undoes (full refund), Special toggles READY. The next ${n.wave.toLowerCase()} starts when everyone is READY.`,
    ),
    para('The next pages list every powerup.'),
  ]);
}

function revivePage(t: ThemeDef): ManualPageVM {
  const n = t.names;
  return page('revive', `Downed, Revive & ${n.lives}`, [
    item(
      'Downed',
      `At 0 HP you are DOWNED: you can crawl slowly and a bleed-out timer starts (${COOP.BLEED_OUT} s, shorter each time you go down in the same ${n.wave.toLowerCase()}).`,
    ),
    item(
      'Revive',
      `Your partner revives you by staying within ${COOP.REVIVE_RADIUS} u of you for ${trimNum(COOP.REVIVE_TIME)} s. You come back with ${pctText(COOP.REVIVE_HP_FRAC)} HP and brief invulnerability. Progress slowly decays if they step away.`,
    ),
    item(
      n.lives,
      `If you bleed out, or everyone is down, a ${n.lives.replace(/s$/, '')} is spent automatically to reboot a player. The team starts with ${COOP.START_KERNELS} and can hold ${COOP.MAX_KERNELS}; buy more in the team row.`,
    ),
    item(
      'Offline ghost',
      `Bled out with no ${n.lives} left? You become an OFFLINE ghost: you still fly around, collect ${n.runCurrency} at ${pctText(COOP.OFFLINE_COLLECT_MUL)} and touching enemies MARKS them (+${pctText(COOP.MARK_BONUS)} damage taken for ${COOP.MARK_DURATION} s).`,
    ),
    item(
      `${n.wave}-end reboot`,
      `When the ${n.wave.toLowerCase()} is cleared, downed players return at ${pctText(COOP.REBOOT_DOWNED_HP)} HP and offline players at ${pctText(COOP.REBOOT_OFFLINE_HP)} HP.`,
    ),
    item('Game over', `The run ends only when nobody is left standing and no ${n.lives} remain.`),
  ]);
}

function versusPage(t: ThemeDef): ManualPageVM {
  const n = t.names;
  return page('versus', `${n.versus} Mode`, [
    para(
      `Once Player 2 joins, set the MODE row at character select to ${n.versus}. First to ${VERSUS.ROUNDS_TO_WIN} round wins takes the match.`,
    ),
    item(
      'Rounds',
      `Up to ${VERSUS.ROUND_TIME} s. Knock your rival down to win the round; there is no revive.`,
    ),
    item(
      'Timeout',
      `The player with the higher HP fraction wins. An exact tie starts SUDDEN DEATH: both drop to ${VERSUS.SUDDEN_DEATH_HP} HP for up to ${VERSUS.SUDDEN_DEATH_TIME} s.`,
    ),
    item(
      'PvP damage',
      `Your shots hit your rival for ${pctText(VERSUS.PVP_DAMAGE_MUL)} damage; damaging specials for ${pctText(VERSUS.PVP_SPECIAL_DAMAGE_MUL)}. Dash i-frames work against shots too.`,
    ),
    item('Hazards', 'Weaker enemy waves roam the arena and chase the nearest player. No bosses.'),
    item(
      'Shop',
      `The ${n.shop} opens between rounds (no team row, no gift). Winner +${VERSUS.ROUND_WIN_SHARDS}, loser +${VERSUS.ROUND_LOSS_SHARDS} ${n.runCurrency} (catch-up), draw +${VERSUS.ROUND_DRAW_SHARDS} each.`,
    ),
    item('Disabled', `Link Beam, revive, ${n.lives}, Offline ghost and sync kills.`),
    item(
      n.metaCurrency,
      `${VERSUS.CORES_PER_ROUND_WIN} per round won (either player) + ${VERSUS.CORES_MATCH_WIN} for a decided match, up to ${VERSUS.CORES_CAP} per match.`,
    ),
  ]);
}

function signedPct(mul: number): string {
  const d = Math.round((mul - 1) * 100);
  return d === 0 ? 'normal' : `${d > 0 ? '+' : ''}${d}%`;
}

function difficultyLine(d: DifficultyDef): string {
  return `Enemy speed ${signedPct(d.speed)}, enemy count ${signedPct(d.budget)}, damage to you ${signedPct(d.damage)}, enemy HP ${signedPct(d.hp)}.`;
}

function difficultyPage(t: ThemeDef): ManualPageVM {
  return page('difficulty', 'Difficulty', [
    para(
      'Pick a difficulty in SETTINGS before a run (character select shows the current one). It changes how hard the arena hits, never the rules.',
    ),
    item('CASUAL', `${difficultyLine(DIFFICULTY.casual)} Best for learning the game or relaxed co-op.`),
    item('NORMAL', 'The intended balance (the default).'),
    item(
      'HARD',
      `${difficultyLine(DIFFICULTY.hard)} Close to the original release; for players who know every pattern.`,
    ),
    para(
      `The difficulty in effect when a run starts stays for the whole run. ${t.names.metaCurrency} rewards are the same on every difficulty.`,
    ),
  ]);
}

const THEME_LOOKS: Readonly<Record<ThemeDef['id'], string>> = {
  kernelPanic: 'Neon circuit grid inside a crashing server; dark synthwave.',
  abyssalLight:
    'Caustic-lit seabed in a lightless trench, dense dark water; slow, tense drones and sonar pings.',
  emberfall: 'Cracked lava crust under a dying red giant, heat shimmer; hard industrial percussion.',
};

function themesPage(): ManualPageVM {
  const blocks: ManualBlockVM[] = [
    para(
      'Three themes change the look, music and names, never the rules: every craft, enemy, card and number is the same. Pick one in SETTINGS > THEME, then choose RESTART TO APPLY (the game reloads; progress is kept).',
    ),
  ];
  for (const t of Object.values(THEMES)) {
    const n = t.names;
    blocks.push(item(t.title, `${THEME_LOOKS[t.id]} Currencies: ${n.runCurrency} and ${n.metaCurrency}.`));
  }
  return page('themes', 'Themes', blocks);
}

function tipsPage(t: ThemeDef): ManualPageVM {
  const n = t.names;
  return page('tips', 'Tips', [
    item(
      'Keep moving',
      'Most damage comes from standing still. Circle the arena and leave yourself an exit.',
    ),
    item(
      'Dash through, not away',
      'Dashing through a bullet wall or a Dart lunge is safer than running from it.',
    ),
    item('Watch the rings', 'Every spawn shows a warning ring at a portal about a second ahead.'),
    item('Flank Wardens', 'Their front shield blocks shots: get behind or beside them.'),
    item('Pop Forks away from you', 'They split into small, fast Shards.'),
    item('Use the beam', `In ${n.coop} the Link Beam shreds crowds; keep your partner at medium range.`),
    item(
      'Buy early damage',
      `Payload, Overclock and a good card in the first visits make every later ${n.wave.toLowerCase()} easier.`,
    ),
    item('Save a revive', `Keep a ${n.lives.replace(/s$/, '')} for the boss ${n.wave.toLowerCase()}s.`),
    item(
      'Laptop keyboards',
      'If a key drops out when both players hold keys, run CONTROLS > KEY TEST and rebind.',
    ),
    item('Stuck?', `Spend ${n.metaCurrency} on ${n.meta} between runs; every run pays out.`),
  ]);
}

/** Every HOW TO PLAY page in order (rules pages, then the reference pages, then versus/difficulty/tips). */
export function buildManualPages(theme: ThemeDef, bindings: Bindings): readonly ManualPageVM[] {
  const ref = referencePages(theme);
  return [
    goalPage(theme),
    controlsPage(bindings),
    basicsPage(theme),
    linkPage(theme),
    comboPage(theme),
    patchBayPage(theme),
    ...ref.powerups,
    revivePage(theme),
    ...ref.world,
    versusPage(theme),
    difficultyPage(theme),
    themesPage(),
    tipsPage(theme),
  ];
}

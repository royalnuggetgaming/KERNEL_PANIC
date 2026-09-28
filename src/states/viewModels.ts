/**
 * Pure view-model builders for every screen (HUD and Patch Bay live in hudViewModel.ts / shopViewModel.ts and
 * are re-exported here). VMs carry display-ready strings: ui/ never reads config or themes.
 */
import { VEHICLE_IDS, type PlayerIndex, type RunMode, type VehicleId } from '../contracts/ids';
import type { RunSummary } from '../contracts/run';
import type { SaveDataV1 } from '../contracts/save';
import type { ThemeDef } from '../contracts/theme';
import type {
  CharacterSelectVM,
  CoresLineVM,
  GameOverPlayerVM,
  GameOverVM,
  HangarItemVM,
  HangarVM,
  MenuItemVM,
  SelectSlotVM,
  StatBarVM,
} from '../contracts/ui';
import { keyLabel } from '../config/keys';
import { META_UPGRADES, VEHICLE_UNLOCKS, metaLevel } from '../config/metaCatalog';
import { VEHICLES } from '../config/vehicles';
import { isVehicleUnlocked, respecRefund } from '../upgrades/MetaShop';
import { metaPrice } from '../upgrades/pricing';
import type { RewardBreakdown, RewardLineId } from '../upgrades/rewards';
import { clockText } from './hudViewModel';
import { metaDesc, metaNext } from './powerupText';

export { buildHudVM } from './hudViewModel';
export { buildShopVM } from './shopViewModel';

// ---------------------------------------------------------------- character select

export type SelectRow = 'vehicle' | 'mode';

/** CharacterSelect state as the VM builder sees it (the state keeps a mutable copy). */
export interface CharacterSelectModel {
  readonly joined: readonly [boolean, boolean];
  readonly picks: readonly [VehicleId, VehicleId];
  readonly ready: readonly [boolean, boolean];
  readonly cursorRows: readonly [SelectRow, SelectRow];
  /** Chosen two-player mode; the effective mode is 'solo' while P2 is absent. */
  readonly mode: 'coop' | 'versus';
  /** Seconds left in the 0.6 s start countdown, or null. */
  readonly countdown: number | null;
  readonly message: string;
}

export function effectiveMode(m: CharacterSelectModel): RunMode {
  return m.joined[1] ? m.mode : 'solo';
}

function vehicleDps(v: VehicleId): number {
  const w = VEHICLES[v].weapon;
  return w.fireRate * w.damage * w.projectiles;
}

const MAX_HP = Math.max(...VEHICLE_IDS.map((v) => VEHICLES[v].maxHp));
const MAX_SPEED = Math.max(...VEHICLE_IDS.map((v) => VEHICLES[v].moveSpeed));
const MAX_DPS = Math.max(...VEHICLE_IDS.map(vehicleDps));

export function vehicleStatBars(v: VehicleId): StatBarVM[] {
  const d = VEHICLES[v];
  const dps = vehicleDps(v);
  return [
    { label: 'HULL', fraction: d.maxHp / MAX_HP, value: String(d.maxHp) },
    { label: 'SPEED', fraction: d.moveSpeed / MAX_SPEED, value: `${d.moveSpeed} u/s` },
    { label: 'FIREPOWER', fraction: dps / MAX_DPS, value: `${Math.round(dps)} dps` },
    { label: 'DASH', fraction: d.dashCharges / 2, value: `${d.dashCharges}x` },
  ];
}

export function buildCharacterSelectVM(
  input: CharacterSelectModel,
  save: SaveDataV1,
  theme: ThemeDef,
): CharacterSelectVM {
  const n = theme.names;
  const mode = effectiveMode(input);
  const slot = (p: PlayerIndex): SelectSlotVM => {
    const v = input.picks[p];
    const locked = !isVehicleUnlocked(save, v);
    const fire = save.bindings.players[p].fire[0];
    return {
      player: p,
      joined: input.joined[p],
      vehicle: v,
      vehicleName: n.vehicles[v],
      blurb: n.vehicleBlurbs[v],
      specialName: n.specials[VEHICLES[v].special],
      locked,
      unlockPrice: locked ? VEHICLES[v].unlockCost : null,
      ready: input.ready[p],
      stats: vehicleStatBars(v),
      cursorRow: input.joined[1] ? input.cursorRows[p] : 'vehicle',
      joinHint: fire === undefined ? 'PRESS FIRE TO JOIN' : `PRESS ${keyLabel(fire)} TO JOIN`,
    };
  };
  return {
    slots: [slot(0), slot(1)],
    mode,
    modeRowVisible: input.joined[1],
    modeLabel: mode === 'versus' ? n.versus : mode === 'coop' ? n.coop : 'SOLO',
    countdown: input.countdown,
    cores: save.cores,
    metaCurrency: n.metaCurrency,
    message: input.message,
  };
}

// ---------------------------------------------------------------- hangar

export const RESPEC_ITEM = 'respec';
export const META_ITEM_PREFIX = 'meta:';
export const UNLOCK_ITEM_PREFIX = 'unlock:';

export function buildHangarVM(save: SaveDataV1, cursor: number, theme: ThemeDef, message: string): HangarVM {
  const n = theme.names;
  const items: HangarItemVM[] = [];
  for (const def of META_UPGRADES) {
    const level = metaLevel(save.meta, def.id);
    const price = metaPrice(def.id, level);
    items.push({
      id: META_ITEM_PREFIX + def.id,
      kind: 'meta',
      label: def.label.toUpperCase(),
      blurb: metaDesc(def.id, n.runCurrency),
      next: metaNext(def.id, level, n.runCurrency),
      level,
      maxLevel: def.prices.length,
      price,
      status: price === null ? 'maxed' : save.cores >= price ? 'available' : 'unaffordable',
    });
  }
  for (const v of VEHICLE_IDS) {
    if (v !== 'specter' && v !== 'tinker') continue;
    const owned = isVehicleUnlocked(save, v);
    const price = VEHICLE_UNLOCKS[v];
    items.push({
      id: UNLOCK_ITEM_PREFIX + v,
      kind: 'unlock',
      label: `UNLOCK ${n.vehicles[v]}`,
      blurb: n.vehicleBlurbs[v],
      next: owned ? 'Unlocked: pick it in character select' : `Special: ${n.specials[VEHICLES[v].special]}`,
      level: owned ? 1 : 0,
      maxLevel: 0,
      price: owned ? null : price,
      status: owned ? 'owned' : save.cores >= price ? 'available' : 'unaffordable',
    });
  }
  const refund = respecRefund(save);
  let anyLevel = false;
  for (const def of META_UPGRADES) if (metaLevel(save.meta, def.id) > 0) anyLevel = true;
  items.push({
    id: RESPEC_ITEM,
    kind: 'respec',
    label: 'RESPEC',
    blurb: `Reset all ${n.meta} and refund the ${n.metaCurrency} spent (unlocks stay).`,
    next: '',
    level: 0,
    maxLevel: 0,
    price: refund,
    status: refund > 0 || anyLevel ? 'available' : 'unavailable',
  });
  return {
    title: n.meta.toUpperCase(),
    metaCurrency: n.metaCurrency,
    cores: save.cores,
    items,
    cursor: Math.min(Math.max(0, cursor), items.length - 1),
    respecRefund: refund,
    message,
    readOnly: false,
  };
}

// ---------------------------------------------------------------- game over

export const GAME_OVER_ITEMS: readonly MenuItemVM[] = [
  { id: 'retry', label: 'RETRY', enabled: true, hint: 'Same daemons, same mode' },
  { id: 'menu', label: 'MAIN MENU', enabled: true, hint: 'Back to the main menu' },
];

function lineLabel(id: RewardLineId, theme: ThemeDef): string {
  const n = theme.names;
  switch (id) {
    case 'shards':
      return `${n.runCurrency} earned`;
    case 'waves':
      return `${n.wave}s cleared`;
    case 'bosses':
      return 'Bosses purged';
    case 'victory':
      return 'Victory bonus';
    case 'rounds':
      return 'Rounds won';
    case 'matchWin':
      return 'Match decided';
  }
}

function titles(summary: RunSummary, theme: ThemeDef): { title: string; subtitle: string } {
  const n = theme.names;
  if (summary.mode === 'versus') {
    const score = `${summary.roundWins[0]} : ${summary.roundWins[1]}`;
    if (summary.outcome === 'abandoned') return { title: 'MATCH ABANDONED', subtitle: score };
    return { title: `${n.versus} COMPLETE`, subtitle: `ROUNDS ${score}` };
  }
  const reached = `${n.wave.toUpperCase()} ${summary.waveReached}`;
  switch (summary.outcome) {
    case 'victory':
      return {
        title: `${n.extract} COMPLETE`,
        subtitle: summary.waveReached > 15 ? `${n.overflow} survived to ${reached}` : 'The kernel is safe.',
      };
    case 'defeat':
      return { title: 'SYSTEM FAILURE', subtitle: `Purged at ${reached}` };
    case 'abandoned':
      return { title: 'PROCESS ABANDONED', subtitle: `Left at ${reached}` };
  }
}

export function buildGameOverVM(
  summary: RunSummary,
  rewards: RewardBreakdown,
  theme: ThemeDef,
  cursor: number,
  newBest: boolean,
): GameOverVM {
  const n = theme.names;
  const versus = summary.mode === 'versus';
  const winner = versus && summary.outcome !== 'abandoned' ? summary.winner : null;
  const players: GameOverPlayerVM[] = summary.players.map((p) => ({
    player: p.player,
    name: p.player === 0 ? 'P1' : 'P2',
    vehicleName: n.vehicles[p.vehicle],
    score: p.score,
    kills: p.kills,
    damage: Math.round(p.damage),
    shards: p.shards,
    revives: p.revives,
    bestCombo: p.bestCombo,
    roundWins: p.roundWins,
    mvp: !versus && summary.players.length > 1 && summary.mvp === p.player,
    winner: winner === p.player,
  }));
  const cores: CoresLineVM[] = rewards.lines.map((l) => ({
    label: lineLabel(l.id, theme),
    amount: l.amount,
  }));
  const t = titles(summary, theme);
  return {
    outcome: summary.outcome,
    mode: summary.mode,
    title: t.title,
    subtitle: t.subtitle,
    winner,
    players,
    waveReached: summary.waveReached,
    duration: clockText(summary.durationS),
    cores,
    coresTotal: rewards.total,
    coresCapped: rewards.capped,
    metaCurrency: n.metaCurrency,
    newBest,
    items: GAME_OVER_ITEMS,
    cursor: Math.min(Math.max(0, cursor), GAME_OVER_ITEMS.length - 1),
  };
}

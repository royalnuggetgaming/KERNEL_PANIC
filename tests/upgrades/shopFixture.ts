/** Builders for ShopModel tests. */
import { CARD_IDS, type CardId, type PlayerIndex, type VehicleId } from '../../src/contracts/ids';
import type { PlayerRunState, PurchaseResult, ShopTx, TeamState } from '../../src/contracts/upgrades';
import { cardDef } from '../../src/config/cards';
import { createRng } from '../../src/core/rng';
import { createShopModel, type ShopModel, type ShopModelInit } from '../../src/upgrades/ShopModel';
import { computeStats, emptyRowLevels, emptyTeamLevels } from '../../src/upgrades/stats';

export function stacks(s: Partial<Record<CardId, number>> = {}): Uint8Array {
  const out = new Uint8Array(CARD_IDS.length);
  for (const [id, n] of Object.entries(s)) out[cardDef(id as CardId).bit] = n;
  return out;
}

export function player(vehicle: VehicleId, patch: Partial<PlayerRunState> = {}): PlayerRunState {
  const rows = patch.rows ?? emptyRowLevels();
  const cards = patch.cards ?? stacks();
  const maxHp = computeStats(vehicle, {}, rows, cards, emptyTeamLevels()).maxHp;
  return { wallet: 1000, hp: maxHp, maxHp, rows, cards, repairsThisVisit: 0, ...patch };
}

export function team(patch: Partial<TeamState> = {}): TeamState {
  return {
    kernels: 1,
    kernelsBoughtThisRun: 0,
    levels: emptyTeamLevels(),
    boughtThisVisit: emptyTeamLevels(),
    ...patch,
  };
}

export interface ShopSetup extends Omit<Partial<ShopModelInit>, 'players'> {
  readonly p0?: Partial<PlayerRunState>;
  readonly p1?: Partial<PlayerRunState>;
  /** Skip the 350 ms open guard (default true). */
  readonly skipGuard?: boolean;
  readonly seed?: number;
}

export function makeShop(setup: ShopSetup = {}): ShopModel {
  const mode = setup.mode ?? 'coop';
  const vehicles = setup.vehicles ?? (['lancer', 'bulwark'] as const);
  const joined = setup.joined ?? ([true, mode !== 'solo'] as const);
  const init: ShopModelInit = {
    mode,
    wave: setup.wave ?? 1,
    visit: setup.visit ?? 1,
    round: setup.round ?? 0,
    finalVisit: setup.finalVisit ?? false,
    joined,
    vehicles,
    players: [player(vehicles[0], setup.p0), player(vehicles[1], setup.p1)],
    team: setup.team ?? team(),
    meta: setup.meta ?? {},
    locked: setup.locked ?? [null, null],
    rng: setup.rng ?? createRng(setup.seed ?? 42),
    ...(setup.caps !== undefined ? { caps: setup.caps } : {}),
  };
  const shop = createShopModel(init);
  if (setup.skipGuard !== false) shop.update(400);
  return shop;
}

export function expectFail(r: PurchaseResult): string {
  if (r.ok) throw new Error(`expected failure, got success at price ${r.price}`);
  return r.reason;
}

export function expectOk(r: PurchaseResult): { price: number; balance: number; txId: number } {
  if (!r.ok) throw new Error(`expected success, got ${r.reason}`);
  return r;
}

export function wallet(shop: ShopModel, p: PlayerIndex): number {
  return shop.snapshot().players[p].wallet;
}

export const tx = {
  row: (player: PlayerIndex, id: Extract<ShopTx, { kind: 'buyRow' }>['id']): ShopTx => ({
    kind: 'buyRow',
    player,
    id,
  }),
  card: (player: PlayerIndex, slot: 0 | 1 | 2): ShopTx => ({ kind: 'buyCard', player, slot }),
  team: (player: PlayerIndex, id: Extract<ShopTx, { kind: 'buyTeam' }>['id']): ShopTx => ({
    kind: 'buyTeam',
    player,
    id,
  }),
  repair: (player: PlayerIndex): ShopTx => ({ kind: 'repair', player }),
  reroll: (player: PlayerIndex): ShopTx => ({ kind: 'reroll', player }),
  undo: (player: PlayerIndex): ShopTx => ({ kind: 'undo', player }),
  ready: (player: PlayerIndex): ShopTx => ({ kind: 'toggleReady', player }),
  lock: (player: PlayerIndex, slot: 0 | 1 | 2): ShopTx => ({ kind: 'lock', player, slot }),
  gift: (player: PlayerIndex): ShopTx => ({ kind: 'gift', player }),
};

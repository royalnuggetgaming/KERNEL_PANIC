/**
 * RunSession: owns one run's World plus the per-player economy (PlayerRunState), the team stock and the card
 * locks. It is the only sim module that knows about upgrades: computeStats at run start (vehicle base +
 * Firmware snapshot), a ShopModel behind openShop(), and stats recomputed on applyShopResults().
 */
import type { Logger, PlayerIndex, RunOutcome } from '../contracts/ids';
import type { Intents } from '../contracts/input';
import type {
  PlayerLoadout,
  RunConfig,
  RunFlags,
  RunSessionApi,
  RunSummary,
  ShopApi,
} from '../contracts/run';
import type { DerivedStats, FinalChoice, PlayerRunState, TeamState } from '../contracts/upgrades';
import type { WorldState } from '../contracts/world';
import { invariant } from '../core/assert';
import { ARENA, SIM } from '../config/tuning';
import { WAVES } from '../config/waves';
import { clearEnemies } from '../entities/enemies';
import { applyPlayerStats } from '../entities/players';
import type { LockedCard } from '../upgrades/offers';
import { createShopModel, type ShopModel, type ShopResults } from '../upgrades/ShopModel';
import { computeStats } from '../upgrades/stats';
import { createWorld } from './createWorld';
import { beginWave } from './rules';
import {
  buildWorldConfig,
  cardMaskOf,
  clonePlayer,
  cloneTeam,
  createPlayerRunState,
  createTeamState,
  runCheats,
  startCards,
  vehiclesOf,
} from './runSetup';
import { buildRunSummary } from './runSummary';
import { clearSimEvents } from './simEventChannels';
import { stepWorld } from './stepWorld';
import { beginVersusRound } from './versusRules';
import { clearBoss } from './worldRecords';

export interface RunSessionDeps {
  readonly log: Logger;
}

/** RunSessionApi plus read access for tests, the debug API and balancing tools. */
export interface RunSession extends RunSessionApi {
  /** The mutable world (the sim owns it; presentation uses `world`). */
  readonly state: WorldState;
  /** Shop visits opened so far. */
  readonly visit: number;
  /** The open shop visit, null between visits. */
  readonly shop: ShopModel | null;
  /** The final visit's choice (EXTRACT / PUSH DEEPER) once applied, else null. */
  readonly finalChoice: FinalChoice | null;
  readonly disposed: boolean;
  /** Copy of a player's economy state (rows, cards; wallet/hp are synced from the world at openShop). */
  economy(p: PlayerIndex): PlayerRunState;
  /** Copy of the team stock (kernels synced from the world at openShop). */
  team(): TeamState;
  /** Installed powerups of one player (live during an open visit); always present on the concrete session. */
  loadout(p: PlayerIndex): PlayerLoadout;
}

function isJoined(w: WorldState, p: PlayerIndex): boolean {
  return w.players[p].life !== 'absent';
}

/** Sets stats without touching hp through the max-HP delta (hp was already set by the caller). */
function setStatsKeepingHp(w: WorldState, p: PlayerIndex, stats: DerivedStats, hp: number): void {
  const pl = w.players[p];
  pl.stats.maxHp = stats.maxHp;
  pl.hp = hp;
  applyPlayerStats(pl, stats);
}

export function createRunSession(config: RunConfig, deps: RunSessionDeps): RunSession {
  const worldConfig = buildWorldConfig(config);
  const w = createWorld(worldConfig);
  const log = deps.log;
  const vehicles = vehiclesOf(config);
  const meta = { ...config.meta };
  const cheats = runCheats(config);
  const cheatIds = cheats.any && config.cheats !== undefined ? [...config.cheats] : [];
  const economy: [PlayerRunState, PlayerRunState] = [
    createPlayerRunState(true, w.run.wallets[0], w.players[0].stats.maxHp),
    createPlayerRunState(isJoined(w, 1), w.run.wallets[1], w.players[1].stats.maxHp),
  ];
  if (cheats.startCards.length > 0) {
    // Cheat starting cards (SUDORMRF): owned from tick 0 in both the economy and the world.
    const cards = startCards(cheats);
    for (let i = 0; i < 2; i++) {
      const p: PlayerIndex = i === 0 ? 0 : 1;
      if (!isJoined(w, p)) continue;
      economy[p].cards.set(cards);
      w.players[p].cardStacks.set(cards.subarray(0, w.players[p].cardStacks.length));
      w.players[p].cardMask = cardMaskOf(w.players[p].cardStacks);
    }
  }
  let team = createTeamState(w.run.spareKernels);
  let locked: [LockedCard | null, LockedCard | null] = [null, null];
  let visit = 0;
  let shop: ShopModel | null = null;
  let finalChoice: FinalChoice | null = null;
  let disposed = false;
  const versus = config.mode === 'versus';

  const alive = (what: string): void => {
    invariant(!disposed, `RunSession.${what}: the session was disposed`);
  };

  /** Copies the world's wallets/hp/kernels into the economy state before a visit. */
  const syncEconomyFromWorld = (): void => {
    for (let i = 0; i < 2; i++) {
      const p: PlayerIndex = i === 0 ? 0 : 1;
      const e = economy[p];
      const pl = w.players[p];
      e.wallet = w.run.wallets[p];
      e.maxHp = pl.stats.maxHp;
      // Versus rounds restart at full HP, so a repair can never be wasted on an eliminated player.
      e.hp = !isJoined(w, p) ? 0 : versus ? pl.stats.maxHp : Math.max(0, pl.hp);
      e.repairsThisVisit = 0;
    }
    if (!versus) team.kernels = w.run.spareKernels;
  };

  const applyResults = (res: ShopResults): void => {
    team = cloneTeam(res.team);
    for (let i = 0; i < 2; i++) {
      const p: PlayerIndex = i === 0 ? 0 : 1;
      const r = res.players[p];
      economy[p] = clonePlayer(r);
      if (!isJoined(w, p)) continue;
      w.run.wallets[p] = r.wallet;
      const stats = computeStats(
        vehicles[p],
        meta,
        r.rows,
        r.cards,
        team.levels,
        cheats.caps,
        cheats.modifiers,
      );
      const pl = w.players[p];
      pl.cardStacks.set(r.cards.subarray(0, pl.cardStacks.length));
      pl.cardMask = cardMaskOf(pl.cardStacks);
      // The shop already healed by every max-HP delta (Plating, Glass Lens) and applied repairs.
      const hp = pl.life === 'alive' || versus ? Math.min(r.hp, stats.maxHp) : pl.hp;
      setStatsKeepingHp(w, p, stats, hp);
      economy[p].maxHp = stats.maxHp;
    }
    if (!versus) w.run.spareKernels = team.kernels;
    locked = [res.locked[0], res.locked[1]];
    if (res.choice !== null) finalChoice = res.choice;
  };

  const session: RunSession = {
    config,
    world: w,
    state: w,
    get flags(): RunFlags {
      return w.flags;
    },
    get visit(): number {
      return visit;
    },
    get shop(): ShopModel | null {
      return shop;
    },
    get finalChoice(): FinalChoice | null {
      return finalChoice;
    },
    get disposed(): boolean {
      return disposed;
    },

    tick(intents: Intents): void {
      alive('tick');
      stepWorld(w, intents, SIM.DT);
    },

    openShop(): ShopApi {
      alive('openShop');
      if (shop !== null) {
        log.warn('RunSession.openShop: a visit is already open; returning it');
        return shop;
      }
      if (!w.flags.waveClearReady && !w.flags.roundOver) {
        log.warn('RunSession.openShop: opened outside a wave clear / round end', { phase: w.run.phase });
      }
      syncEconomyFromWorld();
      visit++;
      shop = createShopModel({
        mode: config.mode,
        wave: Math.max(1, w.run.wave),
        visit,
        round: versus ? w.run.round : 0,
        finalVisit: w.flags.finalVisit,
        joined: [true, isJoined(w, 1)],
        vehicles,
        players: economy,
        team,
        meta,
        locked,
        rng: w.rng.shop,
        ...(cheats.caps !== undefined ? { caps: cheats.caps } : {}),
        ...(cheats.any ? { extraMods: cheats.modifiers } : {}),
      });
      return shop;
    },

    applyShopResults(): void {
      alive('applyShopResults');
      if (shop === null) {
        log.warn('RunSession.applyShopResults: no open shop visit');
        return;
      }
      const res = shop.results();
      shop = null;
      applyResults(res);
    },

    beginNextWave(): void {
      alive('beginNextWave');
      if (shop !== null) {
        log.warn('RunSession.beginNextWave: applying the open shop visit first');
        session.applyShopResults();
      }
      if (versus) {
        if (w.flags.matchOver || w.run.matchWinner !== -1) {
          log.warn('RunSession.beginNextWave: the versus match is over');
          return;
        }
        beginVersusRound(w, w.run.round + 1);
        return;
      }
      if (w.flags.defeat) {
        log.warn('RunSession.beginNextWave: the run was lost');
        return;
      }
      if (w.run.wave >= WAVES.TOTAL && finalChoice === 'extract') {
        log.warn('RunSession.beginNextWave: EXTRACT was chosen; the run is over');
        return;
      }
      beginWave(w, w.run.wave + 1);
    },

    clearEvents(): void {
      clearSimEvents(w.events);
    },

    setViewRect(minX: number, maxX: number, minZ: number, maxZ: number): void {
      if (!Number.isFinite(minX + maxX + minZ + maxZ)) return;
      const r = w.viewRect;
      const lim = ARENA.RADIUS * 4;
      r.minX = Math.max(-lim, Math.min(minX, maxX));
      r.maxX = Math.min(lim, Math.max(minX, maxX));
      r.minZ = Math.max(-lim, Math.min(minZ, maxZ));
      r.maxZ = Math.min(lim, Math.max(minZ, maxZ));
    },

    summary(outcome: RunOutcome): RunSummary {
      return buildRunSummary(w, config, outcome);
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      shop = null;
      clearEnemies(w);
      w.playerShots.clear();
      w.enemyShots.clear();
      w.pickups.clear();
      w.lasers.clear();
      w.deathQueue.clear();
      for (let i = 0; i < w.bosses.length; i++) clearBoss(w.bosses[i]!);
      w.link.active = false;
      w.link.droneActive = false;
      w.link.latchedCount = 0;
      w.grid.begin();
      w.grid.build();
      clearSimEvents(w.events);
    },

    economy(p: PlayerIndex): PlayerRunState {
      return clonePlayer(economy[p]);
    },
    team(): TeamState {
      return cloneTeam(team);
    },
    loadout(p: PlayerIndex): PlayerLoadout {
      // During a visit the open shop holds the live purchases; otherwise the committed economy does.
      const res = shop === null ? null : shop.results();
      const e = res === null ? economy[p] : res.players[p];
      const t = res === null ? team : res.team;
      const kernels = versus ? 0 : res === null ? w.run.spareKernels : t.kernels;
      const teamLevels = { ...t.levels, spareKernel: kernels };
      return { rows: { ...e.rows }, cards: e.cards.slice(), team: teamLevels, meta, cheats: cheatIds };
    },
  };
  return session;
}

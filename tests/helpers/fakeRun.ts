/** FakeRunSession / FakeShop: scriptable RunSessionApi and ShopApi backed by a real test world. */
import { PLAYER_INDICES, STAT_ROW_IDS, TEAM_ITEM_IDS, type RunOutcome } from '../../src/contracts/ids';
import type { Intents } from '../../src/contracts/input';
import type {
  RunConfig,
  RunFlags,
  RunSessionApi,
  RunSummary,
  ShopApi,
  ShopPlayerSnapshot,
  ShopVisitSnapshot,
} from '../../src/contracts/run';
import type { FinalChoice, PurchaseResult, ShopTx } from '../../src/contracts/upgrades';
import type { WorldState } from '../../src/contracts/world';
import { createTestWorld } from './worldFixture';
import { CallRecorder } from './callRecorder';

export class FakeShop implements ShopApi {
  readonly rec = new CallRecorder();
  readonly txs: ShopTx[] = [];
  allReady = false;
  countdownDone = false;
  finalVisit = false;
  choice: FinalChoice | null = null;
  committed = false;
  /** Result returned by apply() (default: success at price 10). */
  nextResult: PurchaseResult = { ok: true, price: 10, balance: 0, txId: 1 };

  private readonly world: WorldState;

  constructor(world: WorldState) {
    this.world = world;
  }

  apply(tx: ShopTx): PurchaseResult {
    this.txs.push(tx);
    this.rec.record('apply', tx);
    if (tx.kind === 'choose') this.choice = tx.choice;
    return this.nextResult;
  }
  update(frameDtMs: number): void {
    this.rec.record('update', frameDtMs);
  }
  snapshot(): ShopVisitSnapshot {
    const w = this.world;
    const mode = w.run.mode;
    const player = (i: 0 | 1): ShopPlayerSnapshot => ({
      player: i,
      joined: w.players[i].life !== 'absent',
      vehicle: w.players[i].vehicle,
      wallet: w.run.wallets[i],
      hp: w.players[i].hp,
      maxHp: w.players[i].stats.maxHp,
      rows: STAT_ROW_IDS.map((id) => ({
        id,
        level: 0,
        maxLevel: 5,
        price: 30,
        status: 'available' as const,
      })),
      repair: { price: 19, status: 'available', boughtThisVisit: 0 },
      cards: [0, 1, 2].map((slot) => ({
        slot: slot as 0 | 1 | 2,
        id: 'pierce' as const,
        rarity: 'U' as const,
        price: 75,
        status: 'available' as const,
        locked: false,
      })),
      team: TEAM_ITEM_IDS.map((id) => ({
        id,
        level: 0,
        maxLevel: 3,
        price: 90,
        status: mode === 'versus' ? ('unavailable' as const) : ('available' as const),
      })),
      reroll: { price: 5, freeLeft: 0 },
      gift: { amount: 10, status: mode === 'coop' ? 'available' : 'unavailable' },
      ready: false,
      canUndo: false,
      lastResult: null,
    });
    return {
      mode,
      wave: w.run.wave,
      visit: w.run.wave,
      round: w.run.round,
      finalVisit: this.finalVisit,
      teamVisible: mode !== 'versus',
      giftVisible: mode === 'coop',
      kernels: w.run.spareKernels,
      players: [player(0), player(1)],
      allReady: this.allReady,
      countdownMs: null,
      choice: this.choice,
      guardActive: false,
    };
  }
  commit(): void {
    this.committed = true;
    this.rec.record('commit');
  }
}

export class FakeRunSession implements RunSessionApi {
  readonly rec = new CallRecorder();
  readonly world: WorldState;
  readonly flagState: {
    waveClearReady: boolean;
    defeat: boolean;
    finalVisit: boolean;
    roundOver: boolean;
    matchOver: boolean;
  } = { waveClearReady: false, defeat: false, finalVisit: false, roundOver: false, matchOver: false };
  readonly shops: FakeShop[] = [];
  winner: 0 | 1 | null = null;
  disposed = false;

  readonly config: RunConfig;

  constructor(config: RunConfig) {
    this.config = config;
    this.world = createTestWorld({
      seed: config.seed,
      mode: config.mode,
      vehicles: [config.players[0]?.vehicle ?? 'lancer', config.players[1]?.vehicle ?? 'bulwark'],
    });
  }

  get flags(): RunFlags {
    return this.flagState;
  }
  setFlags(patch: Partial<RunFlags>): void {
    Object.assign(this.flagState, patch);
  }
  tick(_intents: Intents): void {
    this.world.tick++;
    this.rec.record('tick');
  }
  openShop(): ShopApi {
    const s = new FakeShop(this.world);
    s.finalVisit = this.flagState.finalVisit;
    this.shops.push(s);
    this.rec.record('openShop');
    return s;
  }
  applyShopResults(): void {
    this.rec.record('applyShopResults');
  }
  beginNextWave(): void {
    this.flagState.waveClearReady = false;
    this.flagState.roundOver = false;
    this.world.run.wave++;
    if (this.world.run.mode === 'versus') this.world.run.round++;
    this.rec.record('beginNextWave');
  }
  clearEvents(): void {
    this.rec.record('clearEvents');
  }
  setViewRect(minX: number, maxX: number, minZ: number, maxZ: number): void {
    this.rec.record('setViewRect', minX, maxX, minZ, maxZ);
  }
  summary(outcome: RunOutcome): RunSummary {
    this.rec.record('summary', outcome);
    const w = this.world;
    const players = PLAYER_INDICES.filter((i) => w.players[i].life !== 'absent').map((i) => ({
      player: i,
      vehicle: w.players[i].vehicle,
      score: w.players[i].score,
      kills: w.players[i].kills,
      damage: w.players[i].damageDealt,
      shards: w.run.shardsEarned[i],
      revives: w.players[i].revives,
      bestCombo: w.players[i].bestCombo,
      roundWins: w.run.roundWins[i],
    }));
    return {
      runId: this.config.runId,
      mode: this.config.mode,
      outcome,
      winner: this.config.mode === 'versus' ? this.winner : null,
      waveReached: w.run.wave,
      wavesCleared: w.run.wavesCleared,
      bossesKilled: w.run.bossesKilled,
      victoryAchieved: w.run.victoryAchieved,
      shardsEarnedTotal: w.run.shardsEarned[0] + w.run.shardsEarned[1],
      roundsPlayed: w.run.round,
      roundWins: [w.run.roundWins[0], w.run.roundWins[1]],
      durationS: w.run.elapsed,
      totalScore: w.players[0].score + w.players[1].score,
      players,
      mvp: players.length > 0 ? 0 : null,
    };
  }
  dispose(): void {
    this.disposed = true;
    this.rec.record('dispose');
  }
}

/** Services.createRun double that records every config and keeps the sessions. */
export function createFakeRunFactory(): {
  readonly createRun: (c: RunConfig) => FakeRunSession;
  readonly sessions: FakeRunSession[];
} {
  const sessions: FakeRunSession[] = [];
  return {
    sessions,
    createRun: (c) => {
      const s = new FakeRunSession(c);
      sessions.push(s);
      return s;
    },
  };
}

/** A valid RunConfig for tests. */
export function testRunConfig(patch: Partial<RunConfig> = {}): RunConfig {
  return {
    runId: 'run-test-1',
    seed: 42,
    mode: 'coop',
    players: [
      { player: 0, vehicle: 'lancer' },
      { player: 1, vehicle: 'bulwark' },
    ],
    meta: {},
    autofire: [true, true],
    focusToggle: [false, false],
    themeId: 'kernelPanic',
    ...patch,
  };
}

/**
 * Allocates the whole world once at CAPACITY (pools, 2 players, grid, rngs, event channels, death queue,
 * director). resetWorld reuses every allocation for a new run with a new config.
 * Record factories live in sim/worldRecords.ts, event channels in sim/simEventChannels.ts.
 */
import type { RunMode } from '../contracts/ids';
import type {
  BossEntity,
  EnemyEntity,
  LaserEntity,
  PickupEntity,
  PlayerEntity,
  ProjectileEntity,
} from '../contracts/sim';
import type {
  DeathRecord,
  DirectorState,
  PendingSpawn,
  RunCounters,
  WorldConfig,
  WorldState,
} from '../contracts/world';
import { invariant } from '../core/assert';
import { EntityPool } from '../core/EntityPool';
import { EventChannel } from '../core/EventChannel';
import { createRng } from '../core/rng';
import { SpatialGrid } from '../core/SpatialGrid';
import { ARENA, CAPACITY } from '../config/tuning';
import { resetShardCarry } from '../entities/wallet';
import { clearSimEvents, createSimEvents } from './simEventChannels';
import {
  clearBoss,
  createBoss,
  createDeathRecord,
  createEnemy,
  createLaser,
  createLink,
  createPending,
  createPickup,
  createPlayer,
  createProjectile,
  initPlayer,
} from './worldRecords';

function createCounters(config: WorldConfig): RunCounters {
  const two = config.players[1] !== null;
  return {
    mode: config.mode,
    playerCount: two ? 2 : 1,
    wave: 0,
    sector: 1,
    overflow: false,
    phase: 'idle',
    phaseTimer: 0,
    waveTimer: 0,
    waveDuration: 0,
    wallets: [config.startShards, two ? config.startShards : 0],
    shardsEarned: [0, 0],
    spareKernels: config.mode === 'versus' ? 0 : config.startKernels,
    bossesKilled: 0,
    wavesCleared: 0,
    victoryAchieved: false,
    timeScaleRequest: 1,
    enemyHpMul: 1,
    threatMul: 1,
    wipeGrace: -1,
    elapsed: 0,
    round: 0,
    roundWins: [0, 0],
    suddenDeath: false,
    roundWinner: -2,
    matchWinner: -1,
  };
}

function validateConfig(config: WorldConfig): void {
  const two = config.players[1] !== null;
  invariant(
    config.mode === 'solo' ? !two : two,
    `WorldConfig: mode ${config.mode} needs ${config.mode === 'solo' ? '1' : '2'} players`,
  );
  invariant(Number.isSafeInteger(config.startShards) && config.startShards >= 0, 'WorldConfig: startShards');
  invariant(
    Number.isSafeInteger(config.startKernels) && config.startKernels >= 0,
    'WorldConfig: startKernels',
  );
}

export function createWorld(config: WorldConfig): WorldState {
  validateConfig(config);
  const root = createRng(config.seed);
  const pending = new EntityPool<PendingSpawn>(CAPACITY.pendingSpawns, createPending);
  const director: DirectorState = {
    budgetTotal: 0,
    budgetLeft: 0,
    pulseTimer: 0,
    pulseInterval: 0,
    pulseIndex: 0,
    deferred: 0,
    bossSpawned: false,
    unlockedMask: 0,
    pending,
  };
  const bosses: BossEntity[] = [];
  for (let i = 0; i < CAPACITY.bossParts; i++) bosses.push(createBoss(i));
  const players: readonly [PlayerEntity, PlayerEntity] = [createPlayer(0), createPlayer(1)];
  initPlayer(players[0], config.players[0], config.mode);
  initPlayer(players[1], config.players[1], config.mode);
  return {
    tick: 0,
    time: 0,
    mode: config.mode,
    config,
    players,
    enemies: new EntityPool<EnemyEntity>(CAPACITY.enemies, createEnemy),
    playerShots: new EntityPool<ProjectileEntity>(CAPACITY.playerShots, createProjectile),
    enemyShots: new EntityPool<ProjectileEntity>(CAPACITY.enemyShots, createProjectile),
    pickups: new EntityPool<PickupEntity>(CAPACITY.pickups, createPickup),
    lasers: new EntityPool<LaserEntity>(CAPACITY.lasers, createLaser),
    bosses,
    link: createLink(),
    run: createCounters(config),
    flags: { waveClearReady: false, defeat: false, finalVisit: false, roundOver: false, matchOver: false },
    events: createSimEvents(),
    viewRect: { minX: -ARENA.RADIUS, maxX: ARENA.RADIUS, minZ: -ARENA.RADIUS, maxZ: ARENA.RADIUS },
    grid: new SpatialGrid({
      cols: ARENA.GRID_COLS,
      rows: ARENA.GRID_ROWS,
      cellSize: ARENA.GRID_CELL,
      originX: ARENA.GRID_ORIGIN,
      originZ: ARENA.GRID_ORIGIN,
      capacity: ARENA.GRID_CAPACITY,
    }),
    rng: { sim: root.fork('sim'), shop: root.fork('shop') },
    deathQueue: new EventChannel<DeathRecord>(CAPACITY.deathQueue, createDeathRecord),
    director,
  };
}

/**
 * Resets a world for a new run in place: pools cleared, players re-initialised, counters/flags reset,
 * events cleared, rng streams re-seeded. The only allocations are the new rng streams and counters object
 * fields (never during a run).
 */
export function resetWorld(w: WorldState, config: WorldConfig): void {
  validateConfig(config);
  const m = w as {
    tick: number;
    time: number;
    config: WorldConfig;
    mode: RunMode;
    run: RunCounters;
    rng: WorldState['rng'];
  };
  m.tick = 0;
  m.time = 0;
  m.config = config;
  m.mode = config.mode;
  w.enemies.clear();
  w.playerShots.clear();
  w.enemyShots.clear();
  w.pickups.clear();
  w.lasers.clear();
  w.director.pending.clear();
  for (const b of w.bosses) clearBoss(b);
  Object.assign(w.link, createLink());
  Object.assign(w.run, createCounters(config));
  w.flags.waveClearReady = false;
  w.flags.defeat = false;
  w.flags.finalVisit = false;
  w.flags.roundOver = false;
  w.flags.matchOver = false;
  clearSimEvents(w.events);
  w.deathQueue.clear();
  w.grid.begin();
  w.grid.build();
  const d = w.director;
  d.budgetTotal = d.budgetLeft = d.pulseTimer = d.pulseInterval = d.pulseIndex = d.deferred = 0;
  d.bossSpawned = false;
  d.unlockedMask = 0;
  w.viewRect.minX = -ARENA.RADIUS;
  w.viewRect.maxX = ARENA.RADIUS;
  w.viewRect.minZ = -ARENA.RADIUS;
  w.viewRect.maxZ = ARENA.RADIUS;
  initPlayer(w.players[0], config.players[0], config.mode);
  initPlayer(w.players[1], config.players[1], config.mode);
  resetShardCarry(w);
  const root = createRng(config.seed);
  m.rng = { sim: root.fork('sim'), shop: root.fork('shop') };
}

/**
 * World aggregate contracts: run counters, flags, wave-director state, WorldView/WorldState, SimSystem.
 * Split out of sim.ts to respect the 400-line cap. FROZEN after Wave 0.
 */
import type { EnemyKind, PlayerIndex, RunMode, VehicleId } from './ids';
import type { Intents } from './input';
import type {
  BossEntity,
  EnemyEntity,
  EntityPoolApi,
  LaserEntity,
  LinkState,
  PickupEntity,
  PlayerEntity,
  PoolView,
  PooledRecord,
  ProjectileEntity,
  Rng,
  SpatialGridApi,
} from './sim';
import type { DamageSource, EventChannel, SimEvents } from './simEvents';
import type { DerivedStats } from './upgrades';

/**
 * Wave/round phase.
 * co-op/solo: idle -> countdown -> combat|boss -> (purge) -> clearOutro -> done (waveClearReady) -> ...
 * versus:     idle -> countdown -> combat -> (suddenDeath flag) -> roundOutro -> done (roundOver | matchOver)
 * 'done' also follows a team wipe (defeat).
 */
export type WavePhase =
  'idle' | 'countdown' | 'combat' | 'boss' | 'purge' | 'clearOutro' | 'roundOutro' | 'done';

export interface RunCounters {
  readonly mode: RunMode;
  readonly playerCount: 1 | 2;
  /** Global wave index 1..15, then 16+ in OVERFLOW. In versus: the wave-table row used for hazards. */
  wave: number;
  sector: 1 | 2 | 3;
  overflow: boolean;
  phase: WavePhase;
  /** Seconds left in the current phase (countdown/purge/outro). */
  phaseTimer: number;
  /** Seconds left in combat (co-op) / the round (versus). */
  waveTimer: number;
  waveDuration: number;
  wallets: [number, number];
  shardsEarned: [number, number];
  spareKernels: number;
  bossesKilled: number;
  wavesCleared: number;
  victoryAchieved: boolean;
  /** Requested accumulator time scale (1 normal, 0.35 clear slow-mo). PlayingState forwards it to LoopControl. */
  timeScaleRequest: number;
  /** Enemy HP multiplier fixed at wave start. */
  enemyHpMul: number;
  /** Threat budget multiplier fixed at wave start (2P x1.5, versus x0.6). */
  threatMul: number;
  /** Team-wipe grace countdown (1.0 s), -1 when not wiping. */
  wipeGrace: number;
  /** Total sim seconds played this run. */
  elapsed: number;
  // ---- versus only (zero/false otherwise)
  round: number;
  roundWins: [number, number];
  suddenDeath: boolean;
  /** Winner of the last finished round: 0/1, -1 draw, -2 undecided. */
  roundWinner: number;
  /** Match winner once decided, else -1. */
  matchWinner: PlayerIndex | -1;
}

/** Mutable flags written by rules.ts / versusRules.ts, read by RunSession -> PlayingState. */
export interface MutableRunFlags {
  /** Co-op/solo: wave cleared and outro finished -> push UpgradesShop{midrun}. */
  waveClearReady: boolean;
  /** Co-op/solo team wipe after grace -> GameOver{defeat}. */
  defeat: boolean;
  /** The next shop visit is the post-wave-15 EXTRACT / PUSH DEEPER visit. */
  finalVisit: boolean;
  /** Versus: round finished and outro done, match not decided -> push UpgradesShop{midrun}. */
  roundOver: boolean;
  /** Versus: match decided -> GameOver{victory} with summary.winner. */
  matchOver: boolean;
}

export interface PendingSpawn extends PooledRecord {
  kind: EnemyKind;
  x: number;
  z: number;
  /** Telegraph time left (0.8 s ring) before the enemy is spawned. */
  delay: number;
  elite: boolean;
  portal: number;
}

export interface DirectorState {
  budgetTotal: number;
  budgetLeft: number;
  pulseTimer: number;
  pulseInterval: number;
  pulseIndex: number;
  /** Spawns deferred by the 180-alive cap. */
  deferred: number;
  bossSpawned: boolean;
  /** Bit per EnemyKind index unlocked this wave. */
  unlockedMask: number;
  readonly pending: EntityPoolApi<PendingSpawn>;
}

/** A kill waiting for resolveEnemyDeaths (Fork splits, despawn, Leech unlatch). */
export interface DeathRecord {
  slot: number;
  kind: EnemyKind;
  elite: boolean;
  x: number;
  z: number;
  vx: number;
  vz: number;
  by: DamageSource;
  splitGen: number;
  seed: number;
}

/** Last published camera view rectangle on the ground (RenderBridge writes it via setViewRect). */
export interface ViewRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface WorldPlayerInit {
  readonly vehicle: VehicleId;
  readonly stats: DerivedStats;
  /** Special meter at start (Pre-Charge firmware = 50). */
  readonly overdrive: number;
}

export interface WorldConfig {
  readonly seed: number;
  readonly mode: RunMode;
  /** Index 1 is null in solo. */
  readonly players: readonly [WorldPlayerInit, WorldPlayerInit | null];
  readonly startShards: number;
  readonly startKernels: number;
}

export interface WorldRngs {
  readonly sim: Rng;
  readonly shop: Rng;
}

/** Read-only view for render/audio/hud/viewModels. */
export interface WorldView {
  readonly tick: number;
  readonly time: number;
  readonly mode: RunMode;
  readonly players: readonly [Readonly<PlayerEntity>, Readonly<PlayerEntity>];
  readonly enemies: PoolView<Readonly<EnemyEntity>>;
  readonly playerShots: PoolView<Readonly<ProjectileEntity>>;
  readonly enemyShots: PoolView<Readonly<ProjectileEntity>>;
  readonly pickups: PoolView<Readonly<PickupEntity>>;
  readonly lasers: PoolView<Readonly<LaserEntity>>;
  /** Fixed length CAPACITY.bossParts; check `alive`. */
  readonly bosses: readonly Readonly<BossEntity>[];
  readonly link: Readonly<LinkState>;
  readonly run: Readonly<RunCounters>;
  readonly flags: Readonly<MutableRunFlags>;
  readonly events: SimEvents;
  readonly viewRect: Readonly<ViewRect>;
}

/** The mutable world. Allocated once by sim/createWorld.ts; resetWorld reuses every allocation. */
export interface WorldState extends WorldView {
  tick: number;
  time: number;
  readonly config: WorldConfig;
  readonly players: readonly [PlayerEntity, PlayerEntity];
  readonly enemies: EntityPoolApi<EnemyEntity>;
  readonly playerShots: EntityPoolApi<ProjectileEntity>;
  readonly enemyShots: EntityPoolApi<ProjectileEntity>;
  readonly pickups: EntityPoolApi<PickupEntity>;
  readonly lasers: EntityPoolApi<LaserEntity>;
  readonly bosses: readonly BossEntity[];
  readonly link: LinkState;
  readonly run: RunCounters;
  readonly flags: MutableRunFlags;
  readonly viewRect: ViewRect;
  readonly grid: SpatialGridApi;
  readonly rng: WorldRngs;
  readonly deathQueue: EventChannel<DeathRecord>;
  readonly director: DirectorState;
}

/** Every per-tick system has this shape. Allocation-free, indexed loops only. */
export type SimSystem = (w: WorldState, intents: Intents, dt: number) => void;

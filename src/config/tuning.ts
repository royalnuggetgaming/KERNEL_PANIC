/**
 * Core tuning numbers (plan sections 1, 4, 6, 10). Pure `as const` data; every gameplay number lives in
 * config/*.ts. Distances in world units (u), times in seconds unless suffixed Ms.
 */

export const SIM = {
  HZ: 120,
  DT: 1 / 120,
  MAX_STEPS: 8,
  MAX_FRAME_DT: 0.1,
} as const;

export const ARENA = {
  RADIUS: 32,
  PORTALS: 8,
  /** Portals sit on this ring. */
  PORTAL_RADIUS: 30,
  PORTALS_PER_PULSE: 3,
  /** Spatial grid: 16 x 16 cells of 4 u centred on the origin (covers -32..32). */
  GRID_COLS: 16,
  GRID_ROWS: 16,
  GRID_CELL: 4,
  GRID_ORIGIN: -32,
  /** Max items inserted into the grid per tick (enemies + boss parts). */
  GRID_CAPACITY: 256,
} as const;

export const CAPACITY = {
  enemies: 180,
  playerShots: 1536,
  enemyShots: 1024,
  pickups: 512,
  particles: 8192,
  digits: 256,
  shockwaves: 32,
  decals: 64,
  bossParts: 4,
  lasers: 8,
  pendingSpawns: 256,
  deathQueue: 256,
  beams: 64,
  markers: 8,
  shields: 8,
} as const;

/** Per-channel SimEvents capacities (events accumulate over up to 8 ticks per frame). */
export const EVENT_CAPACITY = {
  shot: 512,
  enemyShot: 512,
  hit: 1024,
  kill: 256,
  explosion: 128,
  pickup: 256,
  player: 64,
  wave: 32,
  telegraph: 128,
  special: 16,
  arc: 128,
  spawn: 128,
  boss: 32,
} as const;

export const MOVEMENT = {
  ACCEL: 80,
  DECEL: 100,
  TURN_RATE_DEG: 720,
  FOCUS_MOVE_MUL: 0.7,
  FOCUS_SPREAD_MUL: 0.4,
  FOCUS_DAMAGE_BONUS: 0.15,
  AIM_ASSIST_HALF_DEG: 10,
  AIM_ASSIST_RANGE: 24,
  PLAYER_RADIUS: 0.9,
  /** Soft push between craft (co-op and versus): separation speed at full overlap. */
  SOFT_PUSH: 12,
} as const;

export const DASH = {
  DURATION: 0.16,
  DISTANCE: 7,
  IFRAMES: 0.2,
  BASE_COOLDOWN: 1.4,
  RAM_DAMAGE: 40,
} as const;

export const OVERDRIVE = {
  MAX: 100,
  PER_DAMAGE: 0.02,
  PER_KILL: 3,
} as const;

export const CAMERA = {
  FOV_DEG: 42,
  PITCH_DEG: 58,
  MIN_DIST: 26,
  ARENA_MARGIN: 4,
  ARENA_SAMPLES: 16,
  MAXDIST_ITERATIONS: 16,
  MAXDIST_NDC: 0.95,
  FRAMING_ITERATIONS: 12,
  PAD_ALIVE: 7,
  PAD_DOWNED: 5,
  PAD_BOSS: 4,
  GHOST_INSET: 1.5,
  LEAD_TIME: 0.2,
  LEAD_MAX: 4,
  CENTER_CLAMP: 12,
  SAFE_X: 0.82,
  SAFE_Y_MIN: -0.78,
  SAFE_Y_MAX: 0.72,
  CENTER_SMOOTH: 0.18,
  ZOOM_OUT_SMOOTH: 0.3,
  ZOOM_IN_SMOOTH: 0.65,
  ZOOM_IN_THRESHOLD: 0.06,
  ZOOM_IN_HOLD: 0.4,
  SOLO_SPEED_ZOOM: 0.15,
  MARKER_DIST: 45,
  MARKER_PX: 24,
  SHAKE_MAX_TRAUMA_PER_EVENT: 0.35,
  SHAKE_DECAY: 1.6,
  SHAKE_MAX_OFFSET: 0.6,
  SHAKE_MAX_ROLL_DEG: 1.2,
  BOSS_INTRO: 1.2,
  GAMEOVER_PUSH: 1.2,
  GAMEOVER_TIME_SCALE: 0.25,
  ASPECT_SNAP: 0.1,
} as const;

export const COOP = {
  BLEED_OUT: 12,
  BLEED_STEP: 2,
  BLEED_MIN: 6,
  DOWNED_CRAWL_MUL: 0.25,
  REVIVE_RADIUS: 2.5,
  REVIVE_TIME: 2,
  REVIVE_DECAY_PER_S: 0.5,
  REVIVE_HP_FRAC: 0.4,
  REVIVE_INVULN: 2,
  KERNEL_RESPAWN_DELAY: 1.5,
  KERNEL_HP_FRAC: 0.6,
  KERNEL_INVULN: 2,
  START_KERNELS: 1,
  MAX_KERNELS: 3,
  WIPE_GRACE: 1,
  OFFLINE_COLLECT_MUL: 0.5,
  MARK_DURATION: 4,
  MARK_BONUS: 0.2,
  REBOOT_DOWNED_HP: 0.4,
  REBOOT_OFFLINE_HP: 0.3,
  LINK_MIN: 4,
  LINK_MAX: 14,
  LINK_DPS: 22,
  LINK_WIDTH: 0.6,
  ECHO_ORBIT: 6,
  ECHO_ORBIT_SPEED: 1.6,
  ECHO_DAMAGE_MUL: 0.6,
  SYNC_WINDOW: 0.4,
  SYNC_SHARDS: 2,
  SYNC_OVERDRIVE: 3,
  RACE_WINDOW_COOP: 3,
  RACE_WINDOW_SOLO: 6,
  RACE_RESPAWN_FRAC: 0.5,
  /** Enemy contact damage cooldown per player. */
  CONTACT_COOLDOWN: 0.5,
} as const;

export const COMBO = {
  WINDOW: 2,
  TIERS: [10, 25, 50, 100],
  SCORE_MUL: [1, 1.5, 2, 3, 4],
  SHARD_BONUS: [0, 0.1, 0.2, 0.3, 0.4],
  HIT_KEEP: 0.5,
} as const;

export const PICKUPS = {
  DENOMINATIONS: [25, 5, 1],
  MAGNET_BASE: 3.5,
  MAGNET_SPEED: 22,
  COLLECT_RADIUS: 1.1,
  BLINK_AT: 9,
  DESPAWN_AT: 12,
  CATCHUP_RATIO: 0.6,
  CATCHUP_BONUS: 0.2,
  SCATTER_SPEED: 4,
  FRICTION: 6,
  VACUUM_SPEED: 40,
} as const;

/** Hard caps (plan section 6). Relative caps are multipliers of the vehicle base. */
export const STAT_CAPS = {
  moveSpeedMulMax: 1.6,
  fireRateMax: 20,
  damageMulMax: 4,
  projectilesMax: 5,
  pierceMax: 4,
  bouncesMax: 2,
  dashCooldownMin: 0.6,
  dashChargesMax: 3,
  maxHpMin: 1,
  maxHpMax: 400,
  magnetRadiusMax: 12,
  critChanceMax: 0.5,
  critMul: 2,
  specialTierMax: 2,
  armorMax: 0.6,
} as const;

export const ECONOMY = {
  WALLET_MAX: 9_999_999,
  INFLATION_PER_WAVE: 0.06,
  MIN_PRICE: 5,
  CORES_PER_SHARDS: 10,
  CORES_PER_WAVE: 3,
  CORES_PER_BOSS: 15,
  CORES_VICTORY_BONUS: 40,
  CORES_CAP: 400,
  CORES_MAX: 1_000_000_000,
  BOSS_SHARDS: 60,
} as const;

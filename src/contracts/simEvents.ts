/**
 * Sim -> presentation events. Fixed-capacity channels of preallocated mutable structs, filled during sim
 * ticks and drained ONCE per frame by PlayingState (render, audio, hud), then cleared.
 * FROZEN after Wave 0.
 */
import type { BossId, EnemyKind, PlayerIndex, SpecialKind, VehicleId } from './ids';

/**
 * Fixed-capacity ring of reusable structs (implemented by core/EventChannel.ts).
 * push() never returns null: on overflow it returns a shared scratch struct that is NOT recorded and
 * increments `dropped`, so producers never branch. Consumers read [0, count) via get(i).
 */
export interface EventChannel<T extends object> {
  readonly capacity: number;
  readonly count: number;
  readonly dropped: number;
  /** Returns the next struct to fill in place. Fields keep stale values: producers must write every field. */
  push(): T;
  get(i: number): Readonly<T>;
  clear(): void;
}

/** Who dealt damage. 0/1 = player, SOURCE_LINK = link beam/echo drone, SOURCE_WORLD = enemies/bosses/env. */
export const SOURCE_WORLD = -1;
export const SOURCE_LINK = 2;
export type DamageSource = PlayerIndex | typeof SOURCE_WORLD | typeof SOURCE_LINK;

export interface ShotEvent {
  owner: PlayerIndex;
  vehicle: VehicleId;
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
}

export interface EnemyShotEvent {
  x: number;
  z: number;
  boss: boolean;
}

/** 0 enemy, 1 player, 2 shield block (Warden/Nanoshield/Firewall), 3 boss. */
export type HitTarget = 0 | 1 | 2 | 3;

export interface HitEvent {
  x: number;
  z: number;
  amount: number;
  crit: boolean;
  target: HitTarget;
  /** Player hit (target 1) or damage source; -1 when not applicable. */
  player: PlayerIndex | -1;
}

export interface KillEvent {
  kind: EnemyKind;
  x: number;
  z: number;
  by: DamageSource;
  elite: boolean;
  /** Killer's combo chain after this kill (0 for link/world). */
  combo: number;
}

export interface ExplosionEvent {
  x: number;
  z: number;
  radius: number;
  /** 0..1 visual/audio strength. */
  power: number;
}

export interface PickupEvent {
  player: PlayerIndex;
  value: number;
  x: number;
  z: number;
  combo: number;
}

export type PlayerEventKind =
  | 'hurt'
  | 'downed'
  | 'revived'
  | 'offline'
  | 'kernel'
  | 'dash'
  | 'special'
  | 'reboot'
  | 'heal'
  | 'shieldBlock'
  | 'eliminated';

export interface PlayerEvent {
  player: PlayerIndex;
  what: PlayerEventKind;
  amount: number;
  x: number;
  z: number;
}

export type WaveEventKind =
  | 'countdown'
  | 'start'
  | 'purge'
  | 'cleared'
  | 'bossSpawn'
  | 'bossPhase'
  | 'bossEnrage'
  | 'bossDead'
  | 'sync'
  | 'comboTier'
  | 'roundStart'
  | 'roundEnd'
  | 'suddenDeath'
  | 'matchEnd';

export interface WaveEvent {
  what: WaveEventKind;
  /** Wave index (co-op/solo) or round index (versus). */
  wave: number;
  /** Payload: countdown seconds, combo tier, boss phase, round winner (-1 draw), etc. */
  value: number;
  /** Player the event concerns (comboTier, sync, roundEnd winner), -1 otherwise. */
  player: PlayerIndex | -1;
}

export interface TelegraphEvent {
  /** 0 ring (spawn portal / ring burst), 1 line (lunge / sweep / rail). */
  shape: 0 | 1;
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  size: number;
  duration: number;
}

export interface SpecialEvent {
  player: PlayerIndex;
  kind: SpecialKind;
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  radius: number;
  duration: number;
}

/** Chain Arc / Tinker arc pistol / boss lightning: purely visual segment. */
export interface ArcEvent {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  owner: PlayerIndex | -1;
}

export interface SpawnEvent {
  kind: EnemyKind;
  x: number;
  z: number;
  elite: boolean;
}

export interface BossEvent {
  id: BossId;
  part: number;
  what: 'intro' | 'phase' | 'enrage' | 'split' | 'respawn' | 'dead';
  x: number;
  z: number;
}

export interface SimEvents {
  readonly shot: EventChannel<ShotEvent>;
  readonly enemyShot: EventChannel<EnemyShotEvent>;
  readonly hit: EventChannel<HitEvent>;
  readonly kill: EventChannel<KillEvent>;
  readonly explosion: EventChannel<ExplosionEvent>;
  readonly pickup: EventChannel<PickupEvent>;
  readonly player: EventChannel<PlayerEvent>;
  readonly wave: EventChannel<WaveEvent>;
  readonly telegraph: EventChannel<TelegraphEvent>;
  readonly special: EventChannel<SpecialEvent>;
  readonly arc: EventChannel<ArcEvent>;
  readonly spawn: EventChannel<SpawnEvent>;
  readonly boss: EventChannel<BossEvent>;
}

export type SimEventName = keyof SimEvents;

/**
 * Allocation-free SimEvents producers shared by the combat systems. Each helper writes every field of the
 * pushed struct (channels hand back stale structs).
 */
import type { PlayerIndex } from '../contracts/ids';
import type { DamageSource, HitTarget, PlayerEventKind, WaveEventKind } from '../contracts/simEvents';
import type { WorldState } from '../contracts/world';

export function isPlayerSource(source: DamageSource): source is PlayerIndex {
  return source === 0 || source === 1;
}

export function emitHit(
  w: WorldState,
  x: number,
  z: number,
  amount: number,
  crit: boolean,
  target: HitTarget,
  player: PlayerIndex | -1,
): void {
  const e = w.events.hit.push();
  e.x = x;
  e.z = z;
  e.amount = amount;
  e.crit = crit;
  e.target = target;
  e.player = player;
}

export function emitPlayer(
  w: WorldState,
  player: PlayerIndex,
  what: PlayerEventKind,
  amount: number,
  x: number,
  z: number,
): void {
  const e = w.events.player.push();
  e.player = player;
  e.what = what;
  e.amount = amount;
  e.x = x;
  e.z = z;
}

export function emitWave(w: WorldState, what: WaveEventKind, value: number, player: PlayerIndex | -1): void {
  const e = w.events.wave.push();
  e.what = what;
  e.wave = w.mode === 'versus' ? w.run.round : w.run.wave;
  e.value = value;
  e.player = player;
}

export function emitArc(
  w: WorldState,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  owner: PlayerIndex | -1,
): void {
  const e = w.events.arc.push();
  e.x0 = x0;
  e.z0 = z0;
  e.x1 = x1;
  e.z1 = z1;
  e.owner = owner;
}

export function emitExplosion(w: WorldState, x: number, z: number, radius: number, power: number): void {
  const e = w.events.explosion.push();
  e.x = x;
  e.z = z;
  e.radius = radius;
  e.power = power;
}

/** SimEvents channel allocation and clearing. Wave 0 file. */
import { SOURCE_WORLD, type SimEvents } from '../contracts/simEvents';
import { EventChannel } from '../core/EventChannel';
import { EVENT_CAPACITY } from '../config/tuning';

/** Allocates every SimEvents channel with its struct factory. */
export function createSimEvents(): SimEvents {
  const c = EVENT_CAPACITY;
  return {
    shot: new EventChannel(c.shot, () => ({
      owner: 0,
      vehicle: 'lancer' as const,
      x: 0,
      z: 0,
      dirX: 0,
      dirZ: 0,
    })),
    enemyShot: new EventChannel(c.enemyShot, () => ({ x: 0, z: 0, boss: false })),
    hit: new EventChannel(c.hit, () => ({
      x: 0,
      z: 0,
      amount: 0,
      crit: false,
      target: 0 as const,
      player: -1 as const,
    })),
    kill: new EventChannel(c.kill, () => ({
      kind: 'shard' as const,
      x: 0,
      z: 0,
      by: SOURCE_WORLD,
      elite: false,
      combo: 0,
    })),
    explosion: new EventChannel(c.explosion, () => ({ x: 0, z: 0, radius: 0, power: 0 })),
    pickup: new EventChannel(c.pickup, () => ({ player: 0, value: 0, x: 0, z: 0, combo: 0 })),
    player: new EventChannel(c.player, () => ({
      player: 0,
      what: 'hurt' as const,
      amount: 0,
      x: 0,
      z: 0,
    })),
    wave: new EventChannel(c.wave, () => ({
      what: 'start' as const,
      wave: 0,
      value: 0,
      player: -1 as const,
    })),
    telegraph: new EventChannel(c.telegraph, () => ({
      shape: 0 as const,
      x: 0,
      z: 0,
      dirX: 0,
      dirZ: 0,
      size: 0,
      duration: 0,
    })),
    special: new EventChannel(c.special, () => ({
      player: 0,
      kind: 'railburst' as const,
      x: 0,
      z: 0,
      dirX: 0,
      dirZ: 0,
      radius: 0,
      duration: 0,
    })),
    arc: new EventChannel(c.arc, () => ({ x0: 0, z0: 0, x1: 0, z1: 0, owner: -1 as const })),
    spawn: new EventChannel(c.spawn, () => ({ kind: 'shard' as const, x: 0, z: 0, elite: false })),
    boss: new EventChannel(c.boss, () => ({
      id: 'forkBomb' as const,
      part: 0,
      what: 'intro' as const,
      x: 0,
      z: 0,
    })),
  };
}

/** Clears every SimEvents channel (RunSession.clearEvents after the frame drain). */
export function clearSimEvents(e: SimEvents): void {
  e.shot.clear();
  e.enemyShot.clear();
  e.hit.clear();
  e.kill.clear();
  e.explosion.clear();
  e.pickup.clear();
  e.player.clear();
  e.wave.clear();
  e.telegraph.clear();
  e.special.clear();
  e.arc.clear();
  e.spawn.clear();
  e.boss.clear();
}

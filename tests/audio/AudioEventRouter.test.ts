import { describe, expect, it } from 'vitest';
import type { SfxId } from '../../src/contracts/audio';
import { SOURCE_WORLD } from '../../src/contracts/simEvents';
import { createSimEvents } from '../../src/sim/simEventChannels';
import {
  LADDER_STEPS,
  createAudioEventRouter,
  ladderCents,
  panFromX,
} from '../../src/audio/AudioEventRouter';

interface Call {
  id: SfxId;
  pan: number;
  gain: number;
  detune: number;
}

function setup() {
  const calls: Call[] = [];
  const router = createAudioEventRouter((id, pan = 0, gain = 1, detune = 0) => {
    calls.push({ id, pan, gain, detune });
  }, 32);
  return { calls, router, events: createSimEvents() };
}

describe('AudioEventRouter', () => {
  it('pans from the x position and clamps', () => {
    expect(panFromX(0, 32)).toBe(0);
    expect(panFromX(32, 32)).toBeCloseTo(0.85, 9);
    expect(panFromX(-32, 32)).toBeCloseTo(-0.85, 9);
    expect(panFromX(1000, 32)).toBe(1);
    expect(panFromX(-1000, 32)).toBe(-1);
    expect(panFromX(Number.NaN, 32)).toBe(0);
    expect(panFromX(5, 0)).toBe(0);
  });

  it('pickup pitch ladder climbs with the combo then holds', () => {
    expect(ladderCents(0)).toBe(0);
    expect(ladderCents(1)).toBe(300);
    expect(ladderCents(4)).toBe(1000);
    expect(ladderCents(5)).toBe(1200);
    let prev = -1;
    for (let c = 0; c < LADDER_STEPS; c++) {
      expect(ladderCents(c)).toBeGreaterThan(prev);
      prev = ladderCents(c);
    }
    expect(ladderCents(500)).toBe(ladderCents(LADDER_STEPS - 1));
    expect(ladderCents(-3)).toBe(0);
    expect(ladderCents(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('maps shots per vehicle with pan, and hits by target', () => {
    const { calls, router, events } = setup();
    const vehicles = ['lancer', 'bulwark', 'specter', 'tinker'] as const;
    for (const v of vehicles) {
      const s = events.shot.push();
      s.owner = 0;
      s.vehicle = v;
      s.x = 16;
      s.z = 0;
      s.dirX = 0;
      s.dirZ = 1;
    }
    const targets = [0, 1, 2, 3] as const;
    for (const t of targets) {
      const h = events.hit.push();
      h.x = -32;
      h.z = 0;
      h.amount = 10;
      h.crit = t === 3;
      h.target = t;
      h.player = -1;
    }
    router.route(events);
    expect(calls.map((c) => c.id)).toEqual([
      'laser',
      'laserHeavy',
      'needle',
      'arc',
      'hit',
      'shieldBlock',
      'crit',
    ]);
    expect(calls[0]!.pan).toBeCloseTo(0.425, 6);
    expect(calls[4]!.pan).toBeCloseTo(-0.85, 6);
    expect(calls[6]!.detune).toBe(-300);
  });

  it('routes kills, explosions, pickups with the ladder, and does not clear channels', () => {
    const { calls, router, events } = setup();
    const k = events.kill.push();
    k.kind = 'shard';
    k.x = 0;
    k.z = 0;
    k.by = SOURCE_WORLD;
    k.elite = false;
    k.combo = 0;
    const k2 = events.kill.push();
    Object.assign(k2, k, { elite: true });
    const ex = events.explosion.push();
    ex.x = 0;
    ex.z = 0;
    ex.radius = 3;
    ex.power = 0.9;
    const ex2 = events.explosion.push();
    Object.assign(ex2, ex, { power: -1 });
    for (let combo = 0; combo < 3; combo++) {
      const p = events.pickup.push();
      p.player = 1;
      p.value = 1;
      p.x = 0;
      p.z = 0;
      p.combo = combo;
    }
    router.route(events);
    expect(calls.map((c) => c.id)).toEqual([
      'explodeS',
      'explodeL',
      'explodeL',
      'explodeS',
      'shard',
      'shard',
      'shard',
    ]);
    expect(calls.slice(4).map((c) => c.detune)).toEqual([0, 300, 500]);
    expect(events.kill.count).toBe(2);
  });

  it('covers player, wave, telegraph, special and boss events', () => {
    const { calls, router, events } = setup();
    const playerKinds = [
      'hurt',
      'downed',
      'revived',
      'offline',
      'kernel',
      'dash',
      'special',
      'reboot',
      'heal',
      'shieldBlock',
      'eliminated',
    ] as const;
    for (const what of playerKinds) {
      const p = events.player.push();
      p.player = 0;
      p.what = what;
      p.amount = 1;
      p.x = 0;
      p.z = 0;
    }
    const waveKinds = [
      'countdown',
      'start',
      'purge',
      'cleared',
      'bossSpawn',
      'bossPhase',
      'bossEnrage',
      'bossDead',
      'sync',
      'comboTier',
      'roundStart',
      'roundEnd',
      'suddenDeath',
      'matchEnd',
    ] as const;
    for (const what of waveKinds) {
      const w = events.wave.push();
      w.what = what;
      w.wave = 1;
      w.value = 2;
      w.player = -1;
    }
    for (const shape of [0, 1] as const) {
      const t = events.telegraph.push();
      t.shape = shape;
      t.x = 0;
      t.z = 0;
      t.dirX = 0;
      t.dirZ = 0;
      t.size = 1;
      t.duration = 1;
    }
    for (const kind of ['railburst', 'firewall', 'blinkSwarm', 'patchDrone'] as const) {
      const s = events.special.push();
      s.player = 0;
      s.kind = kind;
      s.x = 0;
      s.z = 0;
      s.dirX = 0;
      s.dirZ = 0;
      s.radius = 1;
      s.duration = 1;
    }
    for (const what of ['intro', 'phase', 'enrage', 'split', 'respawn', 'dead'] as const) {
      const b = events.boss.push();
      b.id = 'kernel';
      b.part = 0;
      b.what = what;
      b.x = 0;
      b.z = 0;
    }
    router.route(events);
    const ids = calls.map((c) => c.id);
    expect(ids.slice(0, 10)).toEqual([
      'hurt',
      'downed',
      'revive',
      'downed',
      'kernel',
      'dash',
      'revive',
      'repair',
      'shieldBlock',
      'downed',
    ]);
    expect(ids.slice(10, 24)).toEqual([
      'uiMove',
      'waveStart',
      'explodeL',
      'waveClear',
      'bossRoar',
      'bossRoar',
      'bossRoar',
      'explodeBoss',
      'sync',
      'powerUp',
      'waveStart',
      'roundWin',
      'bossRoar',
      'roundWin',
    ]);
    expect(ids.slice(24, 25)).toEqual(['portal']);
    expect(ids.slice(25, 29)).toEqual(['railburst', 'firewall', 'blink', 'patchDrone']);
    expect(ids.slice(29)).toEqual(['bossRoar', 'bossRoar', 'bossRoar', 'explodeL', 'portal', 'explodeBoss']);
    for (const c of calls) {
      expect(c.pan).toBeGreaterThanOrEqual(-1);
      expect(c.pan).toBeLessThanOrEqual(1);
      expect(c.gain).toBeGreaterThan(0);
    }
  });

  it('voices the special-ready cue panned to the player, P2 a tone higher', () => {
    const { calls, router, events } = setup();
    for (const player of [0, 1] as const) {
      const e = events.player.push();
      e.player = player;
      e.what = 'specialReady';
      e.amount = 0;
      e.x = player === 0 ? -16 : 16;
      e.z = 0;
    }
    router.route(events);
    expect(calls.map((c) => c.id)).toEqual(['specialReady', 'specialReady']);
    expect(calls[0]!.pan).toBeLessThan(0);
    expect(calls[1]!.pan).toBeGreaterThan(0);
    expect(calls[1]!.detune).toBeGreaterThan(calls[0]!.detune);
  });
});

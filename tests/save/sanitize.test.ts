import { describe, expect, it } from 'vitest';
import overRaw from '../fixtures/saves/v1-overleveled.json?raw';
import validRaw from '../fixtures/saves/v2-valid.json?raw';
import { DEFAULT_BINDINGS } from '../../src/config/keys';
import { STARTER_VEHICLES } from '../../src/config/vehicles';
import { createDefaultSave, DEFAULT_SAVE } from '../../src/save/defaults';
import { safeJsonParse, sanitizeSave } from '../../src/save/sanitize';

function dataOf(raw: string): unknown {
  const env = safeJsonParse(raw) as { data: unknown };
  return env.data;
}

describe('safeJsonParse', () => {
  it('drops __proto__, constructor and prototype keys at every depth', () => {
    const parsed = safeJsonParse(
      '{"a":1,"__proto__":{"polluted":true},"b":{"constructor":{"x":1},"prototype":2,"c":3}}',
    ) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['a', 'b']);
    expect(Object.keys(parsed.b as object)).toEqual(['c']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
  });

  it('returns null on a syntax error', () => {
    expect(safeJsonParse('{"v":1,')).toBeNull();
    expect(safeJsonParse('')).toBeNull();
  });
});

describe('sanitizeSave', () => {
  it('keeps a valid save unchanged', () => {
    const r = sanitizeSave(dataOf(validRaw));
    expect(r.changed).toBe(false);
    expect(r.refunded).toBe(0);
    expect(r.data.cores).toBe(152);
    expect(r.data.meta).toEqual({ hullFw: 2, legendaryPool: 1 });
    expect(r.data.settings.frameCap).toBe(120);
    expect(r.data.bindings.players[0].fire).toEqual(['KeyF', 'Space']);
    expect(r.data.lastLoadout).toEqual([
      { player: 0, vehicle: 'specter' },
      { player: 1, vehicle: 'bulwark' },
    ]);
  });

  it('clamps over-levelled Firmware, refunds the excess spend and drops unknown ids', () => {
    const r = sanitizeSave(dataOf(overRaw));
    expect(r.changed).toBe(true);
    // v2: rerollCache is no longer a Firmware id, so (like bogusUpgrade) its whole spend is refunded.
    expect(r.data.meta).toEqual({ hullFw: 5, preCharge: 1 });
    // hullFw kept 300 of 400, rerollCache 300 and bogusUpgrade 50 refunded in full.
    expect(r.data.firmwareSpent).toEqual({ hullFw: 300, preCharge: 80 });
    expect(r.refunded).toBe(100 + 300 + 50);
    expect(r.data.cores).toBe(10 + 450);
  });

  it.each([null, undefined, 42, 'text', [], [1, 2], true])('garbage %j becomes the defaults', (raw) => {
    const r = sanitizeSave(raw);
    expect(r.data).toEqual(createDefaultSave());
    expect(r.changed).toBe(true);
  });

  it('coerces NaN, Infinity, negatives, fractions and 1e20', () => {
    const r = sanitizeSave({
      cores: 1e20,
      lifetimeCores: -5,
      meta: { hullFw: Number.NaN, bootCache: 2.7, overclockFw: -1, secondBoot: Number.POSITIVE_INFINITY },
      firmwareSpent: { bootCache: 45.9, secondBoot: 'x' },
      settings: {
        master: 7,
        music: -1,
        sfx: Number.NaN,
        screenShake: 0.25,
        quality: 'extreme',
        frameCap: 144,
      },
      records: { runs: 3.9, bestScore: -10, leaderboard: 'nope' },
      lastCommittedRunId: 12,
    });
    expect(r.data.cores).toBe(1_000_000_000);
    expect(r.data.lifetimeCores).toBe(0);
    expect(r.data.meta).toEqual({ bootCache: 2 }); // Infinity is not finite: level 0
    expect(r.data.firmwareSpent).toEqual({ bootCache: 45 });
    expect(r.data.settings).toMatchObject({ master: 1, music: 0, sfx: 0.8, screenShake: 0.25 });
    expect(r.data.settings.quality).toBe('high');
    expect(r.data.settings.frameCap).toBe('auto');
    expect(r.data.records.runs).toBe(3);
    expect(r.data.records.bestScore).toBe(0);
    expect(r.data.records.leaderboard).toEqual([]);
    expect(r.data.lastCommittedRunId).toBeNull();
  });

  it('dedupes unlocks, drops unknown vehicles and always keeps the starters', () => {
    const r = sanitizeSave({ unlocks: ['tinker', 'tinker', 'hovercar', 7] });
    expect(r.data.unlocks).toEqual([...STARTER_VEHICLES, 'tinker']);
  });

  it('drops loadout picks for locked or unknown vehicles and duplicate players', () => {
    const r = sanitizeSave({
      unlocks: ['specter'],
      lastLoadout: [
        { player: 1, vehicle: 'specter' },
        { player: 0, vehicle: 'tinker' },
        { player: 1, vehicle: 'lancer' },
        { player: 0, vehicle: 'bulwark' },
        'x',
      ],
      lastMode: 'battle',
    });
    expect(r.data.lastLoadout).toEqual([
      { player: 0, vehicle: 'bulwark' },
      { player: 1, vehicle: 'specter' },
    ]);
    expect(r.data.lastMode).toBe('solo');
  });

  it('resets invalid bindings per action and keeps valid custom ones', () => {
    const p0 = { ...DEFAULT_BINDINGS.players[0], fire: ['Escape'], dash: ['KeyZ'], up: [] };
    const r = sanitizeSave({ bindings: { players: [p0, { junk: true }], pause: ['KeyW'] } });
    expect(r.data.bindings.players[0].fire).toEqual(DEFAULT_BINDINGS.players[0].fire);
    expect(r.data.bindings.players[0].up).toEqual(DEFAULT_BINDINGS.players[0].up);
    expect(r.data.bindings.players[0].dash).toEqual(['KeyZ']);
    expect(r.data.bindings.players[1]).toEqual(DEFAULT_BINDINGS.players[1]);
    expect(r.data.bindings.pause).toEqual(DEFAULT_BINDINGS.pause);
    expect(sanitizeSave({ bindings: 'x' }).data.bindings).toEqual(DEFAULT_BINDINGS);
  });

  it('caps and sorts the leaderboard at 10 entries', () => {
    const entries = Array.from({ length: 15 }, (_, i) => ({
      score: i * 100,
      wave: i,
      date: i,
      players: i % 2 === 0 ? 1 : 2,
      mode: 'coop',
      vehicles: ['lancer', 'nope'],
    }));
    const r = sanitizeSave({ records: { leaderboard: [...entries, { score: 'x' }, null] } });
    const lb = r.data.records.leaderboard;
    expect(lb).toHaveLength(10);
    expect(lb[0]!.score).toBe(1400);
    expect(lb[9]!.score).toBe(500);
    expect(lb[0]!.vehicles).toEqual(['lancer']);
  });

  it('DEFAULT_SAVE is frozen and matches createDefaultSave', () => {
    expect(Object.isFrozen(DEFAULT_SAVE)).toBe(true);
    expect(createDefaultSave()).toEqual(DEFAULT_SAVE);
    expect(sanitizeSave(createDefaultSave()).changed).toBe(false);
  });
});

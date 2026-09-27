import { describe, expect, it } from 'vitest';
import { createFakeServices } from '../helpers/fakeServices';
import { FakeScheduler } from '../helpers/fakeClock';
import { FakeKeyTarget } from '../helpers/fakeKeyboard';
import { MemoryStorage, keyValueOf } from '../helpers/memoryStorage';
import { ScriptedIntents, StepScript } from '../helpers/scriptedIntents';
import { createSpyStates } from '../helpers/fakeStates';
import { testRunConfig } from '../helpers/fakeRun';

describe('test helpers', () => {
  it('FakeScheduler runs callbacks on the next frame only', () => {
    const s = new FakeScheduler();
    const seen: number[] = [];
    const loop = (ts: number): void => {
      seen.push(ts);
      s.request(loop);
    };
    s.request(loop);
    s.runFrames(3, 8);
    expect(seen).toEqual([8, 16, 24]);
    s.runDeltas([250]);
    expect(seen[3]).toBe(274);
  });

  it('FakeKeyTarget dispatches to capture listeners and reports preventDefault', () => {
    const t = new FakeKeyTarget();
    const codes: string[] = [];
    const fn = (e: { code: string; preventDefault(): void }): void => {
      codes.push(e.code);
      if (e.code === 'Space') e.preventDefault();
    };
    t.addEventListener('keydown', fn, { capture: true });
    expect(t.down('Space')).toBe(true);
    expect(t.down('KeyW')).toBe(false);
    t.removeEventListener('keydown', fn, { capture: true });
    t.down('KeyA');
    expect(codes).toEqual(['Space', 'KeyW']);
  });

  it('MemoryStorage injects quota and security failures', () => {
    const m = new MemoryStorage();
    const kv = keyValueOf(m);
    kv.set('a', '1');
    expect(kv.get('a')).toBe('1');
    m.failNextWrites = 1;
    expect(() => {
      kv.set('a', '2');
    }).toThrow(/quota/i);
    kv.set('a', '3');
    expect(m.rawGet('a')).toBe('3');
    m.failMode = 'security';
    expect(() => kv.get('a')).toThrow();
  });

  it('scripted intents are deterministic per seed', () => {
    const a = new ScriptedIntents('random', 5);
    const b = new ScriptedIntents('random', 5);
    for (let t = 0; t < 300; t++) expect({ ...a.at(t)[0] }).toEqual({ ...b.at(t)[0] });
    const s = new StepScript([
      { ticks: 2, p0: { fireHeld: true } },
      { ticks: 1, p1: { dashPressed: true } },
    ]);
    expect(s.totalTicks).toBe(3);
    expect(s.at(1)[0].fireHeld).toBe(true);
    expect(s.at(2)[1].dashPressed).toBe(true);
    expect(s.at(3)[1].dashPressed).toBe(false);
  });

  it('fake services wire a run factory and a static-validating FakeFsm', () => {
    const f = createFakeServices();
    expect(f.fsm.request('MainMenu')).toBe(true);
    expect(f.fsm.request('GameOver', { outcome: 'defeat' })).toBe(false);
    const run = f.services.createRun(testRunConfig({ mode: 'versus' }));
    expect(f.sessions).toHaveLength(1);
    expect(run.world.run.mode).toBe('versus');
    const shop = run.openShop().snapshot();
    expect(shop.teamVisible).toBe(false);
    expect(shop.players[0].team.every((t) => t.status === 'unavailable')).toBe(true);
    const log: string[] = [];
    const spies = createSpyStates(log);
    spies.Boot.enter(undefined, null);
    expect(log).toEqual(['Boot.enter(null)']);
  });
});

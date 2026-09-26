import { describe, expect, it } from 'vitest';
import { STATE_IDS, type StateId } from '../../src/contracts/states';
import { InvalidTransitionError } from '../../src/engine/StateMachine';
import { EDGES, findEdge } from '../../src/engine/transitions';
import { createRig, req, rigAt, validPayload, walk } from './fsmFixture';

/** Stack shapes per "from" state (UpgradesShop and Paused have two live shapes). */
const SHAPES_FOR: Readonly<Record<StateId, readonly string[]>> = {
  Boot: ['Boot'],
  MainMenu: ['MainMenu'],
  CharacterSelect: ['CharacterSelect'],
  Playing: ['Playing'],
  UpgradesShop: ['UpgradesShop{meta}', 'UpgradesShop{midrun}'],
  Paused: ['Paused/Playing', 'Paused/Shop'],
  GameOver: ['GameOver'],
};

describe('StateMachine: the 49 ordered pairs', () => {
  it('accepts exactly the listed edges with the right op and throws for every other pair', () => {
    let accepted = 0;
    let rejected = 0;
    for (const from of STATE_IDS) {
      for (const to of STATE_IDS) {
        const edge = findEdge(from, to);
        let ok = false;
        for (const shape of SHAPES_FOR[from]) {
          const { fsm } = rigAt(shape);
          const before = [...fsm.stack];
          if (edge?.op === 'pop') {
            // Pops never go through request(); they use requestPop().
            expect(() => req(fsm, to, undefined)).toThrow(InvalidTransitionError);
            if (before[before.length - 2] !== to) continue;
            expect(fsm.requestPop()).toBe(true);
            expect(fsm.applyPending()).toBe(1);
            expect(fsm.stack).toEqual(before.slice(0, -1));
            ok = true;
            continue;
          }
          const payload = validPayload(from, to);
          if (edge === null) {
            expect(() => req(fsm, to, payload), `${shape} -> ${to}`).toThrow(InvalidTransitionError);
            continue;
          }
          const guardOk = edge.guard === undefined || edge.guard(payload, before);
          if (!guardOk) {
            expect(() => req(fsm, to, payload)).toThrow(InvalidTransitionError);
            continue;
          }
          expect(req(fsm, to, payload)).toBe(true);
          expect(fsm.applyPending()).toBe(1);
          if (edge.op === 'push') expect(fsm.stack).toEqual([...before, to]);
          else expect(fsm.stack).toEqual([to]);
          ok = true;
        }
        if (edge === null) rejected++;
        else {
          expect(ok, `${from} -> ${to} should be reachable`).toBe(true);
          accepted++;
        }
      }
    }
    expect(accepted).toBe(EDGES.length);
    expect(rejected).toBe(49 - EDGES.length);
  });

  it('InvalidTransitionError carries from/to and a readable message', () => {
    const { fsm } = rigAt('MainMenu');
    try {
      req(fsm, 'GameOver', { outcome: 'defeat' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidTransitionError);
      const e = err as InvalidTransitionError;
      expect(e.from).toBe('MainMenu');
      expect(e.to).toBe('GameOver');
      expect(e.message).toMatch(/MainMenu -> GameOver/);
      expect(e.name).toBe('InvalidTransitionError');
    }
  });
});

describe('StateMachine: guards', () => {
  it('rejects a pop with no valid base below', () => {
    expect(() => rigAt('Playing').fsm.requestPop()).toThrow(/nothing below/);
    expect(() => rigAt('UpgradesShop{meta}').fsm.requestPop()).toThrow(InvalidTransitionError);
    expect(() => rigAt('Boot').fsm.requestPop()).toThrow(InvalidTransitionError);
  });

  it('pops Paused back to UpgradesShop when it was pushed over the shop', () => {
    const { fsm, log } = rigAt('Paused/Shop');
    expect(fsm.stack).toEqual(['Playing', 'UpgradesShop', 'Paused']);
    expect(fsm.requestPop()).toBe(true);
    fsm.applyPending();
    expect(fsm.stack).toEqual(['Playing', 'UpgradesShop']);
    expect(log).toEqual(['Paused.exit(UpgradesShop)', 'UpgradesShop.onUncovered(Paused)']);
  });

  it('checks payload guards', () => {
    expect(() => req(rigAt('MainMenu').fsm, 'UpgradesShop', { mode: 'midrun' })).toThrow(/guard/);
    expect(() => req(rigAt('Playing').fsm, 'UpgradesShop', { mode: 'meta' })).toThrow(/guard/);
    expect(() => req(rigAt('Playing').fsm, 'GameOver', { outcome: 'abandoned' })).toThrow(/guard/);
    expect(req(rigAt('Playing').fsm, 'GameOver', { outcome: 'victory' })).toBe(true);
    expect(() => req(rigAt('UpgradesShop{midrun}').fsm, 'GameOver', { outcome: 'defeat' })).toThrow();
    expect(() => req(rigAt('UpgradesShop{midrun}').fsm, 'MainMenu', undefined)).toThrow(/guard/);
    expect(() => req(rigAt('UpgradesShop{meta}').fsm, 'Paused', { reason: 'user' })).toThrow(/guard/);
    expect(() => req(rigAt('Paused/Playing').fsm, 'GameOver', { outcome: 'defeat' })).toThrow(/guard/);
  });

  it('non-strict mode logs and returns false instead of throwing', () => {
    const { fsm, logger } = rigAt('MainMenu', { strict: false });
    expect(req(fsm, 'GameOver', { outcome: 'defeat' })).toBe(false);
    expect(rigAt('Playing', { strict: false }).fsm.requestPop()).toBe(false);
    expect(logger.count('error')).toBe(1);
    expect(fsm.pendingCount).toBe(0);
  });
});

describe('StateMachine: queue semantics', () => {
  it('only enqueues: nothing changes until applyPending', () => {
    const { fsm, log } = rigAt('MainMenu');
    expect(req(fsm, 'CharacterSelect', { prefill: null, mode: null })).toBe(true);
    expect(fsm.top).toBe('MainMenu');
    expect(fsm.pendingCount).toBe(1);
    expect(log).toEqual([]);
    expect(fsm.applyPending()).toBe(1);
    expect(fsm.top).toBe('CharacterSelect');
    expect(fsm.pendingCount).toBe(0);
    expect(fsm.applyPending()).toBe(0);
  });

  it('re-validates at apply time: a Pause queued behind GameOver is dropped with a warning', () => {
    const { fsm, logger, input } = rigAt('Playing');
    expect(req(fsm, 'GameOver', { outcome: 'defeat' })).toBe(true);
    expect(req(fsm, 'Paused', { reason: 'blur' })).toBe(true);
    expect(fsm.applyPending()).toBe(1);
    expect(fsm.stack).toEqual(['GameOver']);
    expect(fsm.pendingCount).toBe(0);
    expect(logger.count('warn')).toBe(1);
    expect(input.clearEdges).toBe(1);
  });

  it('drops a stale duplicate (Boot -> MainMenu requested twice) and a stale pop', () => {
    const boot = rigAt('Boot');
    req(boot.fsm, 'MainMenu', undefined);
    req(boot.fsm, 'MainMenu', undefined);
    expect(boot.fsm.applyPending()).toBe(1);
    expect(boot.fsm.stack).toEqual(['MainMenu']);
    expect(boot.logger.count('warn')).toBe(1);

    const paused = rigAt('Paused/Playing', { strict: false });
    paused.fsm.requestPop();
    paused.fsm.requestPop();
    expect(paused.fsm.applyPending()).toBe(1);
    expect(paused.fsm.stack).toEqual(['Playing']);
    expect(paused.logger.count('debug')).toBe(1);
  });

  it('applies at most 4 transitions per frame, FIFO, and keeps the rest', () => {
    const edges = [...EDGES, { from: 'MainMenu', to: 'MainMenu', op: 'replace' } as const];
    const rig = createRig({ edges });
    rig.fsm.start();
    walk(rig.fsm, ['MainMenu']);
    rig.log.length = 0;
    for (let i = 0; i < 6; i++) req(rig.fsm, 'MainMenu', undefined);
    expect(rig.fsm.pendingCount).toBe(6);
    expect(rig.fsm.applyPending()).toBe(4);
    expect(rig.fsm.pendingCount).toBe(2);
    expect(rig.log.filter((l) => l === 'MainMenu.enter(MainMenu)')).toHaveLength(4);
    expect(rig.fsm.applyPending()).toBe(2);
    expect(rig.fsm.pendingCount).toBe(0);
  });

  it('defers requests made inside enter and exit to the next frame', () => {
    const { fsm, spies } = rigAt('Boot');
    spies.MainMenu.hooks.onEnter = () => {
      req(fsm, 'CharacterSelect', { prefill: null, mode: null });
    };
    req(fsm, 'MainMenu', undefined);
    expect(fsm.applyPending()).toBe(1);
    expect(fsm.top).toBe('MainMenu');
    expect(fsm.pendingCount).toBe(1);
    delete spies.MainMenu.hooks.onEnter;
    expect(fsm.applyPending()).toBe(1);
    expect(fsm.top).toBe('CharacterSelect');

    // Validated against the exiting top (CharacterSelect -> Playing is fine), stale once MainMenu is live.
    spies.CharacterSelect.hooks.onExit = () => {
      req(fsm, 'Playing', validPayload('CharacterSelect', 'Playing'));
    };
    req(fsm, 'MainMenu', undefined);
    expect(fsm.applyPending()).toBe(1);
    expect(fsm.top).toBe('MainMenu');
    expect(fsm.pendingCount).toBe(1);
    expect(fsm.applyPending()).toBe(0);
    expect(fsm.stack).toEqual(['MainMenu']);
    expect(fsm.pendingCount).toBe(0);
  });

  it('rejects re-entrant applyPending from a lifecycle hook and ignores applyPending before start', () => {
    const rig = createRig();
    expect(rig.fsm.applyPending()).toBe(0);
    rig.fsm.start();
    rig.spies.MainMenu.hooks.onEnter = () => {
      rig.fsm.applyPending();
    };
    req(rig.fsm, 'MainMenu', undefined);
    expect(() => rig.fsm.applyPending()).toThrow(/re-entered/);
    expect(() => {
      rig.fsm.start();
    }).toThrow(/twice/);
  });
});

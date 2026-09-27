import { describe, expect, it } from 'vitest';
import { STATE_IDS, type StateId } from '../../src/contracts/states';
import { createRng } from '../../src/core/rng';
import { EDGES, MAX_STACK_DEPTH, STATE_LAYERS, findEdge } from '../../src/engine/transitions';
import { InvalidTransitionError } from '../../src/engine/StateMachine';
import { createRig, req, rigAt, validPayload, walk } from './fsmFixture';

describe('StateMachine: lifecycle order (SpyState)', () => {
  it('start enters Boot with from = null', () => {
    const rig = createRig();
    expect(rig.fsm.stack).toEqual([]);
    expect(rig.fsm.top).toBe('Boot');
    rig.fsm.start();
    expect(rig.log).toEqual(['Boot.enter(null)']);
    expect(rig.fsm.stack).toEqual(['Boot']);
  });

  it('replace exits top to bottom then enters; push covers then enters; pop exits then uncovers', () => {
    const rig = createRig();
    rig.fsm.start();
    walk(rig.fsm, ['MainMenu', 'CharacterSelect', 'Playing', 'UpgradesShop', 'Paused', 'pop', 'Paused']);
    expect(rig.log).toEqual([
      'Boot.enter(null)',
      'Boot.exit(MainMenu)',
      'MainMenu.enter(Boot)',
      'MainMenu.exit(CharacterSelect)',
      'CharacterSelect.enter(MainMenu)',
      'CharacterSelect.exit(Playing)',
      'Playing.enter(CharacterSelect)',
      'Playing.onCovered(UpgradesShop)',
      'UpgradesShop.enter(Playing)',
      'UpgradesShop.onCovered(Paused)',
      'Paused.enter(UpgradesShop)',
      'Paused.exit(UpgradesShop)',
      'UpgradesShop.onUncovered(Paused)',
      'UpgradesShop.onCovered(Paused)',
      'Paused.enter(UpgradesShop)',
    ]);
    rig.log.length = 0;
    walk(rig.fsm, ['GameOver']);
    expect(rig.log).toEqual([
      'Paused.exit(GameOver)',
      'UpgradesShop.exit(GameOver)',
      'Playing.exit(GameOver)',
      'GameOver.enter(Paused)',
    ]);
    expect(rig.fsm.stack).toEqual(['GameOver']);
    expect(rig.spies.GameOver.payloads).toEqual([{ outcome: 'abandoned' }]);
  });

  it('passes payloads to enter', () => {
    const { fsm, spies } = rigAt('Playing');
    req(fsm, 'Paused', { reason: 'hidden' });
    fsm.applyPending();
    expect(spies.Paused.payloads).toEqual([{ reason: 'hidden' }]);
  });

  it('calls clearEdges then suppressHeldUntilRelease after every applied transition only', () => {
    const rig = createRig();
    rig.fsm.start();
    expect(rig.input.clearEdges).toBe(0);
    walk(rig.fsm, ['MainMenu', 'CharacterSelect', 'Playing', 'Paused', 'pop']);
    expect(rig.input.clearEdges).toBe(5);
    expect(rig.input.suppress).toBe(5);
    expect(rig.input.order.slice(0, 2)).toEqual(['clearEdges', 'suppress']);
    req(rig.fsm, 'Paused', { reason: 'user' });
    req(rig.fsm, 'Paused', { reason: 'user' });
    rig.fsm.applyPending();
    expect(rig.input.clearEdges).toBe(6);
  });
});

describe('StateMachine: per-frame dispatch', () => {
  it('runs fixedUpdate and update on the top state only', () => {
    const { fsm, log } = rigAt('Paused/Shop');
    fsm.fixedUpdate(1 / 120);
    fsm.update(0.016);
    expect(log).toEqual(['Paused.fixedUpdate', 'Paused.update']);
  });

  it('renders the top base state, nothing under a frozen overlay, and a depth-1 meta Hangar', () => {
    const playing = rigAt('Playing');
    playing.fsm.render(0.5, 0.016);
    expect(playing.log).toEqual(['Playing.render']);

    const paused = rigAt('Paused/Playing');
    paused.fsm.render(0.5, 0.016);
    const shop = rigAt('UpgradesShop{midrun}');
    shop.fsm.render(0.5, 0.016);
    expect(paused.log).toEqual([]);
    expect(shop.log).toEqual([]);

    const hangar = rigAt('UpgradesShop{meta}');
    hangar.fsm.render(0.5, 0.016);
    expect(hangar.log).toEqual(['UpgradesShop.render']);
  });

  it('dispatch before start is a no-op', () => {
    const rig = createRig();
    rig.fsm.fixedUpdate(1);
    rig.fsm.update(1);
    rig.fsm.render(0, 1);
    expect(rig.log).toEqual([]);
  });
});

describe('StateMachine: stack depth', () => {
  it('refuses a push beyond MAX_STACK_DEPTH even when an edge would allow it', () => {
    const edges = [...EDGES, { from: 'Paused', to: 'Paused', op: 'push' } as const];
    const rig = createRig({ edges });
    rig.fsm.start();
    walk(rig.fsm, ['MainMenu', 'CharacterSelect', 'Playing', 'Paused', 'Paused']);
    expect(rig.fsm.stack).toEqual(['Playing', 'Paused', 'Paused']);
    expect(() => req(rig.fsm, 'Paused', { reason: 'user' })).toThrow(/depth/);
  });

  it('random walks never exceed depth 3 and keep a base at the bottom', () => {
    const r = createRng(1234);
    const rng = (): number => r.next();
    for (let run = 0; run < 20; run++) {
      const rig = createRig({ strict: false });
      rig.fsm.start();
      for (let i = 0; i < 400; i++) {
        const from = rig.fsm.top;
        const burst = 1 + Math.floor(rng() * 3);
        for (let b = 0; b < burst; b++) {
          const to = STATE_IDS[Math.floor(rng() * STATE_IDS.length)]!;
          const e = findEdge(from, to);
          if (e?.op === 'pop') rig.fsm.requestPop();
          else if (e !== null) req(rig.fsm, to, validPayload(from, to));
        }
        rig.fsm.applyPending();
        const stack = rig.fsm.stack;
        expect(stack.length).toBeGreaterThanOrEqual(1);
        expect(stack.length).toBeLessThanOrEqual(MAX_STACK_DEPTH);
        for (let d = 1; d < stack.length; d++) expect(STATE_LAYERS[stack[d]!]).toBe('overlay');
        if (stack.length > 1) expect(stack[0]).toBe<StateId>('Playing');
      }
    }
  });

  it('never throws on stale requests in strict mode (only static checks throw)', () => {
    const { fsm } = rigAt('Playing');
    req(fsm, 'GameOver', { outcome: 'defeat' });
    req(fsm, 'UpgradesShop', { mode: 'midrun' });
    expect(() => fsm.applyPending()).not.toThrow();
    expect(() => fsm.requestPop()).toThrow(InvalidTransitionError);
  });
});

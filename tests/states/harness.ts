/**
 * States test rig: the 7 real states over createFakeServices(), driven by the real engine StateMachine
 * (strict mode) instead of FakeFsm, plus frame / navigation helpers used by the flow tests.
 */
import type { MenuIntent } from '../../src/contracts/input';
import type { Services } from '../../src/contracts/services';
import type { PayloadArg, StateId, StateMachineApi } from '../../src/contracts/states';
import { createStateMachine, type StateMachine } from '../../src/engine/StateMachine';
import { createBootState } from '../../src/states/BootState';
import { createCharacterSelectState } from '../../src/states/CharacterSelectState';
import { createGameOverState } from '../../src/states/GameOverState';
import { createMainMenuState } from '../../src/states/MainMenuState';
import { createPausedState } from '../../src/states/PausedState';
import { createPlayingState } from '../../src/states/PlayingState';
import { createUpgradesShopState } from '../../src/states/UpgradesShopState';
import type { FakeRunSession, FakeShop } from '../helpers/fakeRun';
import type { FakeSaveStore } from '../helpers/fakeSave';
import { createFakeServices, type FakeServiceSet } from '../helpers/fakeServices';

export const FRAME_S = 1 / 60;

export interface Harness {
  readonly set: FakeServiceSet;
  readonly services: Services;
  readonly fsm: StateMachine;
  /** One frame: applyPending, 2 fixed steps, update, render. */
  frame(dtS?: number): void;
  frames(n: number, dtS?: number): void;
  /** Queues menu intents and runs one frame. */
  press(...intents: MenuIntent[]): void;
  readonly top: StateId;
  readonly stack: readonly StateId[];
  session(i?: number): FakeRunSession;
  shop(): FakeShop;
}

/** Lets pending promise continuations (Boot pipeline, audio unlock) run. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise<void>((r) => setTimeout(r, 0));
}

export function createHarness(o: { save?: FakeSaveStore; seed?: number } = {}): Harness {
  const set = createFakeServices(o);
  let real: StateMachine | null = null;
  const machine = (): StateMachine => {
    if (real === null) throw new Error('FSM not built');
    return real;
  };
  const proxy: StateMachineApi = {
    request<S extends StateId>(to: S, ...payload: PayloadArg<S>): boolean {
      return machine().request(to, ...payload);
    },
    requestPop: () => machine().requestPop(),
    get top() {
      return machine().top;
    },
    get stack() {
      return machine().stack;
    },
  };
  const services: Services = { ...set.services, fsm: proxy };
  real = createStateMachine({
    states: {
      Boot: createBootState(services),
      MainMenu: createMainMenuState(services),
      CharacterSelect: createCharacterSelectState(services),
      Playing: createPlayingState(services),
      UpgradesShop: createUpgradesShopState(services),
      Paused: createPausedState(services),
      GameOver: createGameOverState(services),
    },
    input: set.input,
    log: set.log,
    strict: true,
  });
  const fsm = real;
  const frame = (dtS = FRAME_S): void => {
    fsm.applyPending();
    fsm.fixedUpdate(1 / 120);
    fsm.fixedUpdate(1 / 120);
    fsm.update(dtS);
    fsm.render(0.5, dtS);
    set.clock.advance(dtS * 1000);
  };
  return {
    set,
    services,
    fsm,
    frame,
    frames(n: number, dtS = FRAME_S): void {
      for (let i = 0; i < n; i++) frame(dtS);
    },
    press(...intents: MenuIntent[]): void {
      set.input.queueMenu(...intents);
      frame();
    },
    get top() {
      return fsm.top;
    },
    get stack() {
      return fsm.stack;
    },
    session(i?: number): FakeRunSession {
      const list = set.sessions;
      const s = list[i ?? list.length - 1];
      if (s === undefined) throw new Error('no run session');
      return s;
    },
    shop(): FakeShop {
      const list = set.sessions;
      const s = list[list.length - 1];
      const shop = s?.shops[s.shops.length - 1];
      if (shop === undefined) throw new Error('no shop');
      return shop;
    },
  };
}

/** Boot -> MainMenu (press any key, audio unlock). */
export async function bootToMenu(h: Harness): Promise<void> {
  h.fsm.start();
  await settle();
  h.frame();
  h.set.input.pressAnyKey();
  h.frame();
  await settle();
  h.frame();
  h.frame();
}

/** MainMenu -> CharacterSelect -> Playing. `p2` joins P2; `versus` switches the mode row. */
export function menuToPlaying(h: Harness, o: { p2?: boolean; versus?: boolean } = {}): void {
  h.press({ player: 'any', kind: 'confirm' });
  h.frame();
  if (o.p2 === true) h.press({ player: 1, kind: 'confirm' });
  if (o.versus === true) {
    h.press({ player: 1, kind: 'down' });
    h.press({ player: 1, kind: 'right' });
  }
  h.press({ player: 0, kind: 'ready' });
  if (o.p2 === true) h.press({ player: 1, kind: 'ready' });
  h.frames(45);
}

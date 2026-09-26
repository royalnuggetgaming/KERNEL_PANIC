/** Deterministic PlayerIntent sequences for sim tests (determinism, soak, economy, systems). */
import type { Intents, PlayerIntent } from '../../src/contracts/input';
import type { Rng } from '../../src/contracts/sim';
import { createRng } from '../../src/core/rng';

export function createIntent(): PlayerIntent {
  return { moveX: 0, moveZ: 0, fireHeld: false, focusHeld: false, dashPressed: false, specialPressed: false };
}

export function createIntents(): [PlayerIntent, PlayerIntent] {
  return [createIntent(), createIntent()];
}

export function resetIntent(i: PlayerIntent): void {
  i.moveX = 0;
  i.moveZ = 0;
  i.fireHeld = false;
  i.focusHeld = false;
  i.dashPressed = false;
  i.specialPressed = false;
}

export function setIntent(i: PlayerIntent, patch: Partial<PlayerIntent>): PlayerIntent {
  Object.assign(i, patch);
  return i;
}

export type IntentPattern = 'idle' | 'fire' | 'kite' | 'random';

export interface ScriptStep {
  /** Number of ticks this step lasts. */
  readonly ticks: number;
  readonly p0?: Partial<PlayerIntent>;
  readonly p1?: Partial<PlayerIntent>;
}

/**
 * Fills a reusable intent pair per tick. Patterns:
 * - idle: nothing held; fire: stand still and shoot;
 * - kite: circle strafing while firing, dash every 2 s, special every 12 s;
 * - random: seeded direction changes every 30 ticks, fire always, occasional dash/special.
 */
export class ScriptedIntents {
  readonly intents: [PlayerIntent, PlayerIntent] = createIntents();
  private readonly rng: Rng;
  private readonly dirs = new Float64Array(4);

  private readonly pattern: IntentPattern;

  constructor(pattern: IntentPattern, seed = 1) {
    this.pattern = pattern;
    this.rng = createRng(seed).fork('intents');
  }

  /** Returns the shared intents filled for `tick` (call once per tick, in tick order). */
  at(tick: number): Intents {
    for (let p = 0; p < 2; p++) {
      const i = this.intents[p]!;
      resetIntent(i);
      switch (this.pattern) {
        case 'idle':
          break;
        case 'fire':
          i.fireHeld = true;
          break;
        case 'kite': {
          const a = tick / 120 + p * Math.PI;
          i.moveX = Math.cos(a);
          i.moveZ = Math.sin(a);
          i.fireHeld = true;
          i.dashPressed = tick % 240 === 60 * (p + 1);
          i.specialPressed = tick % 1440 === 600 + p * 120;
          break;
        }
        case 'random': {
          if (tick % 30 === 0) {
            const a = this.rng.range(0, Math.PI * 2);
            const m = this.rng.chance(0.2) ? 0 : 1;
            this.dirs[p * 2] = Math.cos(a) * m;
            this.dirs[p * 2 + 1] = Math.sin(a) * m;
          }
          i.moveX = this.dirs[p * 2]!;
          i.moveZ = this.dirs[p * 2 + 1]!;
          i.fireHeld = true;
          i.focusHeld = this.rng.chance(0.1);
          i.dashPressed = this.rng.chance(1 / 180);
          i.specialPressed = this.rng.chance(1 / 900);
          break;
        }
      }
    }
    return this.intents;
  }
}

/** Expands explicit steps into per-tick intents: at(tick) returns the step covering that tick (idle after). */
export class StepScript {
  readonly intents: [PlayerIntent, PlayerIntent] = createIntents();
  private readonly ends: number[] = [];

  private readonly steps: readonly ScriptStep[];

  constructor(steps: readonly ScriptStep[]) {
    this.steps = steps;
    let t = 0;
    for (const s of steps) {
      t += s.ticks;
      this.ends.push(t);
    }
  }

  get totalTicks(): number {
    return this.ends[this.ends.length - 1] ?? 0;
  }

  at(tick: number): Intents {
    resetIntent(this.intents[0]);
    resetIntent(this.intents[1]);
    for (let k = 0; k < this.steps.length; k++) {
      if (tick < this.ends[k]!) {
        const s = this.steps[k]!;
        if (s.p0) Object.assign(this.intents[0], s.p0);
        if (s.p1) Object.assign(this.intents[1], s.p1);
        break;
      }
    }
    return this.intents;
  }
}

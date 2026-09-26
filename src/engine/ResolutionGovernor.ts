/**
 * Resolution governor, a pure policy (plan section 10.4). Ladder: renderScale 1 -> 0.85 -> 0.72 -> 0.6, then
 * MSAA 4 -> 2 (only when the preset uses 4x), then a 60 frame cap. Steps down when p95 stays above
 * GOVERNOR.STEP_DOWN_P95_MS for STEP_DOWN_AFTER_S, steps up after STEP_UP_AFTER_S clean, at most one step per
 * MIN_STEP_INTERVAL_S, and evaluates only while Playing. Actions are preallocated (no per-call allocation).
 */
import { GOVERNOR, type QualityPreset } from '../config/quality';

export type GovernorAction =
  | { readonly kind: 'renderScale'; readonly value: number }
  | { readonly kind: 'msaa'; readonly value: 0 | 2 | 4 }
  | { readonly kind: 'frameCap'; readonly value: 60 | null };

export interface ResolutionGovernor {
  /** At most one action per GOVERNOR.MIN_STEP_INTERVAL_S; evaluates only while playing. */
  evaluate(nowS: number, p95Ms: number, playing: boolean): GovernorAction | null;
  readonly step: number;
  /** Extra: number of step-down levels for the current preset (step ranges 0..maxStep). */
  readonly maxStep: number;
  reset(preset: QualityPreset): void;
}

/**
 * "Clean" for step-up purposes means p95 at or below this fraction of the step-down threshold. The gap between
 * the two thresholds is the hysteresis band that stops a load hovering at the threshold from oscillating.
 */
export const GOVERNOR_CLEAN_RATIO = 0.9;

const ACT_SCALE: readonly GovernorAction[] = GOVERNOR.RENDER_SCALES.map(
  (value): GovernorAction => Object.freeze({ kind: 'renderScale', value }),
);
const ACT_MSAA_2: GovernorAction = Object.freeze({ kind: 'msaa', value: 2 });
const ACT_MSAA_4: GovernorAction = Object.freeze({ kind: 'msaa', value: 4 });
const ACT_CAP_60: GovernorAction = Object.freeze({ kind: 'frameCap', value: 60 });
const ACT_CAP_NONE: GovernorAction = Object.freeze({ kind: 'frameCap', value: null });

/**
 * Builds the ladder for a preset. `down[i]` is the action that moves from step i to i+1; `up[i]` moves from
 * step i+1 back to step i.
 */
function buildLadder(preset: QualityPreset): {
  down: readonly GovernorAction[];
  up: readonly GovernorAction[];
} {
  const down: GovernorAction[] = [];
  const up: GovernorAction[] = [];
  for (let i = 1; i < ACT_SCALE.length; i++) {
    down.push(ACT_SCALE[i]!);
    up.push(ACT_SCALE[i - 1]!);
  }
  if (preset.msaa === 4) {
    down.push(ACT_MSAA_2);
    up.push(ACT_MSAA_4);
  }
  down.push(ACT_CAP_60);
  up.push(ACT_CAP_NONE);
  return { down, up };
}

class StepGovernor implements ResolutionGovernor {
  private down: readonly GovernorAction[] = [];
  private up: readonly GovernorAction[] = [];
  private current = 0;
  /** Seconds (nowS >= 0); -1 = not timing. */
  private overSince = -1;
  private cleanSince = -1;
  private lastStepAt = Number.NEGATIVE_INFINITY;

  constructor(preset: QualityPreset) {
    this.reset(preset);
  }

  get step(): number {
    return this.current;
  }

  get maxStep(): number {
    return this.down.length;
  }

  reset(preset: QualityPreset): void {
    const ladder = buildLadder(preset);
    this.down = ladder.down;
    this.up = ladder.up;
    this.current = 0;
    this.overSince = -1;
    this.cleanSince = -1;
    this.lastStepAt = Number.NEGATIVE_INFINITY;
  }

  evaluate(nowS: number, p95Ms: number, playing: boolean): GovernorAction | null {
    if (!playing) {
      // Menus, pause and the shop are not representative load: restart both timers when play resumes.
      this.overSince = -1;
      this.cleanSince = -1;
      return null;
    }
    const canStep = nowS - this.lastStepAt >= GOVERNOR.MIN_STEP_INTERVAL_S;
    if (p95Ms > GOVERNOR.STEP_DOWN_P95_MS) {
      this.cleanSince = -1;
      if (this.overSince < 0) this.overSince = nowS;
      if (
        canStep &&
        this.current < this.down.length &&
        nowS - this.overSince >= GOVERNOR.STEP_DOWN_AFTER_S
      ) {
        const action = this.down[this.current]!;
        this.current++;
        this.lastStepAt = nowS;
        this.overSince = nowS;
        return action;
      }
      return null;
    }
    this.overSince = -1;
    if (p95Ms > GOVERNOR.STEP_DOWN_P95_MS * GOVERNOR_CLEAN_RATIO) {
      this.cleanSince = -1;
      return null;
    }
    if (this.cleanSince < 0) this.cleanSince = nowS;
    if (canStep && this.current > 0 && nowS - this.cleanSince >= GOVERNOR.STEP_UP_AFTER_S) {
      this.current--;
      this.lastStepAt = nowS;
      this.cleanSince = nowS;
      return this.up[this.current]!;
    }
    return null;
  }
}

export function createResolutionGovernor(preset: QualityPreset): ResolutionGovernor {
  return new StepGovernor(preset);
}

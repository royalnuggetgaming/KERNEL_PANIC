/** Render quality presets (plan section 10.4) and the resolution-governor ladder. */
import type { QualityLevel } from '../contracts/save';

export interface QualityPreset {
  readonly dprCap: number;
  /** MSAA samples on the HDR scene target (0 = none, FXAA in composite). */
  readonly msaa: 0 | 2 | 4;
  /** Bloom chain start resolution as a fraction of the scene target. */
  readonly bloomRes: 0.5 | 0.25;
  readonly particleCap: number;
  readonly fxaa: boolean;
}

export const QUALITY_PRESETS = {
  low: { dprCap: 1, msaa: 0, bloomRes: 0.25, particleCap: 4096, fxaa: true },
  medium: { dprCap: 1.25, msaa: 2, bloomRes: 0.5, particleCap: 8192, fxaa: false },
  high: { dprCap: 1.5, msaa: 4, bloomRes: 0.5, particleCap: 8192, fxaa: false },
  ultra: { dprCap: 2, msaa: 4, bloomRes: 0.5, particleCap: 8192, fxaa: false },
} as const satisfies Readonly<Record<QualityLevel, QualityPreset>>;

export const DEFAULT_QUALITY: QualityLevel = 'high';

export const GOVERNOR = {
  /** renderScale steps, then MSAA 4 -> 2, then a 60 cap. */
  RENDER_SCALES: [1, 0.85, 0.72, 0.6],
  STEP_DOWN_P95_MS: 16,
  STEP_DOWN_AFTER_S: 1,
  STEP_UP_AFTER_S: 10,
  MIN_STEP_INTERVAL_S: 2,
} as const;

export const PERF = {
  RING_FRAMES: 600,
  LONG_FRAME_MS: 33,
  /** FramePacer auto: fall back to a 60 cap when missed vsyncs exceed this ratio over the window. */
  MISSED_VSYNC_RATIO: 0.05,
  MISSED_VSYNC_WINDOW_S: 2,
} as const;

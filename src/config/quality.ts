/** Render quality presets (plan section 10.4), the resolution-governor ladder and the Chromebook auto-detect. */
import type { FrameCap, QualityLevel } from '../contracts/save';

export interface QualityPreset {
  readonly dprCap: number;
  /** MSAA samples on the HDR scene target (0 = none, FXAA in composite). */
  readonly msaa: 0 | 2 | 4;
  /** Bloom chain start resolution as a fraction of the scene target. */
  readonly bloomRes: 0.5 | 0.25;
  /** Kawase downsample levels in the bloom chain (render/PostFX BLOOM_DOWNSAMPLES is the maximum). */
  readonly bloomLevels: number;
  readonly particleCap: number;
  readonly fxaa: boolean;
  /** Pure-FX budgets: damage digits spawned per frame, live digit records, live shockwave records. */
  readonly digitsPerFrame: number;
  readonly digitCap: number;
  readonly shockwaveCap: number;
  /** Lowest render scale the ResolutionGovernor may step down to. */
  readonly renderScaleFloor: number;
  /** Frame-rate ceiling the preset imposes on the FRAME CAP setting (null = none). */
  readonly maxFps: 60 | null;
  /**
   * LOW_FX shader variant for floor/sky/neonSurface (fewer FBM octaves, no Voronoi layers). A compile-time
   * define, fixed at Boot from the quality the app starts with (a change applies after a restart).
   */
  readonly lowFx: boolean;
}

const FULL_FX = {
  bloomLevels: 4,
  digitsPerFrame: 24,
  digitCap: 256,
  shockwaveCap: 32,
  renderScaleFloor: 0.6,
  maxFps: null,
  lowFx: false,
} as const;

export const QUALITY_PRESETS = {
  low: { dprCap: 1, msaa: 0, bloomRes: 0.25, particleCap: 4096, fxaa: true, ...FULL_FX },
  medium: { dprCap: 1.25, msaa: 2, bloomRes: 0.5, particleCap: 8192, fxaa: false, ...FULL_FX },
  high: { dprCap: 1.5, msaa: 4, bloomRes: 0.5, particleCap: 8192, fxaa: false, ...FULL_FX },
  ultra: { dprCap: 2, msaa: 4, bloomRes: 0.5, particleCap: 8192, fxaa: false, ...FULL_FX },
  /** Intel UHD (Celeron N4500/N5100) at 1366x768, DPR 1. Gameplay is identical; only pure FX are trimmed. */
  chromebook: {
    dprCap: 1,
    msaa: 0,
    bloomRes: 0.25,
    bloomLevels: 2,
    particleCap: 2048,
    fxaa: true,
    digitsPerFrame: 10,
    digitCap: 96,
    shockwaveCap: 12,
    renderScaleFloor: 0.5,
    maxFps: 60,
    lowFx: true,
  },
} as const satisfies Readonly<Record<QualityLevel, QualityPreset>>;

export const DEFAULT_QUALITY: QualityLevel = 'high';
export const CHROMEBOOK_QUALITY: QualityLevel = 'chromebook';
export const CHROMEBOOK_TOAST = 'Chromebook mode on — change in Settings > Quality';

export const GOVERNOR = {
  /** renderScale steps (cut at the preset's renderScaleFloor), then MSAA 4 -> 2, then a 60 cap. */
  RENDER_SCALES: [1, 0.85, 0.72, 0.6, 0.5],
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

/** The FRAME CAP setting clamped by the preset's maxFps ('auto', 120 and 'uncapped' become 60 on Chromebook). */
export function effectiveFrameCap(cap: FrameCap, preset: QualityPreset): FrameCap {
  return preset.maxFps ?? cap;
}

/** What app/createServices reads from the browser (navigator), passed in so detection stays pure. */
export interface PlatformHints {
  readonly userAgent: string;
  /** navigator.userAgentData.platform where available ('Chrome OS'), else null. */
  readonly uaPlatform: string | null;
  /** navigator.hardwareConcurrency (0 when unknown). */
  readonly hardwareConcurrency: number;
}

/** ChromeOS ('CrOS' in the UA, or the UA-CH platform) with at most 4 logical cores (Celeron N4500 / N5100). */
export function isLowPowerChromebook(h: PlatformHints): boolean {
  const chromeOs =
    h.userAgent.includes('CrOS') || h.uaPlatform === 'Chrome OS' || h.uaPlatform === 'ChromeOS';
  return chromeOs && h.hardwareConcurrency > 0 && h.hardwareConcurrency <= 4;
}

/** Parses ?quality=<level> (case-insensitive); null when absent or unknown. */
export function parseQualityOverride(
  raw: string | null,
  levels: readonly QualityLevel[],
): QualityLevel | null {
  if (raw === null) return null;
  const v = raw.trim().toLowerCase();
  for (let i = 0; i < levels.length; i++) if (levels[i] === v) return levels[i]!;
  return null;
}

export interface BootQuality {
  /** The quality the app starts with (shader variant, first applySettings). */
  readonly quality: QualityLevel;
  /** True when a first boot on a detected Chromebook picked 'chromebook' (saved and toasted). */
  readonly autoChromebook: boolean;
}

/**
 * Boot-time quality: the URL override wins (testing, never saved); then the user's saved choice (never
 * overridden); a first boot (no save yet) on a low-power Chromebook gets 'chromebook'; otherwise the default.
 */
export function chooseBootQuality(
  saved: QualityLevel | null,
  override: QualityLevel | null,
  hints: PlatformHints,
): BootQuality {
  if (override !== null) return { quality: override, autoChromebook: false };
  if (saved !== null) return { quality: saved, autoChromebook: false };
  if (isLowPowerChromebook(hints)) return { quality: CHROMEBOOK_QUALITY, autoChromebook: true };
  return { quality: DEFAULT_QUALITY, autoChromebook: false };
}

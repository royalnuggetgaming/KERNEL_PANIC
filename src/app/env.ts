/**
 * App environment from the URL query (pure: createServices passes location.search and the DEV flag).
 * ?debug=1 enables the dev API and the debug overlay; ?seed=N overrides the crypto run seeds; ?quality=<level>
 * (e.g. chromebook) forces a quality preset for this session without saving it (testing).
 */
import { QUALITY_LEVELS, type QualityLevel } from '../contracts/save';
import type { AppEnv } from '../contracts/services';
import { parseQualityOverride } from '../config/quality';

export const APP_VERSION = '0.1.0';

/** Mutable seed override behind AppEnv.seedOverride (the dev API's setSeed changes it at runtime). */
export interface SeedOverride {
  value: number | null;
}

function parseSeed(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(Math.abs(n)) >>> 0;
}

function flagOn(raw: string | null): boolean {
  return raw === '1' || raw === 'true' || raw === '';
}

/** The shader variant compiled at Boot (set once by createServices before anything reads AppEnv.lowFx). */
export interface ShaderVariant {
  lowFx: boolean;
}

export interface ParsedEnv {
  readonly env: AppEnv;
  readonly seed: SeedOverride;
  /** ?quality=<level>, or null. */
  readonly quality: QualityLevel | null;
  readonly variant: ShaderVariant;
}

export function parseEnv(search: string, dev: boolean): ParsedEnv {
  const q = new URLSearchParams(search);
  const seed: SeedOverride = { value: parseSeed(q.get('seed')) };
  const variant: ShaderVariant = { lowFx: false };
  const debug = dev || (q.has('debug') && flagOn(q.get('debug')));
  const env: AppEnv = {
    debug,
    get seedOverride(): number | null {
      return seed.value;
    },
    strict: dev,
    version: APP_VERSION,
    get lowFx(): boolean {
      return variant.lowFx;
    },
  };
  return { env, seed, quality: parseQualityOverride(q.get('quality'), QUALITY_LEVELS), variant };
}

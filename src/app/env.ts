/**
 * App environment from the URL query (pure: createServices passes location.search and the DEV flag).
 * ?debug=1 enables the dev API and the debug overlay; ?seed=N overrides the crypto run seeds.
 */
import type { AppEnv } from '../contracts/services';

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

export interface ParsedEnv {
  readonly env: AppEnv;
  readonly seed: SeedOverride;
}

export function parseEnv(search: string, dev: boolean): ParsedEnv {
  const q = new URLSearchParams(search);
  const seed: SeedOverride = { value: parseSeed(q.get('seed')) };
  const debug = dev || (q.has('debug') && flagOn(q.get('debug')));
  const env: AppEnv = {
    debug,
    get seedOverride(): number | null {
      return seed.value;
    },
    strict: dev,
    version: APP_VERSION,
  };
  return { env, seed };
}

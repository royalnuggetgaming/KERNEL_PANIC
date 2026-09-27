/**
 * Save migration chain: registry[v] is a pure v -> v + 1 step. Version 1 is the first shipped format, so the
 * production registry is empty until SaveDataV2 exists; tests inject their own registries.
 */
import { CURRENT_SAVE_VERSION, type Migration } from '../contracts/save';

export const MIGRATIONS: Readonly<Record<number, Migration>> = Object.freeze({});

/** Applies registry[v] for v = from .. target-1. Throws on a missing step or a version above the target. */
export function migrate(
  data: unknown,
  fromVersion: number,
  registry: Readonly<Record<number, Migration>> = MIGRATIONS,
  target: number = CURRENT_SAVE_VERSION,
): unknown {
  if (!Number.isSafeInteger(fromVersion) || fromVersion < 0)
    throw new RangeError(`migrate: invalid source version ${fromVersion}`);
  if (fromVersion > target) throw new RangeError(`migrate: version ${fromVersion} is newer than ${target}`);
  let out = data;
  for (let v = fromVersion; v < target; v++) {
    const step = Object.prototype.hasOwnProperty.call(registry, v) ? registry[v] : undefined;
    if (step === undefined) throw new RangeError(`migrate: no migration from v${v} to v${v + 1}`);
    out = step(out);
  }
  return out;
}

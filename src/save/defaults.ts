/** Default settings and the fresh-profile SaveDataV1 (plan section 6 "SaveDataV1 contents"). */
import type { SaveDataV1, Settings } from '../contracts/save';
import { DEFAULT_BINDINGS } from '../config/keys';
import { STARTER_VEHICLES } from '../config/vehicles';

export const DEFAULT_SETTINGS: Settings = Object.freeze({
  master: 0.8,
  music: 0.7,
  sfx: 0.8,
  quality: 'high',
  frameCap: 'auto',
  screenShake: 1,
  reduceFlashes: false,
  reduceMotion: false,
  colorblind: false,
  autofire: Object.freeze([true, true] as const),
  focusToggle: Object.freeze([false, false] as const),
  showFps: false,
  themeId: 'kernelPanic',
});

/** A fresh, independent default profile (safe to spread and modify). */
export function createDefaultSave(): SaveDataV1 {
  return {
    cores: 0,
    lifetimeCores: 0,
    meta: {},
    firmwareSpent: {},
    unlocks: [...STARTER_VEHICLES],
    settings: { ...DEFAULT_SETTINGS, autofire: [true, true], focusToggle: [false, false] },
    bindings: DEFAULT_BINDINGS,
    lastLoadout: [],
    lastMode: 'solo',
    records: { runs: 0, victories: 0, bestWave: 0, bestScore: 0, versusMatches: 0, leaderboard: [] },
    lastCommittedRunId: null,
  };
}

export const DEFAULT_SAVE: SaveDataV1 = Object.freeze(createDefaultSave());

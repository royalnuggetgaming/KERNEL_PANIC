/**
 * Pure save helpers for TERMINAL cheats: unlocking by code, ON/OFF toggles and the list a new run snapshots.
 * Cheats never apply in versus (see sim/runSetup.ts runCheats).
 */
import { CHEAT_IDS, type CheatId, type RunMode } from '../contracts/ids';
import type { CheatSave, SaveDataV1, SaveDelta } from '../contracts/save';
import { cheatDef } from '../config/cheats';

const NONE: CheatSave = { unlocked: [], enabled: [] };

export function cheatsOf(save: SaveDataV1): CheatSave {
  return save.cheats ?? NONE;
}

/** Parses 'cheat:<id>' pointer/item ids. */
export function cheatIdOf(itemId: string | null, prefix: string): CheatId | null {
  if (itemId === null || !itemId.startsWith(prefix)) return null;
  const rest = itemId.slice(prefix.length);
  for (const id of CHEAT_IDS) if (id === rest) return id;
  return null;
}

/** Unlocks (if needed) and switches a cheat on. */
export function cheatUnlockDelta(save: SaveDataV1, id: CheatId): SaveDelta {
  const c = cheatsOf(save);
  const unlocked = c.unlocked.includes(id) ? [...c.unlocked] : [...c.unlocked, id];
  const enabled = c.enabled.includes(id) ? [...c.enabled] : [...c.enabled, id];
  return { cheats: { unlocked, enabled } };
}

/** Flips an unlocked cheat ON/OFF (no-op delta for a locked one). */
export function cheatToggleDelta(save: SaveDataV1, id: CheatId): SaveDelta {
  const c = cheatsOf(save);
  if (!c.unlocked.includes(id)) return {};
  const enabled = c.enabled.includes(id) ? c.enabled.filter((e) => e !== id) : [...c.enabled, id];
  return { cheats: { unlocked: [...c.unlocked], enabled } };
}

/** Switches every cheat off (they stay unlocked). */
export function cheatsOffDelta(save: SaveDataV1): SaveDelta {
  return { cheats: { unlocked: [...cheatsOf(save).unlocked], enabled: [] } };
}

/** Cheats a new run of `mode` snapshots into RunConfig (none in versus), in CHEAT_IDS order. */
export function runCheatIds(save: SaveDataV1, mode: RunMode): readonly CheatId[] {
  if (mode === 'versus') return [];
  const c = cheatsOf(save);
  return CHEAT_IDS.filter((id) => c.enabled.includes(id) && c.unlocked.includes(id));
}

/** "CHEATS ON: GOD MODE, TURBO · no Cores, no records" or '' (versus: a note that cheats are off). */
export function cheatsBanner(save: SaveDataV1, mode: RunMode, metaCurrency: string): string {
  const enabled = cheatsOf(save).enabled;
  if (enabled.length === 0) return '';
  if (mode === 'versus') return 'Cheats are off in VERSUS';
  const names = runCheatIds(save, mode).map((id) => cheatDef(id).label);
  return `CHEATS ON: ${names.join(', ')} · no ${metaCurrency}, no records`;
}

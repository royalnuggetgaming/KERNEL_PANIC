/** Overdrive meter credit (split out of specials.ts so damage/combo can credit it without an import cycle). */
import type { PlayerIndex } from '../contracts/ids';
import type { WorldState } from '../contracts/world';
import { OVERDRIVE } from '../config/tuning';

/** Adds meter (scaled by stats.specialChargeMul), clamped to OVERDRIVE.MAX. Absent players get nothing. */
export function addOverdrive(w: WorldState, p: PlayerIndex, amount: number): void {
  const pl = w.players[p];
  if (pl.life === 'absent' || !(amount > 0)) return;
  const v = pl.overdrive + amount * pl.stats.specialChargeMul;
  pl.overdrive = v > OVERDRIVE.MAX ? OVERDRIVE.MAX : v;
}

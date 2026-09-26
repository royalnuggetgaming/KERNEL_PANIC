/**
 * One fixed simulation step (docs/ARCHITECTURE.md "Event flow"). The system order is fixed:
 *  1 players, 2 weapons, 3 specials, 4 card effects, 5 enemies + boss AI (+ pending spawns), 6 projectiles,
 *  7 grid rebuild + collision, 8 resolve enemy deaths, 9 link beam, 10 pickups, 11 revive, 12 combo,
 *  13 WaveDirector, 14 rules (stepRules in solo/co-op, stepVersusRules in versus).
 * Then tick++, time = tick * SIM.DT and run.elapsed += dt. Systems that do not apply to a mode are no-ops
 * inside the system itself (each checks w.mode). Allocation-free.
 */
import type { Intents } from '../contracts/input';
import type { SimSystem, WorldState } from '../contracts/world';
import { SIM } from '../config/tuning';
import { stepBoss } from '../entities/bosses';
import { stepCardEffects } from '../entities/cardEffects';
import { stepCombo } from '../entities/combo';
import { resolveEnemyDeaths, stepEnemies } from '../entities/enemies';
import { stepLinkBeam } from '../entities/linkBeam';
import { stepPickups } from '../entities/pickups';
import { stepPlayers } from '../entities/players';
import { stepProjectiles } from '../entities/projectiles';
import { stepRevive } from '../entities/revive';
import { stepSpecials } from '../entities/specials';
import { stepWeapons } from '../entities/weapons';
import { stepCollision } from './collision';
import { stepRules } from './rules';
import { stepVersusRules } from './versusRules';
import { stepWaveDirector } from './WaveDirector';

/** System 5: regular enemies (behaviours, separation, pending spawns) then boss AI (patterns, lasers). */
const stepEnemiesAndBoss: SimSystem = (w: WorldState, intents: Intents, dt: number): void => {
  stepEnemies(w, intents, dt);
  stepBoss(w, intents, dt);
};

/** System 8: drains the death queue filled by applyDamage (despawn, Fork splits, Leech unlatch). */
const stepResolveDeaths: SimSystem = (w: WorldState): void => {
  resolveEnemyDeaths(w);
};

/** System 14: the mode's rules. */
const stepModeRules: SimSystem = (w: WorldState, intents: Intents, dt: number): void => {
  if (w.mode === 'versus') stepVersusRules(w, intents, dt);
  else stepRules(w, intents, dt);
};

/** Names of the systems in execution order (profiling, debug overlay, tests). */
export const SYSTEM_NAMES = [
  'players',
  'weapons',
  'specials',
  'cardEffects',
  'enemies',
  'projectiles',
  'collision',
  'resolveDeaths',
  'linkBeam',
  'pickups',
  'revive',
  'combo',
  'waveDirector',
  'rules',
] as const;
export type SystemName = (typeof SYSTEM_NAMES)[number];

/** The systems in execution order (same indices as SYSTEM_NAMES). */
export const SYSTEMS: readonly SimSystem[] = [
  stepPlayers,
  stepWeapons,
  stepSpecials,
  stepCardEffects,
  stepEnemiesAndBoss,
  stepProjectiles,
  stepCollision,
  stepResolveDeaths,
  stepLinkBeam,
  stepPickups,
  stepRevive,
  stepCombo,
  stepWaveDirector,
  stepModeRules,
];

/** Advances the world clock after the systems ran (tick, time, run.elapsed). */
export function advanceClock(w: WorldState, dt: number): void {
  w.tick++;
  w.time = w.tick * SIM.DT;
  w.run.elapsed += dt;
}

/** One fixed step in the fixed system order. `dt` is always SIM.DT in the game. */
export function stepWorld(w: WorldState, intents: Intents, dt: number): void {
  for (let i = 0; i < SYSTEMS.length; i++) SYSTEMS[i]!(w, intents, dt);
  advanceClock(w, dt);
}

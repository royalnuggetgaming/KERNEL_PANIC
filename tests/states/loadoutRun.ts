/** Test double: a FakeRunSession that also answers RunSessionApi.loadout (the v2 installed-powerups read). */
import { CARD_IDS, type CardId, type PlayerIndex } from '../../src/contracts/ids';
import type { PlayerLoadout, RunConfig } from '../../src/contracts/run';
import { emptyRowLevels, emptyTeamLevels } from '../../src/upgrades/stats';
import { FakeRunSession, testRunConfig } from '../helpers/fakeRun';

export interface MutableLoadout {
  rows: ReturnType<typeof emptyRowLevels>;
  cards: Uint8Array;
  team: ReturnType<typeof emptyTeamLevels>;
}

export function blankLoadout(): MutableLoadout {
  return { rows: emptyRowLevels(), cards: new Uint8Array(CARD_IDS.length), team: emptyTeamLevels() };
}

export function setCard(l: MutableLoadout, id: CardId, stacks: number): void {
  l.cards[CARD_IDS.indexOf(id)] = stacks;
}

export class LoadoutRunSession extends FakeRunSession {
  readonly loadouts: [MutableLoadout, MutableLoadout] = [blankLoadout(), blankLoadout()];
  loadoutReads = 0;

  constructor(config: RunConfig = testRunConfig()) {
    super(config);
  }

  loadout(p: PlayerIndex): PlayerLoadout {
    this.loadoutReads++;
    const l = this.loadouts[p];
    return { rows: { ...l.rows }, cards: l.cards.slice(), team: { ...l.team } };
  }
}

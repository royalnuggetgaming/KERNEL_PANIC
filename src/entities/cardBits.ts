/** Card ownership indices (CARD_IDS order === CardDef.bit === PlayerEntity.cardStacks index). */
import { CARD_IDS, type CardId } from '../contracts/ids';
import type { PlayerEntity } from '../contracts/sim';

function bitOf(id: CardId): number {
  return CARD_IDS.indexOf(id);
}

export const CARD_BIT = {
  splitShot: bitOf('splitShot'),
  afterimage: bitOf('afterimage'),
  vampireCode: bitOf('vampireCode'),
  overheat: bitOf('overheat'),
  chainArc: bitOf('chainArc'),
  microMissiles: bitOf('microMissiles'),
  nanoshield: bitOf('nanoshield'),
  orbitals: bitOf('orbitals'),
  forkCall: bitOf('forkCall'),
  sudo: bitOf('sudo'),
  rootAccess: bitOf('rootAccess'),
} as const;

/** Stack count of a card (0 when not owned). Reads cardStacks, the source of truth. */
export function cardStacks(p: Readonly<PlayerEntity>, bit: number): number {
  return p.cardStacks[bit] ?? 0;
}

export function hasCard(p: Readonly<PlayerEntity>, bit: number): boolean {
  return (p.cardStacks[bit] ?? 0) > 0;
}

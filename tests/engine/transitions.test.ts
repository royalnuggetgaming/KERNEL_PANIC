import { describe, expect, it } from 'vitest';
import { STATE_IDS, type StateId } from '../../src/contracts/states';
import { EDGES, findEdge, STATE_LAYERS, WORLD_BELOW } from '../../src/engine/transitions';

const LISTED: readonly (readonly [StateId, StateId])[] = [
  ['Boot', 'MainMenu'],
  ['MainMenu', 'CharacterSelect'],
  ['MainMenu', 'UpgradesShop'],
  ['UpgradesShop', 'MainMenu'],
  ['CharacterSelect', 'MainMenu'],
  ['CharacterSelect', 'Playing'],
  ['Playing', 'Paused'],
  ['Playing', 'UpgradesShop'],
  ['Playing', 'GameOver'],
  ['UpgradesShop', 'Playing'],
  ['UpgradesShop', 'Paused'],
  ['UpgradesShop', 'GameOver'],
  ['Paused', 'Playing'],
  ['Paused', 'UpgradesShop'],
  ['Paused', 'GameOver'],
  ['GameOver', 'CharacterSelect'],
  ['GameOver', 'MainMenu'],
];

describe('transition table', () => {
  it('has exactly the 16 numbered edges (17 entries) and nothing else among the 49 pairs', () => {
    expect(EDGES).toHaveLength(17);
    const listed = new Set(LISTED.map(([a, b]) => `${a}>${b}`));
    let found = 0;
    for (const from of STATE_IDS) {
      for (const to of STATE_IDS) {
        const e = findEdge(from, to);
        expect(e !== null, `${from} -> ${to}`).toBe(listed.has(`${from}>${to}`));
        if (e) found++;
      }
    }
    expect(found).toBe(17);
  });

  it('uses the right stack op per edge', () => {
    expect(findEdge('Playing', 'Paused')?.op).toBe('push');
    expect(findEdge('Playing', 'UpgradesShop')?.op).toBe('push');
    expect(findEdge('UpgradesShop', 'Paused')?.op).toBe('push');
    expect(findEdge('UpgradesShop', 'Playing')?.op).toBe('pop');
    expect(findEdge('Paused', 'Playing')?.op).toBe('pop');
    expect(findEdge('Paused', 'UpgradesShop')?.op).toBe('pop');
    expect(findEdge('Playing', 'GameOver')?.op).toBe('replace');
  });

  it('guards payloads and stacks', () => {
    const g = (from: StateId, to: StateId, payload: unknown, stack: StateId[]): boolean => {
      const e = findEdge(from, to);
      return e !== null && (e.guard === undefined || e.guard(payload, stack));
    };
    expect(g('MainMenu', 'UpgradesShop', { mode: 'meta' }, ['MainMenu'])).toBe(true);
    expect(g('MainMenu', 'UpgradesShop', { mode: 'midrun' }, ['MainMenu'])).toBe(false);
    expect(g('UpgradesShop', 'MainMenu', undefined, ['UpgradesShop'])).toBe(true);
    expect(g('UpgradesShop', 'MainMenu', undefined, ['Playing', 'UpgradesShop'])).toBe(false);
    expect(g('Playing', 'UpgradesShop', { mode: 'midrun' }, ['Playing'])).toBe(true);
    expect(g('Playing', 'UpgradesShop', { mode: 'meta' }, ['Playing'])).toBe(false);
    expect(g('Playing', 'GameOver', { outcome: 'defeat' }, ['Playing'])).toBe(true);
    expect(g('Playing', 'GameOver', { outcome: 'victory' }, ['Playing'])).toBe(true);
    expect(g('Playing', 'GameOver', { outcome: 'abandoned' }, ['Playing'])).toBe(false);
    expect(g('UpgradesShop', 'GameOver', { outcome: 'victory' }, ['Playing', 'UpgradesShop'])).toBe(true);
    expect(g('UpgradesShop', 'GameOver', { outcome: 'defeat' }, ['Playing', 'UpgradesShop'])).toBe(false);
    expect(g('Paused', 'GameOver', { outcome: 'abandoned' }, ['Playing', 'Paused'])).toBe(true);
    expect(g('Paused', 'GameOver', { outcome: 'defeat' }, ['Playing', 'Paused'])).toBe(false);
    expect(g('Paused', 'Playing', undefined, ['Playing', 'Paused'])).toBe(true);
    expect(g('Paused', 'Playing', undefined, ['Playing', 'UpgradesShop', 'Paused'])).toBe(false);
    expect(g('Paused', 'UpgradesShop', undefined, ['Playing', 'UpgradesShop', 'Paused'])).toBe(true);
    expect(g('UpgradesShop', 'Paused', undefined, ['Playing', 'UpgradesShop'])).toBe(true);
    expect(g('UpgradesShop', 'Paused', undefined, ['UpgradesShop'])).toBe(false);
    expect(g('CharacterSelect', 'Playing', { config: {} }, ['CharacterSelect'])).toBe(true);
    expect(g('CharacterSelect', 'Playing', undefined, ['CharacterSelect'])).toBe(false);
  });

  it('declares layers and frozen overlays', () => {
    expect(STATE_LAYERS.Paused).toBe('overlay');
    expect(STATE_LAYERS.Playing).toBe('base');
    expect(WORLD_BELOW.Paused).toBe('frozen');
    expect(WORLD_BELOW.UpgradesShop).toBe('frozen');
    expect(WORLD_BELOW.GameOver).toBe('none');
  });
});

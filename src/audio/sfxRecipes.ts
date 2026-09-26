/**
 * The full SFX recipe table: one recipe per SfxId, each rendered in SFX_VARIANTS pitch/jitter variants and
 * parameterised by the theme's timbre preset.
 */
import type { SfxId } from '../contracts/audio';
import { type SfxRecipe } from './sfxRecipeKit';
import { COMBAT_RECIPES } from './sfxRecipesCombat';
import { EVENT_RECIPES } from './sfxRecipesEvents';
import type { TimbrePreset } from './timbre';

export const SFX_RECIPES: Readonly<Record<SfxId, SfxRecipe>> = { ...COMBAT_RECIPES, ...EVENT_RECIPES };

/** Rendered buffer length in seconds for a recipe under a timbre (tails stretch with timbre.decay). */
export function recipeSeconds(recipe: SfxRecipe, timbre: TimbrePreset): number {
  return recipe.duration * Math.max(1, timbre.decay) + 0.02;
}

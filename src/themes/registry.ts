/** Theme registry. Add a theme: new ThemeDef file + THEME_IDS entry + THEMES entry (see ARCHITECTURE.md). */
import type { ThemeId } from '../contracts/ids';
import type { ThemeDef } from '../contracts/theme';
import { KERNEL_PANIC } from './kernelPanic';

export const DEFAULT_THEME_ID: ThemeId = 'kernelPanic';

export const THEMES: Readonly<Record<ThemeId, ThemeDef>> = {
  kernelPanic: KERNEL_PANIC,
};

/** Resolves a (possibly unknown/stale) id from settings, falling back to the default theme. */
export function getTheme(id: string | null | undefined): ThemeDef {
  if (id !== null && id !== undefined && Object.prototype.hasOwnProperty.call(THEMES, id)) {
    return THEMES[id as ThemeId];
  }
  return THEMES[DEFAULT_THEME_ID];
}

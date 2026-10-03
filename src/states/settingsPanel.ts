/**
 * Settings sub-panel controller (MainMenu and Paused). Every change is saved through save.commitDebounced and
 * applied live: volumes (audio), quality / shake / flashes / motion / colourblind / FPS (render.applySettings),
 * per-player autofire and focus mode (input.setFireModes). The theme's shader modes are compile-time defines fixed
 * at Boot, so a theme change is saved and a RESTART TO APPLY row appears (outside a run it reloads the page through
 * services.reloadApp; inside a run it only explains, since a reload would end the run). The difficulty is saved
 * immediately but only read when a run starts (CharacterSelect snapshots it into RunConfig), so changing it from
 * the pause menu affects the next run, never the current one.
 */
import { THEME_IDS, type ThemeId } from '../contracts/ids';
import {
  DIFFICULTY_IDS,
  QUALITY_LEVELS,
  type DifficultyId,
  type FrameCap,
  type QualityLevel,
  type Settings,
} from '../contracts/save';
import type { Services } from '../contracts/services';
import type { SettingKind, SettingRowVM, SettingsPanelVM } from '../contracts/ui';
import { DEFAULT_DIFFICULTY } from '../config/difficulty';
import { QUALITY_PRESETS } from '../config/quality';
import { getTheme } from '../themes/registry';
import { indexOfId, wrapIndex, type UiIntent } from './intents';

export const SETTING_IDS = [
  'difficulty',
  'master',
  'music',
  'sfx',
  'quality',
  'frameCap',
  'screenShake',
  'reduceFlashes',
  'reduceMotion',
  'colorblind',
  'autofire0',
  'autofire1',
  'focus0',
  'focus1',
  'showFps',
  'theme',
] as const;
export type SettingId = (typeof SETTING_IDS)[number];

const FRAME_CAPS: readonly FrameCap[] = ['auto', 60, 120, 'uncapped'];
const SLIDER_STEP = 0.1;
/** Shown after a difficulty change (the running game, if any, keeps its own difficulty). */
export const DIFFICULTY_NOTE = 'Difficulty applies from the next run.';
export const DIFFICULTY_LABELS: Readonly<Record<DifficultyId, string>> = {
  casual: 'CASUAL',
  normal: 'NORMAL',
  hard: 'HARD',
};

/** Shown when the saved theme differs from the running one. */
export const THEME_RESTART_NOTE = 'Restart to apply the theme: choose RESTART TO APPLY below.';
export const THEME_RESTART_IN_RUN = 'Finish or quit this run first: restarting now would end it.';
export const THEME_RESTARTING = 'Restarting...';
/** Shown when a quality change switches the LOW_FX (Chromebook) shader variant, a Boot-time define. */
export const LOW_FX_RESTART_NOTE =
  'Chromebook shader detail changes after RESTART TO APPLY (the rest is live).';

/** The action row that only exists while a theme change is waiting for a restart. */
export const APPLY_THEME_ROW = 'applyTheme';
type RowId = SettingId | typeof APPLY_THEME_ROW;

interface RowDef {
  readonly id: RowId;
  readonly label: string;
  readonly kind: SettingKind;
}

const ROWS: readonly RowDef[] = [
  { id: 'difficulty', label: 'DIFFICULTY', kind: 'choice' },
  { id: 'master', label: 'MASTER VOLUME', kind: 'slider' },
  { id: 'music', label: 'MUSIC VOLUME', kind: 'slider' },
  { id: 'sfx', label: 'SFX VOLUME', kind: 'slider' },
  { id: 'quality', label: 'QUALITY', kind: 'choice' },
  { id: 'frameCap', label: 'FRAME CAP', kind: 'choice' },
  { id: 'screenShake', label: 'SCREEN SHAKE', kind: 'slider' },
  { id: 'reduceFlashes', label: 'REDUCE FLASHES', kind: 'toggle' },
  { id: 'reduceMotion', label: 'REDUCE MOTION', kind: 'toggle' },
  { id: 'colorblind', label: 'COLOURBLIND PALETTE', kind: 'toggle' },
  { id: 'autofire0', label: 'P1 AUTOFIRE', kind: 'toggle' },
  { id: 'autofire1', label: 'P2 AUTOFIRE', kind: 'toggle' },
  { id: 'focus0', label: 'P1 FOCUS MODE', kind: 'choice' },
  { id: 'focus1', label: 'P2 FOCUS MODE', kind: 'choice' },
  { id: 'showFps', label: 'SHOW FPS', kind: 'toggle' },
  { id: 'theme', label: 'THEME', kind: 'choice' },
];
const ROWS_WITH_APPLY: readonly RowDef[] = [
  ...ROWS,
  { id: APPLY_THEME_ROW, label: 'RESTART TO APPLY', kind: 'action' },
];

/**
 * Visible rows: the restart row is appended while the saved theme differs from the running theme, or the saved
 * quality's LOW_FX shader variant differs from the running one (both are compile-time defines fixed at Boot).
 */
function rowsFor(s: Settings, runningTheme: ThemeId, runningLowFx: boolean): readonly RowDef[] {
  const saved: string = s.themeId;
  const running: string = runningTheme;
  const fxPending = QUALITY_PRESETS[s.quality].lowFx !== runningLowFx;
  return saved === running && !fxPending ? ROWS : ROWS_WITH_APPLY;
}

/** Applies settings to the live ports (not to the save). */
export function applySettingsLive(s: Services, settings: Settings): void {
  s.audio.setVolumes(settings.master, settings.music, settings.sfx);
  s.render.applySettings(settings);
  s.input.setFireModes(settings.autofire, settings.focusToggle);
}

function round1(x: number): number {
  return Math.round(Math.min(1, Math.max(0, x)) * 10) / 10;
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

function onOff(b: boolean): string {
  return b ? 'ON' : 'OFF';
}

function capLabel(c: FrameCap): string {
  return typeof c === 'number' ? `${c} FPS` : c.toUpperCase();
}

function cycle<T>(list: readonly T[], current: T, delta: number): T {
  const i = list.indexOf(current);
  return list[wrapIndex(i < 0 ? 0 : i, delta, list.length)]!;
}

function pair(b: readonly [boolean, boolean], p: 0 | 1, v: boolean): readonly [boolean, boolean] {
  return p === 0 ? [v, b[1]] : [b[0], v];
}

/** The patch that adjusting row `id` by `delta` (-1 left, +1 right/confirm) produces, or null for no change. */
export function adjustSetting(s: Settings, id: SettingId, delta: number): Partial<Settings> | null {
  switch (id) {
    case 'difficulty':
      return { difficulty: cycle<DifficultyId>(DIFFICULTY_IDS, s.difficulty ?? DEFAULT_DIFFICULTY, delta) };
    case 'master':
    case 'music':
    case 'sfx':
    case 'screenShake': {
      const next = round1(s[id] + delta * SLIDER_STEP);
      return next === s[id] ? null : { [id]: next };
    }
    case 'quality':
      return { quality: cycle<QualityLevel>(QUALITY_LEVELS, s.quality, delta) };
    case 'frameCap':
      return { frameCap: cycle(FRAME_CAPS, s.frameCap, delta) };
    case 'reduceFlashes':
    case 'reduceMotion':
    case 'colorblind':
    case 'showFps':
      return { [id]: !s[id] };
    case 'autofire0':
      return { autofire: pair(s.autofire, 0, !s.autofire[0]) };
    case 'autofire1':
      return { autofire: pair(s.autofire, 1, !s.autofire[1]) };
    case 'focus0':
      return { focusToggle: pair(s.focusToggle, 0, !s.focusToggle[0]) };
    case 'focus1':
      return { focusToggle: pair(s.focusToggle, 1, !s.focusToggle[1]) };
    case 'theme': {
      const next = cycle<ThemeId>(THEME_IDS, s.themeId, delta);
      const before: string = s.themeId;
      const after: string = next;
      return after === before ? null : { themeId: next };
    }
  }
}

function rowValue(s: Settings, id: RowId): { value: string; fraction: number } {
  switch (id) {
    case APPLY_THEME_ROW:
      return { value: 'RESTART NOW', fraction: 0 };
    case 'difficulty':
      return { value: DIFFICULTY_LABELS[s.difficulty ?? DEFAULT_DIFFICULTY], fraction: 0 };
    case 'master':
    case 'music':
    case 'sfx':
    case 'screenShake':
      return { value: pct(s[id]), fraction: s[id] };
    case 'quality':
      return { value: s.quality.toUpperCase(), fraction: 0 };
    case 'frameCap':
      return { value: capLabel(s.frameCap), fraction: 0 };
    case 'reduceFlashes':
    case 'reduceMotion':
    case 'colorblind':
    case 'showFps':
      return { value: onOff(s[id]), fraction: 0 };
    case 'autofire0':
      return { value: onOff(s.autofire[0]), fraction: 0 };
    case 'autofire1':
      return { value: onOff(s.autofire[1]), fraction: 0 };
    case 'focus0':
      return { value: s.focusToggle[0] ? 'TOGGLE' : 'HOLD', fraction: 0 };
    case 'focus1':
      return { value: s.focusToggle[1] ? 'TOGGLE' : 'HOLD', fraction: 0 };
    case 'theme':
      return { value: getTheme(s.themeId).title, fraction: 0 };
  }
}

/** `runningTheme` / `runningLowFx` default to the saved settings (no restart row). */
export function buildSettingsVM(
  s: Settings,
  cursor: number,
  note: string,
  runningTheme: ThemeId = s.themeId,
  runningLowFx: boolean = QUALITY_PRESETS[s.quality].lowFx,
): SettingsPanelVM {
  const rows: SettingRowVM[] = [];
  for (const def of rowsFor(s, runningTheme, runningLowFx)) {
    const v = rowValue(s, def.id);
    rows.push({ id: def.id, label: def.label, kind: def.kind, value: v.value, fraction: v.fraction });
  }
  return { rows, cursor, note };
}

export class SettingsController {
  cursor = 0;
  note = '';
  private settings: Settings;
  private readonly s: Services;

  constructor(s: Services) {
    this.s = s;
    this.settings = s.save.data.settings;
  }

  open(): void {
    this.settings = this.s.save.data.settings;
    this.cursor = 0;
    this.note = '';
  }

  get current(): Settings {
    return this.settings;
  }

  /** The running shader variant (AppEnv.lowFx, absent in fixtures = the saved quality's). */
  private runningLowFx(): boolean {
    return this.s.env.lowFx ?? QUALITY_PRESETS[this.settings.quality].lowFx;
  }

  private rows(): readonly RowDef[] {
    return rowsFor(this.settings, this.s.theme().id, this.runningLowFx());
  }

  /** Handles one intent (back is handled by the owner). Returns true when the VM changed. */
  handle(i: UiIntent): boolean {
    const rows = this.rows();
    const target = i.pointer ? indexOfId(rows, i.itemId) : this.cursor;
    switch (i.kind) {
      case 'up':
      case 'down':
        this.cursor = wrapIndex(this.cursor, i.kind === 'up' ? -1 : 1, rows.length);
        this.s.audio.play('uiMove');
        return true;
      case 'left':
      case 'right':
      case 'confirm': {
        if (target < 0) return false;
        this.cursor = target;
        const def = rows[target]!;
        if (def.id === APPLY_THEME_ROW) return this.restart();
        return this.adjust(def, def.id, i.kind === 'left' ? -1 : 1, i.kind === 'confirm');
      }
      case 'back':
      case 'ready':
      case 'pause':
        return false;
    }
  }

  vm(): SettingsPanelVM {
    return buildSettingsVM(this.settings, this.cursor, this.note, this.s.theme().id, this.runningLowFx());
  }

  private restart(): boolean {
    if (this.s.session.current !== null) {
      this.note = THEME_RESTART_IN_RUN;
      this.s.audio.play('uiBack');
      return true;
    }
    this.note = THEME_RESTARTING;
    this.s.audio.play('uiConfirm');
    this.s.reloadApp();
    return true;
  }

  private noteAfter(id: SettingId): string {
    const savedTheme: string = this.settings.themeId;
    const runningTheme: string = this.s.theme().id;
    if (id === 'theme') return savedTheme !== runningTheme ? THEME_RESTART_NOTE : '';
    if (id === 'difficulty') return DIFFICULTY_NOTE;
    const fxPending = QUALITY_PRESETS[this.settings.quality].lowFx !== this.runningLowFx();
    return id === 'quality' && fxPending ? LOW_FX_RESTART_NOTE : '';
  }

  private adjust(def: RowDef, id: SettingId, delta: number, confirm: boolean): boolean {
    // Confirm activates toggles and choices; a slider only moves with left/right.
    if (confirm && def.kind === 'slider') return false;
    const patch = adjustSetting(this.settings, id, delta);
    if (patch === null) {
      this.note = '';
      return true;
    }
    this.settings = { ...this.settings, ...patch };
    this.note = this.noteAfter(id);
    // The restart row may just have gone away.
    this.cursor = Math.min(this.cursor, this.rows().length - 1);
    this.s.save.commitDebounced({ settings: patch });
    applySettingsLive(this.s, this.settings);
    this.s.audio.play('uiConfirm');
    return true;
  }
}

/**
 * Settings / Controls / Credits / HOW TO PLAY (manual) sub-panels shared by MainMenu and Paused (not FSM states). While a panel is
 * open it owns every intent; a back intent closes it (unless the controls panel is capturing, offering a swap
 * or running the key test). Closing a panel flushes its debounced save writes (menus and Pause are never
 * Playing); a write failure seen while a panel is open or on close is toasted (plan 6 "Failure handling").
 */
import type { SaveStatus } from '../contracts/save';
import type { Services } from '../contracts/services';
import type {
  ControlsPanelVM,
  ManualPageVM,
  ManualVM,
  SettingsPanelVM,
  SubPanel,
  TerminalVM,
} from '../contracts/ui';
import { ControlsController } from './controlsPanel';
import type { UiIntent } from './intents';
import { buildManualPages } from './manualPages';
import { SettingsController } from './settingsPanel';
import { TerminalController } from './terminal';

export const CREDITS: readonly string[] = [
  'KERNEL PANIC',
  'Design, code, art and audio generated procedurally in TypeScript.',
  'Rendering: three.js. Audio: Web Audio synthesis.',
  'No binary assets: every mesh, texture, shader and sound is built at boot.',
  'Built with Claude Code.',
];

/** Pointer item id prefix of a manual table-of-contents entry ('manual:<page index>'). */
export const MANUAL_PAGE_PREFIX = 'manual:';
export const MANUAL_HINT = '↑ ↓ / ← → CHANGE PAGE   ·   CLICK A SECTION   ·   ESC BACK';

/** Page index for a manual intent (clamped), or the current page when the intent does not navigate. */
export function manualTarget(i: UiIntent, page: number, count: number): number {
  const last = Math.max(0, count - 1);
  if (i.pointer && i.itemId?.startsWith(MANUAL_PAGE_PREFIX) === true) {
    const n = Number(i.itemId.slice(MANUAL_PAGE_PREFIX.length));
    return Number.isInteger(n) ? Math.min(last, Math.max(0, n)) : page;
  }
  if (i.kind === 'up' || i.kind === 'left') return Math.max(0, page - 1);
  if (i.kind === 'down' || i.kind === 'right' || (i.kind === 'confirm' && !i.pointer))
    return Math.min(last, page + 1);
  return page;
}

export class SubPanelController {
  panel: SubPanel = 'none';
  readonly settings: SettingsController;
  readonly controls: ControlsController;
  readonly terminal: TerminalController;
  private dirty = false;
  private readonly s: Services;
  /** Save status when the panel opened (or last checked): a change to memoryOnly means a write failed. */
  private seenStatus: SaveStatus;
  private manualPages: readonly ManualPageVM[] = [];
  private manualPage = 0;

  constructor(s: Services) {
    this.s = s;
    this.seenStatus = s.save.status;
    this.settings = new SettingsController(s);
    this.controls = new ControlsController(s);
    this.controls.onChange = () => {
      this.dirty = true;
    };
    this.terminal = new TerminalController(s);
    this.terminal.onChange = () => {
      this.dirty = true;
    };
  }

  get isOpen(): boolean {
    return this.panel !== 'none';
  }

  open(p: SubPanel): void {
    this.controls.close();
    this.terminal.stop();
    this.panel = p;
    if (p === 'terminal') this.terminal.start();
    this.seenStatus = this.s.save.status;
    if (p === 'settings') this.settings.open();
    if (p === 'controls') this.controls.open();
    if (p === 'manual') {
      // Built on open: the Controls page shows the bindings in effect right now.
      this.manualPages = buildManualPages(this.s.theme(), this.s.save.data.bindings);
      this.manualPage = 0;
    }
    this.dirty = true;
  }

  close(): void {
    this.controls.close();
    this.terminal.stop();
    if (this.panel !== 'none') {
      this.s.save.flush();
      this.checkWrites();
    }
    this.panel = 'none';
    this.dirty = true;
  }

  /** True when a panel is open (the intent was consumed by it). */
  handle(i: UiIntent): boolean {
    if (this.panel === 'none') return false;
    let changed = false;
    if (this.panel === 'settings') changed = this.settings.handle(i);
    else if (this.panel === 'controls') changed = this.controls.handle(i);
    else if (this.panel === 'manual') changed = this.handleManual(i);
    else if (this.panel === 'terminal') changed = this.terminal.handle(i);
    const wantsBack = i.kind === 'back' && (!i.pointer || i.itemId === 'back');
    if (!changed && wantsBack && !(this.panel === 'controls' && this.controls.modal)) {
      this.close();
      changed = true;
    }
    if (changed) this.dirty = true;
    return true;
  }

  private handleManual(i: UiIntent): boolean {
    const next = manualTarget(i, this.manualPage, this.manualPages.length);
    if (next === this.manualPage) return false;
    this.manualPage = next;
    this.s.audio.play('uiMove');
    return true;
  }

  /** Per-frame work (key test refresh). */
  tick(): void {
    if (this.panel === 'none') return;
    if (this.panel === 'controls' && this.controls.tick()) this.dirty = true;
    if (this.panel === 'terminal' && this.terminal.wantsClose) {
      this.s.audio.play('uiBack');
      this.close();
      return;
    }
    this.checkWrites();
  }

  private checkWrites(): void {
    const status = this.s.save.status;
    if (status === 'memoryOnly' && this.seenStatus !== 'memoryOnly')
      this.s.ui.toast('Could not write the save: changes are kept for this session only.', 'error');
    this.seenStatus = status;
  }

  /** Returns and clears the changed flag. */
  takeDirty(): boolean {
    const d = this.dirty;
    this.dirty = false;
    return d;
  }

  settingsVM(): SettingsPanelVM | null {
    return this.panel === 'settings' ? this.settings.vm() : null;
  }

  controlsVM(): ControlsPanelVM | null {
    return this.panel === 'controls' ? this.controls.vm() : null;
  }

  terminalVM(): TerminalVM | null {
    return this.panel === 'terminal' ? this.terminal.vm() : null;
  }

  manualVM(): ManualVM | null {
    if (this.panel !== 'manual') return null;
    return { pages: this.manualPages, page: this.manualPage, hint: MANUAL_HINT };
  }
}

/**
 * Settings / Controls / Credits sub-panels shared by MainMenu and Paused (not FSM states). While a panel is
 * open it owns every intent; a back intent closes it (unless the controls panel is capturing, offering a swap
 * or running the key test).
 */
import type { Services } from '../contracts/services';
import type { ControlsPanelVM, SettingsPanelVM, SubPanel } from '../contracts/ui';
import { ControlsController } from './controlsPanel';
import type { UiIntent } from './intents';
import { SettingsController } from './settingsPanel';

export const CREDITS: readonly string[] = [
  'KERNEL PANIC',
  'Design, code, art and audio generated procedurally in TypeScript.',
  'Rendering: three.js. Audio: Web Audio synthesis.',
  'No binary assets: every mesh, texture, shader and sound is built at boot.',
  'Built with Claude Code.',
];

export class SubPanelController {
  panel: SubPanel = 'none';
  readonly settings: SettingsController;
  readonly controls: ControlsController;
  private dirty = false;

  constructor(s: Services) {
    this.settings = new SettingsController(s);
    this.controls = new ControlsController(s);
    this.controls.onChange = () => {
      this.dirty = true;
    };
  }

  get isOpen(): boolean {
    return this.panel !== 'none';
  }

  open(p: SubPanel): void {
    this.controls.close();
    this.panel = p;
    if (p === 'settings') this.settings.open();
    if (p === 'controls') this.controls.open();
    this.dirty = true;
  }

  close(): void {
    this.controls.close();
    this.panel = 'none';
    this.dirty = true;
  }

  /** True when a panel is open (the intent was consumed by it). */
  handle(i: UiIntent): boolean {
    if (this.panel === 'none') return false;
    let changed = false;
    if (this.panel === 'settings') changed = this.settings.handle(i);
    else if (this.panel === 'controls') changed = this.controls.handle(i);
    const wantsBack = i.kind === 'back' && (!i.pointer || i.itemId === 'back');
    if (!changed && wantsBack && !(this.panel === 'controls' && this.controls.modal)) {
      this.close();
      changed = true;
    }
    if (changed) this.dirty = true;
    return true;
  }

  /** Per-frame work (key test refresh). */
  tick(): void {
    if (this.panel === 'controls' && this.controls.tick()) this.dirty = true;
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
}

/**
 * Paused overlay (over Playing or the mid-run shop): Resume, Settings, Controls / Key Test, Abandon.
 * enter releases every key (input.releaseAll). Resume pops; Abandon replaces with GameOver{abandoned}.
 * Auto-pause (blur, hidden, fullscreen exit, context loss) never auto-resumes.
 *
 * Abandon confirmation:
 * - keyboard: confirm on ABANDON and keep a confirm key held for 600 ms (released early = cancelled);
 * - mouse: the first click on ABANDON arms it, a second click within 2 s confirms (a click cannot be held).
 */
import type { PlayerIndex } from '../contracts/ids';
import type { KeyCode } from '../contracts/input';
import type { Services } from '../contracts/services';
import type { GameState, PauseReason, StatePayloads } from '../contracts/states';
import type { MenuItemVM, PauseVM } from '../contracts/ui';
import { MENU_KEYS } from '../config/keys';
import { IntentReader, indexOfId, wrapIndex, type UiIntent } from './intents';
import { SubPanelController } from './subPanels';

export const ABANDON_HOLD_MS = 600;
export const ABANDON_CLICK_WINDOW_MS = 2000;

const ITEM_IDS = ['resume', 'settings', 'controls', 'abandon'] as const;
const ABANDON_INDEX = 3;

const REASONS: Readonly<Record<PauseReason, string>> = {
  user: '',
  blur: 'Paused: the window lost focus',
  hidden: 'Paused: the tab was hidden',
  fullscreen: 'Paused: left fullscreen',
  contextlost: 'Paused: the graphics context was lost',
};

function items(armed: boolean): readonly MenuItemVM[] {
  return [
    { id: 'resume', label: 'RESUME', enabled: true, hint: '' },
    { id: 'settings', label: 'SETTINGS', enabled: true, hint: 'Audio, graphics, autofire' },
    { id: 'controls', label: 'CONTROLS', enabled: true, hint: 'Rebind keys, key test' },
    {
      id: 'abandon',
      label: 'ABANDON RUN',
      enabled: true,
      hint: armed
        ? 'Click again to abandon'
        : 'Hold confirm for 0.6 s (or click twice). Rewards are still paid for progress.',
    },
  ];
}

class PausedStateImpl implements GameState<'Paused'> {
  readonly id = 'Paused' as const;
  readonly layer = 'overlay' as const;
  readonly worldBelow = 'frozen' as const;
  private readonly s: Services;
  private readonly intents = new IntentReader();
  private readonly panels: SubPanelController;
  private cursor = 0;
  private reason: PauseReason = 'user';
  private holdMs = -1;
  private armedUntil = -1;
  private dirty = true;
  private leaving = false;

  constructor(s: Services) {
    this.s = s;
    this.panels = new SubPanelController(s);
  }

  enter(payload: StatePayloads['Paused']): void {
    const s = this.s;
    this.reason = payload.reason;
    this.cursor = 0;
    this.holdMs = -1;
    this.armedUntil = -1;
    this.leaving = false;
    this.panels.close();
    s.input.releaseAll();
    s.input.setContext('menu');
    this.intents.open(s.ui, 'pause');
    s.ui.show('pause', this.vm());
    this.dirty = false;
  }

  exit(): void {
    this.panels.close();
    this.intents.close();
    this.s.ui.hide('pause');
  }

  update(frameDt: number): void {
    const intents = this.intents.read(this.s.input, frameDt * 1000);
    for (const i of intents) {
      if (this.leaving) return;
      if (this.panels.handle(i)) continue;
      this.handle(i);
    }
    if (this.leaving) return;
    this.tickHold(frameDt * 1000);
    if (this.armedUntil >= 0 && this.s.clock.now() > this.armedUntil) {
      this.armedUntil = -1;
      this.dirty = true;
    }
    this.panels.tick();
    if (this.panels.takeDirty()) this.dirty = true;
    if (this.dirty) {
      this.dirty = false;
      this.s.ui.update('pause', this.vm());
    }
  }

  private handle(i: UiIntent): void {
    switch (i.kind) {
      case 'up':
      case 'down':
        this.cursor = wrapIndex(this.cursor, i.kind === 'up' ? -1 : 1, ITEM_IDS.length);
        this.cancelHold();
        this.s.audio.play('uiMove');
        this.dirty = true;
        return;
      case 'back':
        if (i.pointer && i.itemId !== 'back') return;
        this.resume();
        return;
      case 'confirm': {
        const target = i.pointer ? indexOfId(items(false), i.itemId) : this.cursor;
        if (target < 0) return;
        this.cursor = target;
        this.dirty = true;
        this.activate(target, i.pointer, i.player);
        return;
      }
      case 'left':
      case 'right':
      case 'ready':
      case 'pause':
        return;
    }
  }

  private activate(index: number, pointer: boolean, player: PlayerIndex | 'any'): void {
    switch (ITEM_IDS[index]) {
      case 'resume':
        this.resume();
        return;
      case 'settings':
      case 'controls':
        this.s.audio.play('uiConfirm');
        this.panels.open(ITEM_IDS[index]);
        return;
      case 'abandon':
        if (pointer) this.clickAbandon();
        else if (this.holdMs < 0 && this.confirmHeld(player)) this.holdMs = 0;
        return;
      case undefined:
        return;
    }
  }

  private resume(): void {
    this.s.audio.play('uiBack');
    this.leaving = this.s.fsm.requestPop();
  }

  private abandon(): void {
    this.s.audio.play('uiConfirm');
    this.leaving = this.s.fsm.request('GameOver', { outcome: 'abandoned' });
  }

  private clickAbandon(): void {
    const now = this.s.clock.now();
    if (this.armedUntil >= 0 && now <= this.armedUntil) {
      this.abandon();
      return;
    }
    this.armedUntil = now + ABANDON_CLICK_WINDOW_MS;
    this.s.audio.play('uiDeny');
  }

  private cancelHold(): void {
    if (this.holdMs >= 0) this.dirty = true;
    this.holdMs = -1;
  }

  private tickHold(dtMs: number): void {
    if (this.holdMs < 0) return;
    if (this.cursor !== ABANDON_INDEX || this.panels.isOpen || !this.confirmHeld('any')) {
      this.cancelHold();
      return;
    }
    this.holdMs += dtMs;
    this.dirty = true;
    if (this.holdMs >= ABANDON_HOLD_MS) {
      this.holdMs = -1;
      this.abandon();
    }
  }

  /** Whether any confirm key (shared confirm keys or a player's fire keys) is physically held. */
  private confirmHeld(player: PlayerIndex | 'any'): boolean {
    const held = this.s.input.heldCodes;
    const has = (codes: readonly KeyCode[]): boolean => {
      for (const c of codes) if (held.has(c)) return true;
      return false;
    };
    const b = this.s.save.data.bindings.players;
    if (player === 0) return has(b[0].fire) || has(MENU_KEYS.confirm);
    if (player === 1) return has(b[1].fire) || has(MENU_KEYS.confirm);
    return has(MENU_KEYS.confirm) || has(b[0].fire) || has(b[1].fire);
  }

  private vm(): PauseVM {
    const armed = this.armedUntil >= 0;
    const hold = this.holdMs >= 0 ? Math.min(1, this.holdMs / ABANDON_HOLD_MS) : armed ? 0.5 : 0;
    return {
      items: items(armed),
      cursor: this.cursor,
      abandonHold: hold,
      panel: this.panels.panel,
      settings: this.panels.settingsVM(),
      controls: this.panels.controlsVM(),
      reason: REASONS[this.reason],
    };
  }
}

export function createPausedState(s: Services): GameState<'Paused'> {
  return new PausedStateImpl(s);
}

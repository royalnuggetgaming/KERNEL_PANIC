/**
 * CharacterSelect: SelectStage turntables ('select' camera), per-player cursors with drop-in join (P2 presses
 * Fire), locked vehicles with their Core price, the MODE row once P2 joined, Ready + 0.6 s countdown, then a
 * RunConfig (runId, crypto seed or ?seed=, picks, Firmware snapshot, fire modes, theme) and a request for
 * Playing. A Retry prefill (picks + mode) is applied on enter. exit() saves lastLoadout / lastMode through a
 * debounced delta and clears the turntables.
 */
import type { LoadoutPick, RunMode, VehicleId } from '../contracts/ids';
import type { RunConfig } from '../contracts/run';
import type { Services } from '../contracts/services';
import type { GameState, StatePayloads } from '../contracts/states';
import { VEHICLES } from '../config/vehicles';
import { isVehicleUnlocked } from '../upgrades/MetaShop';
import {
  applyPlayerIntent,
  createSelectModel,
  picksOf,
  syncCountdown,
  tickCountdown,
  toggleMode,
  type MutableSelectModel,
  type SelectEffect,
  type SelectRules,
} from './characterSelectModel';
import { IntentReader, type UiIntent } from './intents';
import { buildCharacterSelectVM, effectiveMode } from './viewModels';

class CharacterSelectStateImpl implements GameState<'CharacterSelect'> {
  readonly id = 'CharacterSelect' as const;
  readonly layer = 'base' as const;
  readonly worldBelow = 'none' as const;
  private readonly s: Services;
  private readonly intents = new IntentReader();
  private readonly rules: SelectRules;
  private model: MutableSelectModel = createSelectModel(null, null, []);
  private dirty = true;
  private leaving = false;
  private previews: readonly [VehicleId | null, VehicleId | null] = [null, null];
  private unsubExternal: (() => void) | null = null;

  constructor(s: Services) {
    this.s = s;
    this.rules = {
      isUnlocked: (v) => isVehicleUnlocked(s.save.data, v),
      lockedMessage: (v) => {
        const n = s.theme().names;
        return `${n.vehicles[v]} is locked: unlock it in ${n.meta} for ${VEHICLES[v].unlockCost} ${n.metaCurrency}.`;
      },
    };
  }

  enter(payload: StatePayloads['CharacterSelect']): void {
    const s = this.s;
    this.model = createSelectModel(payload.prefill, payload.mode, s.save.data.lastLoadout);
    this.leaving = false;
    this.previews = [null, null];
    s.input.setContext('menu');
    s.render.setCameraMode('select');
    s.audio.setMood('select');
    this.intents.open(s.ui, 'characterSelect');
    this.unsubExternal = s.save.onExternalChange(() => {
      this.dirty = true;
    });
    this.syncPreviews();
    s.ui.show('characterSelect', this.vm());
    this.dirty = false;
  }

  exit(): void {
    const s = this.s;
    this.intents.close();
    if (this.unsubExternal !== null) this.unsubExternal();
    this.unsubExternal = null;
    s.save.commitDebounced({ lastLoadout: picksOf(this.model), lastMode: effectiveMode(this.model) });
    s.render.showVehiclePreviews([null, null]);
    this.previews = [null, null];
    s.ui.hide('characterSelect');
  }

  update(frameDt: number): void {
    const intents = this.intents.read(this.s.input, frameDt * 1000);
    for (const i of intents) {
      if (this.leaving) return;
      this.handle(i);
    }
    if (this.leaving) return;
    if (tickCountdown(this.model, frameDt)) {
      this.launch();
      return;
    }
    if (this.model.countdown !== null) this.dirty = true;
    this.syncPreviews();
    if (this.dirty) {
      this.dirty = false;
      this.s.ui.update('characterSelect', this.vm());
    }
  }

  private handle(i: UiIntent): void {
    const m = this.model;
    if (i.pointer) {
      this.handlePointer(i);
      return;
    }
    if (i.player === 'any') {
      // Shared keys: Escape/Backspace leave; a shared confirm (Enter/NumpadEnter) is ignored because the
      // per-player keys already produce their own intents (NumpadEnter doubles as P2 Special).
      if (i.kind === 'back') this.backToMenu();
      return;
    }
    this.effect(applyPlayerIntent(m, i.player, i.kind, this.rules));
  }

  private handlePointer(i: UiIntent): void {
    const m = this.model;
    if (i.itemId === 'back') {
      this.backToMenu();
      return;
    }
    if (i.itemId === 'mode' && m.joined[1] && (i.kind === 'left' || i.kind === 'right')) {
      toggleMode(m);
      syncCountdown(m);
      this.effect('changed');
      return;
    }
    if (i.player === 'any') return;
    if (i.itemId === 'vehicle' && m.joined[i.player]) m.cursorRows[i.player] = 'vehicle';
    this.effect(applyPlayerIntent(m, i.player, i.kind, this.rules));
  }

  private effect(e: SelectEffect): void {
    switch (e) {
      case 'none':
        return;
      case 'changed':
        this.s.audio.play('uiMove');
        this.dirty = true;
        return;
      case 'denied':
        this.s.audio.play('uiDeny');
        this.dirty = true;
        return;
      case 'backToMenu':
        this.backToMenu();
        return;
    }
  }

  private backToMenu(): void {
    this.s.audio.play('uiBack');
    this.leaving = this.s.fsm.request('MainMenu');
  }

  private syncPreviews(): void {
    const m = this.model;
    const a = m.picks[0];
    const b = m.joined[1] ? m.picks[1] : null;
    if (this.previews[0] === a && this.previews[1] === b) return;
    this.previews = [a, b];
    this.s.render.showVehiclePreviews(this.previews);
  }

  private launch(): void {
    const s = this.s;
    const m = this.model;
    const mode: RunMode = effectiveMode(m);
    const players: LoadoutPick[] = picksOf(m);
    const save = s.save.data;
    const config: RunConfig = {
      runId: s.newRunId(),
      seed: s.env.seedOverride ?? s.newSeed(),
      mode,
      players,
      meta: { ...save.meta },
      autofire: [save.settings.autofire[0], save.settings.autofire[1]],
      focusToggle: [save.settings.focusToggle[0], save.settings.focusToggle[1]],
      themeId: s.theme().id,
    };
    s.session.lastPicks = players;
    s.session.lastMode = mode;
    s.audio.play('uiConfirm');
    this.leaving = s.fsm.request('Playing', { config });
  }

  private vm(): ReturnType<typeof buildCharacterSelectVM> {
    return buildCharacterSelectVM(this.model, this.s.save.data, this.s.theme());
  }
}

export function createCharacterSelectState(s: Services): GameState<'CharacterSelect'> {
  return new CharacterSelectStateImpl(s);
}

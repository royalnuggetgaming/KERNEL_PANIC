/**
 * MainMenu: PLAY, HOW TO PLAY (manual sub-panel), Firmware hangar, TERMINAL (cheat codes), Settings / Controls / Credits sub-panels over the attract backdrop
 * (MenuBackdrop orbit, voxel title), music 'menu'. The Cores balance follows other-tab save changes.
 */
import type { Services } from '../contracts/services';
import type { GameState } from '../contracts/states';
import type { MainMenuVM, MenuItemVM, SubPanel } from '../contracts/ui';
import { IntentReader, indexOfId, wrapIndex, type UiIntent } from './intents';
import { CREDITS, SubPanelController } from './subPanels';

export const MAIN_MENU_ITEM_IDS = [
  'play',
  'manual',
  'hangar',
  'terminal',
  'settings',
  'controls',
  'credits',
] as const;
type MainMenuItemId = (typeof MAIN_MENU_ITEM_IDS)[number];

function menuItems(s: Services): readonly MenuItemVM[] {
  const n = s.theme().names;
  return [
    { id: 'play', label: 'PLAY', enabled: true, hint: 'Co-op, solo or versus: P2 joins on the next screen' },
    {
      id: 'manual',
      label: 'HOW TO PLAY',
      enabled: true,
      hint: 'Controls, rules, every powerup, enemies and bosses',
    },
    {
      id: 'hangar',
      label: n.meta.toUpperCase(),
      enabled: true,
      hint: `Spend ${n.metaCurrency} (earned every run) on permanent upgrades and unlocks`,
    },
    { id: 'terminal', label: 'TERMINAL', enabled: true, hint: 'Access codes... if you know any' },
    { id: 'settings', label: 'SETTINGS', enabled: true, hint: 'Audio, graphics, autofire, accessibility' },
    { id: 'controls', label: 'CONTROLS', enabled: true, hint: 'Rebind keys and run the key test' },
    { id: 'credits', label: 'CREDITS', enabled: true, hint: '' },
  ];
}

class MainMenuStateImpl implements GameState<'MainMenu'> {
  readonly id = 'MainMenu' as const;
  readonly layer = 'base' as const;
  readonly worldBelow = 'none' as const;
  private readonly s: Services;
  private readonly intents = new IntentReader();
  private readonly panels: SubPanelController;
  private items: readonly MenuItemVM[] = [];
  private cursor = 0;
  private dirty = true;
  private leaving = false;
  private unsubExternal: (() => void) | null = null;

  constructor(s: Services) {
    this.s = s;
    this.panels = new SubPanelController(s);
  }

  enter(): void {
    const s = this.s;
    this.items = menuItems(s);
    this.cursor = 0;
    this.leaving = false;
    this.panels.close();
    s.input.setContext('menu');
    s.render.setCameraMode('attract');
    s.audio.setMood('menu');
    this.intents.open(s.ui, 'mainMenu');
    this.unsubExternal = s.save.onExternalChange(() => {
      this.dirty = true;
    });
    s.ui.show('mainMenu', this.vm());
    this.dirty = false;
  }

  exit(): void {
    this.panels.close();
    this.intents.close();
    if (this.unsubExternal !== null) this.unsubExternal();
    this.unsubExternal = null;
    this.s.ui.hide('mainMenu');
  }

  update(frameDt: number): void {
    const intents = this.intents.read(this.s.input, frameDt * 1000);
    for (const i of intents) {
      if (this.leaving) break;
      if (this.panels.handle(i)) continue;
      this.handle(i);
    }
    this.panels.tick();
    if (this.panels.takeDirty()) this.dirty = true;
    if (this.dirty) {
      this.dirty = false;
      this.s.ui.update('mainMenu', this.vm());
    }
  }

  private handle(i: UiIntent): void {
    if (i.kind === 'up' || i.kind === 'down') {
      this.cursor = wrapIndex(this.cursor, i.kind === 'up' ? -1 : 1, this.items.length);
      this.s.audio.play('uiMove');
      this.dirty = true;
      return;
    }
    if (i.kind !== 'confirm') return;
    const target = i.pointer ? indexOfId(this.items, i.itemId) : this.cursor;
    if (target < 0) return;
    this.cursor = target;
    this.dirty = true;
    this.activate(MAIN_MENU_ITEM_IDS[target]!);
  }

  private activate(id: MainMenuItemId): void {
    const s = this.s;
    s.audio.play('uiConfirm');
    switch (id) {
      case 'play':
        this.leaving = s.fsm.request('CharacterSelect', { prefill: null, mode: null });
        return;
      case 'hangar':
        this.leaving = s.fsm.request('UpgradesShop', { mode: 'meta' });
        return;
      case 'manual':
      case 'terminal':
      case 'settings':
      case 'controls':
      case 'credits':
        this.openPanel(id);
        return;
    }
  }

  private openPanel(p: SubPanel): void {
    this.panels.open(p);
  }

  private vm(): MainMenuVM {
    const s = this.s;
    const theme = s.theme();
    return {
      title: theme.title,
      tagline: theme.tagline,
      items: this.items,
      cursor: this.cursor,
      panel: this.panels.panel,
      settings: this.panels.settingsVM(),
      controls: this.panels.controlsVM(),
      credits: CREDITS,
      manual: this.panels.manualVM(),
      terminal: this.panels.terminalVM(),
      metaCurrency: theme.names.metaCurrency,
      cores: s.save.data.cores,
      version: s.env.version,
    };
  }
}

export function createMainMenuState(s: Services): GameState<'MainMenu'> {
  return new MainMenuStateImpl(s);
}

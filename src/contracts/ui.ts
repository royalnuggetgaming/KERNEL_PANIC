/**
 * DOM UI contracts: screen ids, view models (built by states/viewModels.ts, rendered by ui/), UiPort.
 * View models carry display-ready strings; ui/ never imports config or themes. FROZEN after Wave 0.
 */
import type { PlayerIndex, RunMode, RunOutcome, VehicleId } from './ids';
import type { Action, KeyCode, MenuIntent } from './input';
import type { ShopItemStatus } from './run';
import type { PurchaseResult } from './upgrades';

export type ScreenId =
  'boot' | 'mainMenu' | 'characterSelect' | 'hud' | 'shop' | 'hangar' | 'pause' | 'gameOver';

export interface MenuItemVM {
  readonly id: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly hint: string;
}

// ---------------------------------------------------------------- shared sub-panels

export type SettingKind = 'slider' | 'toggle' | 'choice' | 'action';

export interface SettingRowVM {
  readonly id: string;
  readonly label: string;
  readonly kind: SettingKind;
  /** Display value ("80%", "ON", "HIGH"). */
  readonly value: string;
  /** Slider fill 0..1 (0 for other kinds). */
  readonly fraction: number;
}

export interface SettingsPanelVM {
  readonly rows: readonly SettingRowVM[];
  readonly cursor: number;
  readonly note: string;
}

export interface KeyCapVM {
  readonly code: KeyCode;
  readonly label: string;
  readonly held: boolean;
}

export interface ControlsRowVM {
  readonly action: Action;
  readonly label: string;
  readonly keys: readonly KeyCapVM[];
}

export interface ControlsPanelVM {
  readonly players: readonly [readonly ControlsRowVM[], readonly ControlsRowVM[]];
  readonly cursor: { readonly player: PlayerIndex; readonly row: number };
  /** Capturing the next key for (player, action), or null. */
  readonly capturing: { readonly player: PlayerIndex; readonly action: Action } | null;
  /** Swap offer text when the captured code is bound elsewhere, or null. */
  readonly swapOffer: string | null;
  readonly keyTest: {
    readonly active: boolean;
    readonly held: readonly KeyCapVM[];
    readonly maxSimultaneous: number;
    readonly prompt: string;
  };
  readonly message: string;
}

export type SubPanel = 'none' | 'settings' | 'controls' | 'credits';

// ---------------------------------------------------------------- screens

export interface BootVM {
  readonly phase: 'loading' | 'ready' | 'fatal';
  readonly title: string;
  readonly progress: number;
  readonly label: string;
  readonly error: string | null;
}

export interface MainMenuVM {
  readonly title: string;
  readonly tagline: string;
  readonly items: readonly MenuItemVM[];
  readonly cursor: number;
  readonly panel: SubPanel;
  readonly settings: SettingsPanelVM | null;
  readonly controls: ControlsPanelVM | null;
  readonly credits: readonly string[];
  readonly metaCurrency: string;
  readonly cores: number;
  readonly version: string;
}

export interface StatBarVM {
  readonly label: string;
  /** 0..1 relative to the best vehicle. */
  readonly fraction: number;
  readonly value: string;
}

export interface SelectSlotVM {
  readonly player: PlayerIndex;
  readonly joined: boolean;
  readonly vehicle: VehicleId;
  readonly vehicleName: string;
  readonly blurb: string;
  readonly specialName: string;
  readonly locked: boolean;
  /** Core price shown on locked vehicles, else null. */
  readonly unlockPrice: number | null;
  readonly ready: boolean;
  readonly stats: readonly StatBarVM[];
  /** Which row the player's cursor is on (the mode row exists only once P2 joined). */
  readonly cursorRow: 'vehicle' | 'mode';
  readonly joinHint: string;
}

export interface CharacterSelectVM {
  readonly slots: readonly [SelectSlotVM, SelectSlotVM];
  /** 'solo' while P2 is absent; the MODE row toggles coop/versus with left/right once P2 joined. */
  readonly mode: RunMode;
  readonly modeRowVisible: boolean;
  readonly modeLabel: string;
  /** Seconds left in the 0.6 s start countdown, or null. */
  readonly countdown: number | null;
  readonly cores: number;
  readonly metaCurrency: string;
  readonly message: string;
}

export interface HudPlayerVM {
  readonly present: boolean;
  readonly name: string;
  readonly life: 'alive' | 'downed' | 'offline' | 'respawning' | 'absent' | 'eliminated';
  readonly hp: number;
  readonly maxHp: number;
  readonly hpFrac: number;
  readonly dashCharges: number;
  readonly dashMax: number;
  /** Cooldown progress of the next charge 0..1. */
  readonly dashFrac: number;
  readonly overdriveFrac: number;
  readonly wallet: number;
  readonly score: number;
  readonly combo: number;
  readonly comboTier: number;
  readonly comboFrac: number;
  readonly bleedFrac: number;
  readonly reviveFrac: number;
  /** Versus round wins (pips). */
  readonly roundWins: number;
}

export interface HudVM {
  readonly mode: RunMode;
  readonly players: readonly [HudPlayerVM, HudPlayerVM];
  /** "SECTOR 2 / CYCLE 7" or "ROUND 3" (theme terms). */
  readonly waveLabel: string;
  /** mm:ss of the wave/round timer. */
  readonly timer: string;
  readonly kernels: number;
  readonly livesLabel: string;
  readonly runCurrency: string;
  readonly boss: { readonly visible: boolean; readonly name: string; readonly hpFrac: number };
  readonly banner: { readonly visible: boolean; readonly text: string; readonly sub: string };
  readonly versus: {
    readonly visible: boolean;
    readonly round: number;
    readonly roundWins: readonly [number, number];
    readonly suddenDeath: boolean;
  };
  readonly fps: string | null;
}

export interface ShopRowVM {
  readonly id: string;
  readonly label: string;
  readonly blurb: string;
  readonly level: number;
  readonly maxLevel: number;
  readonly price: number | null;
  readonly status: ShopItemStatus;
}

export interface ShopCardVM extends ShopRowVM {
  readonly rarity: 'C' | 'U' | 'R' | 'L';
  readonly locked: boolean;
}

export interface ShopPanelVM {
  readonly player: PlayerIndex;
  readonly present: boolean;
  readonly name: string;
  readonly wallet: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly rows: readonly ShopRowVM[];
  readonly repair: ShopRowVM;
  readonly cards: readonly ShopCardVM[];
  /** Empty when the team row is hidden (versus). */
  readonly team: readonly ShopRowVM[];
  readonly reroll: ShopRowVM;
  /** null when Gift is hidden (solo, versus). */
  readonly gift: ShopRowVM | null;
  /** Cursor: flat row index over [rows, repair, cards, team, reroll, gift, ready]; col 1 = Lock on cards. */
  readonly cursor: { readonly row: number; readonly col: 0 | 1 };
  readonly ready: boolean;
  readonly canUndo: boolean;
  readonly lastResult: PurchaseResult | null;
  readonly toast: string | null;
}

export interface ShopVM {
  readonly mode: RunMode;
  readonly title: string;
  readonly subtitle: string;
  readonly runCurrency: string;
  readonly panels: readonly [ShopPanelVM, ShopPanelVM];
  readonly teamVisible: boolean;
  readonly kernels: number;
  readonly finalChoice: {
    readonly visible: boolean;
    readonly selected: 'extract' | 'pushDeeper' | null;
    readonly extractLabel: string;
    readonly pushLabel: string;
  };
  readonly countdown: number | null;
}

export interface HangarItemVM extends ShopRowVM {
  readonly kind: 'meta' | 'unlock' | 'respec';
}

export interface HangarVM {
  readonly title: string;
  readonly metaCurrency: string;
  readonly cores: number;
  readonly items: readonly HangarItemVM[];
  readonly cursor: number;
  readonly respecRefund: number;
  readonly message: string;
  readonly readOnly: boolean;
}

export interface PauseVM {
  readonly items: readonly MenuItemVM[];
  readonly cursor: number;
  /** 0..1 hold-to-confirm progress of Abandon (600 ms). */
  readonly abandonHold: number;
  readonly panel: SubPanel;
  readonly settings: SettingsPanelVM | null;
  readonly controls: ControlsPanelVM | null;
  readonly reason: string;
}

export interface GameOverPlayerVM {
  readonly player: PlayerIndex;
  readonly name: string;
  readonly vehicleName: string;
  readonly score: number;
  readonly kills: number;
  readonly damage: number;
  readonly shards: number;
  readonly revives: number;
  readonly bestCombo: number;
  readonly roundWins: number;
  readonly mvp: boolean;
  readonly winner: boolean;
}

export interface CoresLineVM {
  readonly label: string;
  readonly amount: number;
}

export interface GameOverVM {
  readonly outcome: RunOutcome;
  readonly mode: RunMode;
  readonly title: string;
  readonly subtitle: string;
  /** Versus winner (null otherwise or on a draw/abandon). */
  readonly winner: PlayerIndex | null;
  readonly players: readonly GameOverPlayerVM[];
  readonly waveReached: number;
  readonly duration: string;
  readonly cores: readonly CoresLineVM[];
  readonly coresTotal: number;
  readonly coresCapped: boolean;
  readonly metaCurrency: string;
  readonly newBest: boolean;
  readonly items: readonly MenuItemVM[];
  readonly cursor: number;
}

export interface ScreenVMs {
  boot: BootVM;
  mainMenu: MainMenuVM;
  characterSelect: CharacterSelectVM;
  hud: HudVM;
  shop: ShopVM;
  hangar: HangarVM;
  pause: PauseVM;
  gameOver: GameOverVM;
}

export type ToastKind = 'info' | 'warn' | 'error';

export interface PointerIntent extends MenuIntent {
  readonly screen: ScreenId;
  /** Clicked item id (menu item, shop row id, setting id) when applicable. */
  readonly itemId: string | null;
}

export interface UiPort {
  /** Mounts/unhides a screen with an initial VM. */
  show<S extends ScreenId>(s: S, vm: ScreenVMs[S]): void;
  /** Diffs against the last VM; DOM writes are queued until flush(). */
  update<S extends ScreenId>(s: S, vm: ScreenVMs[S]): void;
  hide(s: ScreenId): void;
  toast(msg: string, kind: ToastKind): void;
  /** Mouse clicks become MenuIntents. Returns an unsubscribe function. */
  onPointerIntent(cb: (i: PointerIntent) => void): () => void;
  /** Applies queued DOM writes once per frame. */
  flush(): void;
}

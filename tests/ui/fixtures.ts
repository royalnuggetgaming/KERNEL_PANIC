/** View-model fixtures for UI tests (display-ready strings, as states/viewModels.ts would build them). */
import type { PlayerIndex } from '../../src/contracts/ids';
import type {
  BootVM,
  CharacterSelectVM,
  GameOverPlayerVM,
  GameOverVM,
  HangarVM,
  HudPlayerVM,
  HudVM,
  InstalledItemVM,
  MainMenuVM,
  ManualVM,
  PauseVM,
  SelectSlotVM,
  ShopCardVM,
  ShopPanelVM,
  ShopRowVM,
  ShopVM,
} from '../../src/contracts/ui';

export function bootVM(patch: Partial<BootVM> = {}): BootVM {
  return {
    phase: 'loading',
    title: 'KERNEL PANIC',
    progress: 0.4,
    label: 'Building shaders',
    error: null,
    ...patch,
  };
}

export function mainMenuVM(patch: Partial<MainMenuVM> = {}): MainMenuVM {
  return {
    title: 'KERNEL PANIC',
    tagline: 'Purge the corrupted processes.',
    items: [
      { id: 'play', label: 'PLAY', enabled: true, hint: 'Start a run' },
      { id: 'firmware', label: 'FIRMWARE', enabled: true, hint: 'Permanent upgrades' },
      { id: 'settings', label: 'SETTINGS', enabled: true, hint: '' },
      { id: 'locked', label: 'LOCKED', enabled: false, hint: '' },
    ],
    cursor: 0,
    panel: 'none',
    settings: null,
    controls: null,
    credits: ['Made with three.js'],
    manual: null,
    metaCurrency: 'Cores',
    cores: 1234,
    version: 'v0.1.0',
    ...patch,
  };
}

export function hudPlayerVM(patch: Partial<HudPlayerVM> = {}): HudPlayerVM {
  return {
    present: true,
    name: 'LANCER',
    life: 'alive',
    hp: 80,
    maxHp: 100,
    hpFrac: 0.8,
    dashCharges: 1,
    dashMax: 2,
    dashFrac: 0.5,
    overdriveFrac: 0.3,
    wallet: 1500,
    score: 12000,
    combo: 12,
    comboTier: 1,
    comboFrac: 0.6,
    bleedFrac: 0,
    reviveFrac: 0,
    roundWins: 0,
    loadout: [],
    loadoutKey: 0,
    ...patch,
  };
}

export function hudVM(patch: Partial<HudVM> = {}): HudVM {
  return {
    mode: 'coop',
    players: [hudPlayerVM(), hudPlayerVM({ name: 'BULWARK' })],
    waveLabel: 'SECTOR 1 / CYCLE 2',
    timer: '0:41',
    kernels: 2,
    livesLabel: 'SPARE KERNELS',
    runCurrency: 'Bits',
    boss: { visible: false, name: '', hpFrac: 0 },
    banner: { visible: false, text: '', sub: '' },
    versus: { visible: false, round: 0, roundWins: [0, 0], suddenDeath: false },
    fps: null,
    ...patch,
  };
}

export function row(id: string, patch: Partial<ShopRowVM> = {}): ShopRowVM {
  return {
    id,
    label: id.toUpperCase(),
    blurb: `${id} blurb`,
    next: `${id} next`,
    level: 1,
    maxLevel: 5,
    price: 40,
    status: 'available',
    ...patch,
  };
}

export function card(id: string, patch: Partial<ShopCardVM> = {}): ShopCardVM {
  return { ...row(id, { maxLevel: 0 }), rarity: 'R', locked: false, ...patch };
}

export function shopPanelVM(player: PlayerIndex, patch: Partial<ShopPanelVM> = {}): ShopPanelVM {
  return {
    player,
    present: true,
    name: player === 0 ? 'LANCER' : 'SPECTER',
    wallet: 250,
    hp: 60,
    maxHp: 100,
    rows: [row('thrusters'), row('plating')],
    repair: row('repair', { maxLevel: 0, price: 25 }),
    cards: [card('splitShot'), card('pierce', { rarity: 'L', locked: true }), card('bounty')],
    team: [row('spareKernel', { maxLevel: 0 }), row('linkAmp')],
    reroll: row('reroll', { maxLevel: 0, price: 10 }),
    gift: row('gift', { maxLevel: 0, price: 10 }),
    cursor: { row: 0, col: 0 },
    ready: false,
    canUndo: false,
    lastResult: null,
    toast: null,
    installed: [],
    ...patch,
  };
}

export function shopVM(patch: Partial<ShopVM> = {}): ShopVM {
  return {
    mode: 'coop',
    title: 'PATCH BAY',
    subtitle: 'CYCLE 2 CLEARED',
    runCurrency: 'Bits',
    panels: [shopPanelVM(0), shopPanelVM(1)],
    teamVisible: true,
    kernels: 2,
    finalChoice: { visible: false, selected: null, extractLabel: 'EXTRACT', pushLabel: 'PUSH DEEPER' },
    countdown: null,
    ...patch,
  };
}

export function hangarVM(patch: Partial<HangarVM> = {}): HangarVM {
  return {
    title: 'FIRMWARE',
    metaCurrency: 'Cores',
    cores: 300,
    items: [
      { ...row('hullFw'), kind: 'meta' },
      { ...row('specter', { maxLevel: 0, price: 60 }), kind: 'unlock' },
      { ...row('respec', { maxLevel: 0, price: null }), kind: 'respec' },
    ],
    cursor: 0,
    respecRefund: 120,
    message: '',
    readOnly: false,
    ...patch,
  };
}

export function pauseVM(patch: Partial<PauseVM> = {}): PauseVM {
  return {
    items: [
      { id: 'resume', label: 'RESUME', enabled: true, hint: '' },
      { id: 'abandon', label: 'ABANDON', enabled: true, hint: 'Hold to abandon' },
    ],
    cursor: 0,
    abandonHold: 0,
    panel: 'none',
    settings: null,
    controls: null,
    reason: 'Paused',
    manual: null,
    loadouts: [],
    ...patch,
  };
}

export function slotVM(player: PlayerIndex, patch: Partial<SelectSlotVM> = {}): SelectSlotVM {
  return {
    player,
    joined: true,
    vehicle: 'lancer',
    vehicleName: 'LANCER',
    blurb: 'Balanced daemon.',
    specialName: 'RAILBURST',
    locked: false,
    unlockPrice: null,
    ready: false,
    stats: [
      { label: 'HULL', fraction: 0.66, value: '100' },
      { label: 'SPEED', fraction: 0.85, value: '12' },
    ],
    cursorRow: 'vehicle',
    joinHint: 'PRESS FIRE TO JOIN',
    ...patch,
  };
}

export function selectVM(patch: Partial<CharacterSelectVM> = {}): CharacterSelectVM {
  return {
    slots: [slotVM(0), slotVM(1, { joined: false })],
    mode: 'solo',
    modeRowVisible: false,
    modeLabel: '',
    countdown: null,
    cores: 90,
    metaCurrency: 'Cores',
    message: '',
    difficulty: 'NORMAL',
    ...patch,
  };
}

export function goPlayer(player: PlayerIndex, patch: Partial<GameOverPlayerVM> = {}): GameOverPlayerVM {
  return {
    player,
    name: player === 0 ? 'LANCER' : 'TINKER',
    vehicleName: player === 0 ? 'LANCER' : 'TINKER',
    score: 10000,
    kills: 120,
    damage: 45000,
    shards: 900,
    revives: 2,
    bestCombo: 34,
    roundWins: 0,
    mvp: player === 0,
    winner: false,
    ...patch,
  };
}

export function gameOverVM(patch: Partial<GameOverVM> = {}): GameOverVM {
  return {
    outcome: 'defeat',
    mode: 'coop',
    title: 'SYSTEM FAILURE',
    subtitle: 'Reached cycle 7',
    winner: null,
    players: [goPlayer(0), goPlayer(1)],
    waveReached: 7,
    duration: '8:12',
    cores: [
      { label: 'Bits earned', amount: 90 },
      { label: 'Cycles cleared', amount: 18 },
    ],
    coresTotal: 108,
    coresCapped: false,
    metaCurrency: 'Cores',
    newBest: true,
    items: [
      { id: 'retry', label: 'RETRY', enabled: true, hint: '' },
      { id: 'menu', label: 'MENU', enabled: true, hint: '' },
    ],
    cursor: 0,
    ...patch,
  };
}

export function installedItem(id: string, patch: Partial<InstalledItemVM> = {}): InstalledItemVM {
  return {
    id,
    kind: 'stat',
    label: id,
    short: id.slice(0, 3).toUpperCase(),
    count: '1',
    desc: `${id} desc`,
    ...patch,
  };
}

export function manualVM(patch: Partial<ManualVM> = {}): ManualVM {
  return {
    pages: [
      {
        id: 'goal',
        title: 'Goal',
        blocks: [
          { kind: 'p', term: '', text: 'Survive.' },
          { kind: 'item', term: 'Move', text: 'W A S D' },
        ],
      },
      { id: 'tips', title: 'Tips', blocks: [{ kind: 'h', term: '', text: 'Dash' }] },
    ],
    page: 0,
    hint: 'hint',
    ...patch,
  };
}

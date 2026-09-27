/**
 * HUD view model writer. PlayingState calls write() every frame; it fills one of two preallocated mutable
 * HudVMs (alternating, so the UI sees a new identity each frame) without allocating: strings are rebuilt only
 * when the value they show changes. The UI throttles text to 10 Hz on its side.
 */
import type { PlayerIndex } from '../contracts/ids';
import type { PlayerEntity } from '../contracts/sim';
import type { SimEvents } from '../contracts/simEvents';
import type { ThemeDef } from '../contracts/theme';
import type { HudPlayerVM, HudVM } from '../contracts/ui';
import type { WorldView } from '../contracts/world';
import { COMBO, COOP, OVERDRIVE } from '../config/tuning';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

interface MutableHud {
  mode: HudVM['mode'];
  players: [Mutable<HudPlayerVM>, Mutable<HudPlayerVM>];
  waveLabel: string;
  timer: string;
  kernels: number;
  livesLabel: string;
  runCurrency: string;
  boss: Mutable<HudVM['boss']>;
  banner: Mutable<HudVM['banner']>;
  versus: { visible: boolean; round: number; roundWins: [number, number]; suddenDeath: boolean };
  fps: string | null;
}

/** How long a transient event banner (sync kill) stays up, in frames' worth of seconds. */
const TRANSIENT_S = 0.9;

const B_NONE = 0;
const B_COUNTDOWN = 1;
const B_PURGE = 2;
const B_CLEARED = 3;
const B_ROUND_END = 4;
const B_BOSS = 5;
const B_WIPE = 6;
const B_SYNC = 7;
const B_SUDDEN = 8;

function blankPlayer(): Mutable<HudPlayerVM> {
  return {
    present: false,
    name: '',
    life: 'absent',
    hp: 0,
    maxHp: 1,
    hpFrac: 0,
    dashCharges: 0,
    dashMax: 1,
    dashFrac: 1,
    overdriveFrac: 0,
    wallet: 0,
    score: 0,
    combo: 0,
    comboTier: 0,
    comboFrac: 0,
    bleedFrac: 0,
    reviveFrac: 0,
    roundWins: 0,
  };
}

function blankHud(theme: ThemeDef): MutableHud {
  return {
    mode: 'coop',
    players: [blankPlayer(), blankPlayer()],
    waveLabel: '',
    timer: '0:00',
    kernels: 0,
    livesLabel: theme.names.lives.toUpperCase(),
    runCurrency: theme.names.runCurrency,
    boss: { visible: false, name: '', hpFrac: 0 },
    banner: { visible: false, text: '', sub: '' },
    versus: { visible: false, round: 0, roundWins: [0, 0], suddenDeath: false },
    fps: null,
  };
}

function frac(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** m:ss for the wave timer (states cannot import ui/format). */
export function clockText(seconds: number): string {
  const t = Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 0;
  const s = t % 60;
  return `${Math.floor(t / 60)}:${s < 10 ? '0' : ''}${s}`;
}

function bleedTotal(p: Readonly<PlayerEntity>): number {
  return Math.max(COOP.BLEED_MIN, COOP.BLEED_OUT - COOP.BLEED_STEP * Math.max(0, p.downsThisWave - 1));
}

export class HudVmWriter {
  private readonly buffers: readonly [MutableHud, MutableHud];
  private flip = 0;
  private readonly theme: ThemeDef;
  private waveKey = -1;
  private waveLabel = '';
  private timerKey = -1;
  private timer = '0:00';
  private bannerKey = -1;
  private bannerText = '';
  private bannerSub = '';
  private transientLeft = 0;
  private transientKind = B_NONE;
  private transientPlayer: PlayerIndex | -1 = -1;
  private bannerValue = 0;

  constructor(theme: ThemeDef) {
    this.theme = theme;
    this.buffers = [blankHud(theme), blankHud(theme)];
  }

  /** Notes transient banners (sync kills) from this frame's events. Call before clearEvents(). */
  noteEvents(e: SimEvents, frameDt: number): void {
    if (this.transientLeft > 0) this.transientLeft -= frameDt;
    const ch = e.wave;
    for (let i = 0; i < ch.count; i++) {
      const ev = ch.get(i);
      if (ev.what === 'sync') {
        this.transientKind = B_SYNC;
        this.transientPlayer = ev.player;
        this.transientLeft = TRANSIENT_S;
      }
    }
  }

  write(w: WorldView, fps: string | null): HudVM {
    this.flip ^= 1;
    const vm = this.buffers[this.flip]!;
    const run = w.run;
    const versus = w.mode === 'versus';
    vm.mode = w.mode;
    this.writePlayer(vm.players[0], w, 0, versus);
    this.writePlayer(vm.players[1], w, 1, versus);
    this.updateWaveLabel(w);
    vm.waveLabel = this.waveLabel;
    const tKey = run.phase === 'countdown' ? -2 : Math.ceil(Math.max(0, run.waveTimer));
    if (tKey !== this.timerKey) {
      this.timerKey = tKey;
      this.timer = clockText(run.phase === 'countdown' ? run.waveDuration : run.waveTimer);
    }
    vm.timer = this.timer;
    vm.kernels = run.spareKernels;
    this.writeBoss(vm, w);
    this.writeBanner(vm, w);
    vm.versus.visible = versus;
    vm.versus.round = run.round;
    vm.versus.roundWins[0] = run.roundWins[0];
    vm.versus.roundWins[1] = run.roundWins[1];
    vm.versus.suddenDeath = run.suddenDeath;
    vm.fps = fps;
    return vm;
  }

  private writePlayer(o: Mutable<HudPlayerVM>, w: WorldView, i: PlayerIndex, versus: boolean): void {
    const p = w.players[i];
    const present = p.life !== 'absent';
    o.present = present;
    o.name = this.theme.names.vehicles[p.vehicle];
    o.life = versus && p.life === 'downed' ? 'eliminated' : p.life;
    const maxHp = p.stats.maxHp > 0 ? p.stats.maxHp : 1;
    o.hp = p.hp > 0 ? p.hp : 0;
    o.maxHp = maxHp;
    o.hpFrac = frac(p.hp / maxHp);
    o.dashCharges = p.dashCharges;
    o.dashMax = p.stats.dashCharges;
    o.dashFrac =
      p.dashCharges >= p.stats.dashCharges || p.stats.dashCooldown <= 0
        ? 1
        : frac(1 - p.dashCooldownLeft / p.stats.dashCooldown);
    o.overdriveFrac = frac(p.overdrive / OVERDRIVE.MAX);
    o.wallet = w.run.wallets[i];
    o.score = p.score;
    o.combo = p.combo;
    o.comboTier = p.comboTier;
    o.comboFrac = p.combo > 0 ? frac(p.comboTimer / COMBO.WINDOW) : 0;
    o.bleedFrac = p.life === 'downed' && !versus ? frac(p.bleedLeft / bleedTotal(p)) : 0;
    o.reviveFrac = p.life === 'downed' ? frac(p.reviveProgress) : 0;
    o.roundWins = w.run.roundWins[i];
  }

  private updateWaveLabel(w: WorldView): void {
    const run = w.run;
    const key =
      w.mode === 'versus' ? 1_000_000 + run.round : run.wave * 10 + run.sector + (run.overflow ? 5 : 0);
    if (key === this.waveKey) return;
    this.waveKey = key;
    const n = this.theme.names;
    if (w.mode === 'versus') this.waveLabel = `ROUND ${run.round}`;
    else if (run.overflow) this.waveLabel = `${n.overflow} / ${n.wave.toUpperCase()} ${run.wave}`;
    else this.waveLabel = `${n.sector.toUpperCase()} ${run.sector} / ${n.wave.toUpperCase()} ${run.wave}`;
  }

  private writeBoss(vm: MutableHud, w: WorldView): void {
    let hp = 0;
    let max = 0;
    let first = -1;
    for (let i = 0; i < w.bosses.length; i++) {
      const b = w.bosses[i]!;
      if (!b.alive) continue;
      if (first < 0) first = i;
      hp += b.hp > 0 ? b.hp : 0;
      max += b.maxHp;
    }
    vm.boss.visible = first >= 0;
    if (first >= 0) {
      vm.boss.name = this.theme.names.bosses[w.bosses[first]!.id];
      vm.boss.hpFrac = max > 0 ? frac(hp / max) : 0;
    }
  }

  /** Banner kind (B_*) of the current world state; the kind's value goes to this.bannerValue. */
  private bannerCode(w: WorldView): number {
    const run = w.run;
    this.bannerValue = 0;
    if (run.wipeGrace >= 0) return B_WIPE;
    switch (run.phase) {
      case 'countdown':
        this.bannerValue = Math.ceil(Math.max(0, run.phaseTimer));
        return B_COUNTDOWN;
      case 'purge':
        return B_PURGE;
      case 'clearOutro':
        return B_CLEARED;
      case 'roundOutro':
        this.bannerValue = run.roundWinner + 3;
        return B_ROUND_END;
      case 'idle':
      case 'combat':
      case 'boss':
      case 'done':
        break;
    }
    for (let i = 0; i < w.bosses.length; i++) {
      const b = w.bosses[i]!;
      if (b.alive && b.introTimer > 0) {
        this.bannerValue = i;
        return B_BOSS;
      }
    }
    if (run.suddenDeath) return B_SUDDEN;
    if (this.transientLeft > 0) {
      this.bannerValue = this.transientPlayer + 1;
      return this.transientKind;
    }
    return B_NONE;
  }

  private writeBanner(vm: MutableHud, w: WorldView): void {
    const code = this.bannerCode(w);
    const value = this.bannerValue;
    const unit = w.mode === 'versus' ? w.run.round : w.run.wave;
    const key = code * 10_000_000 + unit * 1000 + value;
    if (key !== this.bannerKey) {
      this.bannerKey = key;
      this.setBannerText(code, value, w);
    }
    vm.banner.visible = code !== B_NONE;
    vm.banner.text = this.bannerText;
    vm.banner.sub = this.bannerSub;
  }

  private setBannerText(code: number, value: number, w: WorldView): void {
    const n = this.theme.names;
    const run = w.run;
    const unitName = w.mode === 'versus' ? 'ROUND' : n.wave.toUpperCase();
    const unit = w.mode === 'versus' ? run.round : run.wave;
    let text = '';
    let sub = '';
    if (code === B_COUNTDOWN) {
      text = `${unitName} ${unit}`;
      sub = String(value);
    } else if (code === B_PURGE) {
      text = 'PURGE';
      sub = 'Survivors de-rez';
    } else if (code === B_CLEARED) {
      text = `${unitName} ${unit} CLEARED`;
    } else if (code === B_ROUND_END) {
      const winner = value - 3;
      text = winner === 0 ? 'P1 TAKES THE ROUND' : winner === 1 ? 'P2 TAKES THE ROUND' : 'ROUND DRAWN';
      sub = `${run.roundWins[0]} : ${run.roundWins[1]}`;
    } else if (code === B_BOSS) {
      const b = w.bosses[value];
      text = b === undefined ? '' : n.bosses[b.id];
      sub = 'BOSS PROCESS';
    } else if (code === B_WIPE) {
      text = 'SYSTEM FAILURE';
    } else if (code === B_SUDDEN) {
      text = 'SUDDEN DEATH';
    } else if (code === B_SYNC) {
      text = 'SYNC KILL';
    }
    this.bannerText = text;
    this.bannerSub = sub;
  }
}

/** Pure HUD VM builder (allocates a fresh VM; PlayingState uses HudVmWriter directly). */
export function buildHudVM(w: WorldView, theme: ThemeDef, fps: string | null): HudVM {
  return new HudVmWriter(theme).write(w, fps);
}

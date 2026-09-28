/**
 * Playing (plan section 3, docs/ARCHITECTURE.md "Event flow").
 * enter{config}: session.current = createRun(config); attach the world to the renderer; HUD; music 'combat';
 *   run.beginNextWave() starts wave/round 1 (with its countdown).
 * fixedUpdate: input.sample for both players -> run.tick(intents) -> run.flags request UpgradesShop{midrun}
 *   (waveClearReady / roundOver) or GameOver (defeat / versus matchOver); the requested accumulator time scale
 *   (clear slow-mo) is forwarded to the loop.
 * update: SimEvents drained ONCE per frame to render, audio and HUD, then run.clearEvents(); pause intents;
 *   music mood / intensity / sector; HUD VM.
 * onCovered: one frozen frame, music duck. onUncovered: resetAccumulator; after the shop applyShopResults +
 *   beginNextWave (OVERFLOW / next round handled by the session); after Pause the music is restored.
 * exit (always a replace to GameOver): the session stays in services.session for GameOver; HUD unmounted.
 * Hot paths (fixedUpdate/update/render) do not allocate.
 */
import type { MusicMood } from '../contracts/audio';
import type { MenuIntent, PlayerIntent } from '../contracts/input';
import type { RunSessionApi } from '../contracts/run';
import type { Services } from '../contracts/services';
import type { GameState, StateId, StatePayloads } from '../contracts/states';
import type { WorldView } from '../contracts/world';
import { HudVmWriter } from './hudViewModel';

/** Dim of the frozen composite frame under overlays. */
export const FREEZE_DIM = 0.55;
const FPS_REFRESH_S = 0.5;
const INTENSITY_EPS = 0.04;
const MENU_BUFFER = 8;

function blankIntent(): PlayerIntent {
  return {
    moveX: 0,
    moveZ: 0,
    fireHeld: false,
    focusHeld: false,
    dashPressed: false,
    specialPressed: false,
  };
}

function bossAlive(w: WorldView): boolean {
  for (let i = 0; i < w.bosses.length; i++) if (w.bosses[i]!.alive) return true;
  return false;
}

/** 0..1 music intensity from the live world (enemy pressure, boss, low HP). */
export function musicIntensity(w: WorldView): number {
  const phase = w.run.phase;
  if (phase === 'countdown' || phase === 'clearOutro' || phase === 'roundOutro' || phase === 'done')
    return 0.2;
  let x = Math.min(1, w.enemies.count / 90) * 0.7 + 0.15;
  if (bossAlive(w)) x += 0.35;
  for (let i = 0; i < 2; i++) {
    const p = w.players[i === 0 ? 0 : 1];
    if (p.life === 'alive' && p.stats.maxHp > 0 && p.hp / p.stats.maxHp < 0.3) x += 0.1;
  }
  return Math.min(1, x);
}

class PlayingStateImpl implements GameState<'Playing'> {
  readonly id = 'Playing' as const;
  readonly layer = 'base' as const;
  readonly worldBelow = 'none' as const;
  private readonly s: Services;
  private run: RunSessionApi | null = null;
  private hud: HudVmWriter | null = null;
  private readonly intents: [PlayerIntent, PlayerIntent] = [blankIntent(), blankIntent()];
  private readonly menu: MenuIntent[] = Array.from({ length: MENU_BUFFER }, (): MenuIntent => ({
    player: 'any',
    kind: 'up',
  }));
  private covered = false;
  /** A transition was requested this visit; the sim stops stepping until it is applied. */
  private requested = false;
  private timeScale = 1;
  private sector = 0;
  private mood: MusicMood = 'silent';
  private intensity = -1;
  private fps: string | null = null;
  private fpsTimer = 0;
  private readonly viewRect = (minX: number, maxX: number, minZ: number, maxZ: number): void => {
    this.run?.setViewRect(minX, maxX, minZ, maxZ);
  };

  constructor(s: Services) {
    this.s = s;
  }

  enter(payload: StatePayloads['Playing']): void {
    const s = this.s;
    const config = payload.config;
    const run = s.createRun(config);
    this.run = run;
    s.session.current = run;
    this.covered = false;
    this.requested = false;
    this.sector = 0;
    this.mood = 'silent';
    this.intensity = -1;
    this.fps = null;
    this.fpsTimer = 0;
    s.input.setContext('gameplay');
    s.input.setSolo(config.mode === 'solo');
    s.input.setFireModes(config.autofire, config.focusToggle);
    s.render.attachWorld(run.world, this.viewRect);
    s.render.setCameraMode('follow');
    s.audio.duck(false);
    run.beginNextWave();
    this.syncMusic(run.world);
    this.hud = new HudVmWriter(s.theme(), run, () => s.save.data.bindings);
    s.ui.show('hud', this.hud.write(run.world, null));
    this.setTimeScale(1);
    s.loop.resetAccumulator();
    s.perf.setPlaying(true);
  }

  exit(): void {
    const s = this.s;
    s.perf.setPlaying(false);
    this.setTimeScale(1);
    s.ui.hide('hud');
    s.input.setContext('menu');
    // services.session.current stays set: GameOver summarises, renders and finally disposes the run.
    this.run = null;
    this.hud = null;
  }

  fixedUpdate(): void {
    const run = this.run;
    if (run === null || this.covered || this.requested) return;
    const input = this.s.input;
    input.sample(0, this.intents[0]);
    input.sample(1, this.intents[1]);
    run.tick(this.intents);
    const scale = run.world.run.timeScaleRequest;
    if (scale !== this.timeScale) this.setTimeScale(scale);
    this.checkFlags(run);
  }

  update(frameDt: number): void {
    const run = this.run;
    const hud = this.hud;
    if (run === null || hud === null) return;
    const s = this.s;
    const w = run.world;
    const events = w.events;
    s.render.consumeEvents(events);
    s.audio.consumeEvents(events);
    hud.noteEvents(events, frameDt);
    run.clearEvents();

    const n = s.input.pollMenu(frameDt * 1000, this.menu);
    for (let i = 0; i < n; i++) {
      if (this.menu[i]!.kind === 'pause' && !this.requested && !this.covered) {
        this.requested = s.fsm.request('Paused', { reason: 'user' });
      }
    }

    this.syncMusic(w);
    this.updateFps(frameDt);
    s.ui.update('hud', hud.write(w, this.fps));
  }

  render(alpha: number, frameDt: number): void {
    if (this.run === null || this.covered) return;
    this.s.render.setBeat(this.s.audio.beatPhase);
    this.s.render.frame(alpha, frameDt);
  }

  onCovered(): void {
    const s = this.s;
    this.covered = true;
    s.render.renderFrozen(FREEZE_DIM);
    s.audio.duck(true);
    s.perf.setPlaying(false);
    this.setTimeScale(1);
  }

  onUncovered(from: StateId): void {
    const s = this.s;
    const run = this.run;
    this.covered = false;
    s.loop.resetAccumulator();
    s.input.setContext('gameplay');
    if (run !== null) s.input.setSolo(run.config.mode === 'solo');
    s.perf.setPlaying(true);
    s.audio.duck(false);
    if (from === 'UpgradesShop' && run !== null) {
      run.applyShopResults();
      run.beginNextWave();
      this.mood = 'silent';
      this.syncMusic(run.world);
    }
    this.requested = false;
  }

  private checkFlags(run: RunSessionApi): void {
    const f = run.flags;
    const s = this.s;
    if (run.config.mode === 'versus') {
      if (f.matchOver) this.requested = s.fsm.request('GameOver', { outcome: 'victory' });
      else if (f.roundOver) this.requested = s.fsm.request('UpgradesShop', { mode: 'midrun' });
      return;
    }
    // rules.ts already applies the tie-break (a wave clear beats a wipe on the same tick).
    if (f.waveClearReady) this.requested = s.fsm.request('UpgradesShop', { mode: 'midrun' });
    else if (f.defeat) {
      // Dying in OVERFLOW after beating the final boss still ends a won run.
      const outcome = run.world.run.victoryAchieved ? 'victory' : 'defeat';
      this.requested = s.fsm.request('GameOver', { outcome });
    }
  }

  private setTimeScale(x: number): void {
    const v = Number.isFinite(x) && x > 0 ? x : 1;
    this.timeScale = v;
    this.s.loop.setTimeScale(v);
  }

  private syncMusic(w: WorldView): void {
    const s = this.s;
    const sector = w.run.sector;
    if (sector !== this.sector) {
      this.sector = sector;
      s.render.setSector(sector);
      s.audio.setSector(sector);
    }
    const mood: MusicMood = bossAlive(w) ? 'boss' : 'combat';
    if (mood !== this.mood) {
      this.mood = mood;
      s.audio.setMood(mood);
    }
    const x = musicIntensity(w);
    if (Math.abs(x - this.intensity) > INTENSITY_EPS) {
      this.intensity = x;
      s.audio.setIntensity(x);
    }
  }

  private updateFps(frameDt: number): void {
    if (!this.s.save.data.settings.showFps) {
      this.fps = null;
      return;
    }
    this.fpsTimer -= frameDt;
    if (this.fps !== null && this.fpsTimer > 0) return;
    this.fpsTimer = FPS_REFRESH_S;
    this.fps = `${Math.round(this.s.perf.snapshot().avgFps)} FPS`;
  }
}

export function createPlayingState(s: Services): GameState<'Playing'> {
  return new PlayingStateImpl(s);
}

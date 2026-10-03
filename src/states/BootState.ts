/**
 * Boot (plan section 3): enter() starts the async pipeline; update() polls its progress into BootScreen.
 *   1. WebGL2 / float-target check (fatal panel without WebGL2; LDR fallback without EXT_color_buffer_float)
 *   2. load + migrate the save (status toasts), apply settings and bindings live
 *   3. resolve the theme from the save's settings
 *   4. incremental AssetLibrary build, 5. ShaderWarmup, 6. baseline render stats
 *   7. 'Press any key': the first key press or click awaits audio.unlock(), then requests MainMenu.
 * exit() hides the screen; the warm scene holds only shared resources, so nothing is disposed here.
 */
import type { SaveStatus } from '../contracts/save';
import type { Services } from '../contracts/services';
import type { GameState } from '../contracts/states';
import type { BootVM, ToastKind } from '../contracts/ui';
import { getTheme } from '../themes/registry';
import { IntentReader } from './intents';
import { applySettingsLive } from './settingsPanel';

type BootPhase = 'loading' | 'ready' | 'unlocking' | 'done' | 'leaving' | 'fatal';

const P_SAVE = 0.05;
const P_BUILD_START = 0.1;
const P_BUILD_SPAN = 0.7;
const P_WARMUP = 0.85;

export const WEBGL2_MISSING = 'WebGL2 is not available in this browser.';

const SAVE_TOASTS: Readonly<Record<SaveStatus, { msg: string; kind: ToastKind } | null>> = {
  ok: null,
  restoredBackup: { msg: 'Save was damaged: restored the backup.', kind: 'warn' },
  reset: { msg: 'Save was unreadable: starting fresh (the old data was kept aside).', kind: 'error' },
  readOnlyFuture: {
    msg: 'This save comes from a newer version: running read-only, nothing will be saved.',
    kind: 'warn',
  },
  memoryOnly: {
    msg: 'Storage is unavailable or full (private mode?): progress will not be saved.',
    kind: 'warn',
  },
};

function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === 'string' ? e : 'Unknown error';
}

class BootStateImpl implements GameState<'Boot'> {
  readonly id = 'Boot' as const;
  readonly layer = 'base' as const;
  readonly worldBelow = 'none' as const;
  private readonly s: Services;
  private readonly intents = new IntentReader();
  private phase: BootPhase = 'loading';
  private progress = 0;
  private label = '';
  private error: string | null = null;
  private lastVm: BootVM | null = null;
  /** Bumped on enter/exit so a late pipeline step never touches a later visit. */
  private generation = 0;

  constructor(s: Services) {
    this.s = s;
  }

  enter(): void {
    const gen = ++this.generation;
    this.phase = 'loading';
    this.progress = 0;
    this.label = 'Checking graphics';
    this.error = null;
    this.lastVm = null;
    this.s.input.setContext('menu');
    this.intents.open(this.s.ui, 'boot');
    this.s.ui.show('boot', this.vm());
    void this.pipeline(gen);
  }

  exit(): void {
    this.generation++;
    this.intents.close();
    this.s.ui.hide('boot');
  }

  update(frameDt: number): void {
    const intents = this.intents.read(this.s.input, frameDt * 1000);
    // Presses during loading are drained so only a press on the ready screen counts.
    const anyKey = this.s.input.consumeAnyKey();
    let clicked = false;
    for (const i of intents) if (i.pointer || i.kind === 'confirm') clicked = true;
    if (this.phase === 'ready' && (anyKey || clicked)) this.unlockAudio(this.generation);
    if (this.phase === 'done') {
      this.phase = 'leaving';
      this.s.fsm.request('MainMenu');
    }
    this.publish();
  }

  private vm(): BootVM {
    return {
      phase: this.phase === 'fatal' ? 'fatal' : this.phase === 'loading' ? 'loading' : 'ready',
      title: this.s.theme().title,
      progress: this.progress,
      label: this.label,
      error: this.error,
    };
  }

  private publish(): void {
    const next = this.vm();
    const last = this.lastVm;
    if (
      last?.phase === next.phase &&
      last.progress === next.progress &&
      last.label === next.label &&
      last.error === next.error
    )
      return;
    this.lastVm = next;
    this.s.ui.update('boot', next);
  }

  private async pipeline(gen: number): Promise<void> {
    const s = this.s;
    try {
      const caps = s.render.capabilities;
      if (!caps.webgl2) throw new Error(WEBGL2_MISSING);
      if (!caps.floatTargets) s.log.info('boot: EXT_color_buffer_float missing, using LDR render targets');

      this.label = 'Loading save';
      const loaded = s.save.load();
      const toast = SAVE_TOASTS[loaded.status];
      if (toast !== null) s.ui.toast(toast.msg, toast.kind);
      if (loaded.migratedFrom !== undefined && loaded.migratedFrom < 2)
        s.ui.toast(
          `${s.theme().names.meta} was simplified: ${s.theme().names.metaCurrency} spent on removed lines were refunded.`,
          'info',
        );
      applySettingsLive(s, loaded.data.settings);
      s.input.setBindings(loaded.data.bindings);
      this.progress = P_SAVE;

      const savedTheme: string = getTheme(loaded.data.settings.themeId).id;
      const runningTheme: string = s.theme().id;
      if (savedTheme !== runningTheme)
        s.log.info('boot: saved theme differs from the running theme; it applies on reload');

      this.label = 'Compiling geometry';
      this.progress = P_BUILD_START;
      await s.assets.build((p) => {
        if (gen !== this.generation) return;
        const f = Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0;
        this.progress = P_BUILD_START + P_BUILD_SPAN * f;
      });
      if (gen !== this.generation) return;

      this.label = 'Warming shaders';
      this.progress = P_WARMUP;
      await s.assets.warmup();
      if (gen !== this.generation) return;

      const st = s.render.stats();
      s.log.info('boot: baseline', {
        programs: st.programs,
        geometries: st.geometries,
        textures: st.textures,
      });
      this.progress = 1;
      this.label = 'Ready';
      this.phase = 'ready';
    } catch (e) {
      if (gen !== this.generation) return;
      this.phase = 'fatal';
      this.error = errorText(e);
      this.label = 'Fatal error';
      s.log.error('boot: fatal', e);
    }
  }

  private unlockAudio(gen: number): void {
    this.phase = 'unlocking';
    this.label = 'Starting audio';
    void this.s.audio
      .unlock()
      .catch((e: unknown) => {
        // Audio failing must never block the game: continue silently.
        this.s.log.warn('boot: audio unlock failed', e);
      })
      .finally(() => {
        if (gen === this.generation) this.phase = 'done';
      });
  }
}

export function createBootState(s: Services): GameState<'Boot'> {
  return new BootStateImpl(s);
}

/**
 * Page lifecycle hooks (plan section 3). Pure-typed against injected listener targets (no DOM lib):
 * - blur, visibilitychange, pagehide, fullscreenchange and webglcontextlost/restored all call input.releaseAll();
 * - Paused{reason} is requested only when Playing is on top (every other state only releases input);
 * - hidden suspends audio and flushes the save, visible resumes audio; pagehide flushes the save;
 * - webglcontextlost calls preventDefault() so the context can be restored.
 */
import type { AudioPort } from '../contracts/audio';
import type { Logger } from '../contracts/ids';
import type { InputPort } from '../contracts/input';
import type { SaveStorePort } from '../contracts/save';
import type { PauseReason, StateMachineApi } from '../contracts/states';

export interface ListenerTarget {
  addEventListener(type: string, fn: (e: { preventDefault(): void }) => void): void;
  removeEventListener(type: string, fn: (e: { preventDefault(): void }) => void): void;
}

export interface WindowLike extends ListenerTarget {
  readonly document: ListenerTarget & { readonly hidden: boolean; readonly fullscreenElement: unknown };
}

export interface LifecycleDeps {
  readonly input: Pick<InputPort, 'releaseAll'>;
  readonly fsm: StateMachineApi;
  readonly audio: Pick<AudioPort, 'suspend' | 'resume'>;
  readonly save: Pick<SaveStorePort, 'flush'>;
  /** Canvas for webglcontextlost/restored (null in tests). */
  readonly canvas: ListenerTarget | null;
  readonly log: Logger;
}

type Listener = (e: { preventDefault(): void }) => void;

interface Binding {
  readonly target: ListenerTarget;
  readonly type: string;
  readonly fn: Listener;
}

/** Returns an uninstall function. */
export function installLifecycle(target: WindowLike, deps: LifecycleDeps): () => void {
  const { input, fsm, audio, save, canvas, log } = deps;
  const doc = target.document;

  const pauseIfPlaying = (reason: PauseReason): void => {
    if (fsm.top !== 'Playing') return;
    fsm.request('Paused', { reason });
  };

  const audioCall = (op: 'suspend' | 'resume'): void => {
    const p = op === 'suspend' ? audio.suspend() : audio.resume();
    p.then(undefined, (err: unknown) => {
      log.warn(`lifecycle: audio ${op} failed`, err);
    });
  };

  const flushSave = (): void => {
    try {
      save.flush();
    } catch (err) {
      log.error('lifecycle: save flush failed', err);
    }
  };

  const onBlur: Listener = () => {
    input.releaseAll();
    pauseIfPlaying('blur');
  };

  const onVisibility: Listener = () => {
    input.releaseAll();
    if (doc.hidden) {
      pauseIfPlaying('hidden');
      audioCall('suspend');
      flushSave();
    } else {
      audioCall('resume');
    }
  };

  const onPageHide: Listener = () => {
    input.releaseAll();
    pauseIfPlaying('hidden');
    flushSave();
  };

  const onFullscreen: Listener = () => {
    input.releaseAll();
    // Leaving fullscreen (Esc) must not let the run continue unattended.
    if (doc.fullscreenElement === null || doc.fullscreenElement === undefined) pauseIfPlaying('fullscreen');
  };

  const onContextLost: Listener = (e) => {
    e.preventDefault();
    input.releaseAll();
    log.warn('lifecycle: WebGL context lost');
    pauseIfPlaying('contextlost');
  };

  const onContextRestored: Listener = () => {
    input.releaseAll();
    log.info('lifecycle: WebGL context restored');
  };

  const bindings: Binding[] = [
    { target, type: 'blur', fn: onBlur },
    { target, type: 'pagehide', fn: onPageHide },
    { target: doc, type: 'visibilitychange', fn: onVisibility },
    { target: doc, type: 'fullscreenchange', fn: onFullscreen },
  ];
  if (canvas !== null) {
    bindings.push({ target: canvas, type: 'webglcontextlost', fn: onContextLost });
    bindings.push({ target: canvas, type: 'webglcontextrestored', fn: onContextRestored });
  }
  for (const b of bindings) b.target.addEventListener(b.type, b.fn);

  let installed = true;
  return () => {
    if (!installed) return;
    installed = false;
    for (const b of bindings) b.target.removeEventListener(b.type, b.fn);
  };
}

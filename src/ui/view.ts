/** Shared view plumbing for screens: the build context and the screen view shape UIRoot drives. */
import type { ThemeDef } from '../contracts/theme';
import type { ScreenId, ScreenVMs } from '../contracts/ui';
import { ATTR_SCREEN, h } from './dom';

export interface UiContext {
  readonly doc: Document;
  /** Static fiction labels (currency names, Patch Bay, Spare Kernels...). Dynamic text comes from the VMs. */
  readonly theme: ThemeDef;
}

export interface ScreenView<S extends ScreenId> {
  readonly id: S;
  readonly el: HTMLElement;
  /**
   * Applies the VM to the DOM (diffed). `nowMs` drives throttles and short feedback animations. Returns true when
   * the screen wants another render on the next flush even without a new VM (throttled text, timed flashes).
   */
  render(vm: ScreenVMs[S], nowMs: number): boolean;
  /** Called when the screen is (re)shown, before its first render of that showing. */
  onShow?(): void;
}

export type ScreenViews = { readonly [S in ScreenId]: ScreenView<S> };

/** Root element of a screen: carries data-screen for pointer resolution and starts hidden. */
export function screenRoot(ctx: UiContext, id: ScreenId, extraClass: string): HTMLElement {
  const el = h(ctx.doc, 'section', {
    className: `kp-screen kp-screen-${id}${extraClass === '' ? '' : ' ' + extraClass}`,
    attrs: { [ATTR_SCREEN]: id },
  });
  el.hidden = true;
  return el;
}

/**
 * Tiny DOM helpers: an h() element builder and diffed write slots. No innerHTML anywhere in ui/: every node is
 * created through createElement and every text write goes through textContent.
 */
import type { PlayerIndex } from '../contracts/ids';
import type { MenuIntentKind } from '../contracts/input';

export interface HProps {
  readonly className?: string;
  readonly text?: string;
  readonly attrs?: Readonly<Record<string, string>>;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  props?: HProps,
  ...children: readonly Node[]
): HTMLElementTagNameMap[K] {
  const el = doc.createElement(tag);
  if (props !== undefined) {
    if (props.className !== undefined) el.className = props.className;
    if (props.text !== undefined) el.textContent = props.text;
    if (props.attrs !== undefined) {
      const keys = Object.keys(props.attrs);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i]!;
        const v = props.attrs[k];
        if (v !== undefined) el.setAttribute(k, v);
      }
    }
  }
  for (let i = 0; i < children.length; i++) el.appendChild(children[i]!);
  return el;
}

/** Diffed textContent: the DOM is written only when the string changes. */
export class TextSlot {
  private readonly el: HTMLElement;
  private last: string | null = null;

  constructor(el: HTMLElement) {
    this.el = el;
  }

  set(text: string): void {
    if (text === this.last) return;
    this.last = text;
    this.el.textContent = text;
  }

  get value(): string | null {
    return this.last;
  }
}

/** Diffed numeric text: formats (and allocates a string) only when the number changes. */
export class NumSlot {
  private readonly el: HTMLElement;
  private readonly fmt: (n: number) => string;
  private last = Number.NaN;
  private written = false;

  constructor(el: HTMLElement, fmt: (n: number) => string) {
    this.el = el;
    this.fmt = fmt;
  }

  set(n: number): void {
    if (this.written && (n === this.last || (Number.isNaN(n) && Number.isNaN(this.last)))) return;
    this.written = true;
    this.last = n;
    this.el.textContent = this.fmt(n);
  }
}

/** Diffed class toggle. */
export class Flag {
  private readonly el: HTMLElement;
  private readonly cls: string;
  private on = false;

  constructor(el: HTMLElement, cls: string, initial = false) {
    this.el = el;
    this.cls = cls;
    this.on = initial;
    if (initial) el.classList.add(cls);
  }

  set(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    this.el.classList.toggle(this.cls, on);
  }

  get value(): boolean {
    return this.on;
  }
}

/** Diffed `hidden` property (CSS maps [hidden] to display: none). */
export class Shown {
  private readonly el: HTMLElement;
  private shown: boolean;

  constructor(el: HTMLElement, initial = true) {
    this.el = el;
    this.shown = initial;
    el.hidden = !initial;
  }

  set(on: boolean): void {
    if (on === this.shown) return;
    this.shown = on;
    this.el.hidden = !on;
  }

  get value(): boolean {
    return this.shown;
  }
}

/** Diffed attribute value. */
export class AttrSlot {
  private readonly el: HTMLElement;
  private readonly name: string;
  private last: string | null = null;

  constructor(el: HTMLElement, name: string) {
    this.el = el;
    this.name = name;
  }

  set(value: string): void {
    if (value === this.last) return;
    this.last = value;
    this.el.setAttribute(this.name, value);
  }
}

/** Diffed one-of-N class (e.g. a status or tier class). */
export class ClassSwitch {
  private readonly el: HTMLElement;
  private current: string | null = null;

  constructor(el: HTMLElement) {
    this.el = el;
  }

  set(cls: string | null): void {
    if (cls === this.current) return;
    if (this.current !== null) this.el.classList.remove(this.current);
    if (cls !== null) this.el.classList.add(cls);
    this.current = cls;
  }
}

// ---------------------------------------------------------------- pointer targets

export const ATTR_KIND = 'data-kind';
export const ATTR_PLAYER = 'data-player';
export const ATTR_ITEM = 'data-item';
export const ATTR_SCREEN = 'data-screen';

/** Marks an element as a click target that maps to a MenuIntent (see ui/pointer.ts). */
export function markClick(
  el: HTMLElement,
  kind: MenuIntentKind,
  player: PlayerIndex | 'any',
  itemId: string | null,
): void {
  el.setAttribute(ATTR_KIND, kind);
  el.setAttribute(ATTR_PLAYER, player === 'any' ? 'any' : String(player));
  if (itemId !== null) el.setAttribute(ATTR_ITEM, itemId);
}

/**
 * A non-focusable button (tabindex=-1; the root also preventDefaults mousedown) so Space/Enter never activate a
 * focused DOM button behind the keyboard-driven menus. Clicks map to MenuIntents.
 */
export function button(
  doc: Document,
  className: string,
  text: string,
  kind: MenuIntentKind,
  player: PlayerIndex | 'any',
  itemId: string | null,
): HTMLButtonElement {
  const el = h(doc, 'button', { className, text, attrs: { type: 'button', tabindex: '-1' } });
  markClick(el, kind, player, itemId);
  return el;
}

// ---------------------------------------------------------------- pools

export interface PooledView {
  readonly el: HTMLElement;
}

/**
 * Grow-only pool of child views: `ensure(n)` shows the first n (creating them on demand, appended in order) and
 * hides the rest, so list screens are built once and only toggled afterwards.
 */
export class ViewPool<V extends PooledView> {
  private readonly container: HTMLElement;
  private readonly factory: (index: number) => V;
  private readonly views: V[] = [];
  private shown = 0;

  constructor(container: HTMLElement, factory: (index: number) => V) {
    this.container = container;
    this.factory = factory;
  }

  ensure(n: number): void {
    const count = Math.max(0, Math.floor(n));
    while (this.views.length < count) {
      const v = this.factory(this.views.length);
      v.el.hidden = true;
      this.container.appendChild(v.el);
      this.views.push(v);
    }
    for (let i = this.shown; i < count; i++) this.views[i]!.el.hidden = false;
    for (let i = count; i < this.shown; i++) this.views[i]!.el.hidden = true;
    this.shown = count;
  }

  get(i: number): V {
    const v = this.views[i];
    if (v === undefined) throw new RangeError(`ViewPool index ${i} out of range`);
    return v;
  }

  get count(): number {
    return this.shown;
  }

  get capacity(): number {
    return this.views.length;
  }
}

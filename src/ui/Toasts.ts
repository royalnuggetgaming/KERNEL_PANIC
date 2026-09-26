/**
 * Toast queue of at most 3 (a 4th evicts the oldest). Three slot elements are built once and rewritten in place;
 * expiry is checked on flush against the UI clock.
 */
import type { ToastKind } from '../contracts/ui';
import { ClassSwitch, Shown, TextSlot, h } from './dom';

export const TOAST_MAX = 3;
export const TOAST_MS = 2600;

const KIND_CLASS: Readonly<Record<ToastKind, string>> = {
  info: 'kind-info',
  warn: 'kind-warn',
  error: 'kind-error',
};

interface Entry {
  msg: string;
  kind: ToastKind;
  expiresAt: number;
}

class ToastSlot {
  readonly el: HTMLDivElement;
  readonly text: TextSlot;
  readonly kind: ClassSwitch;
  readonly shown: Shown;

  constructor(doc: Document) {
    this.el = h(doc, 'div', { className: 'kp-toast', attrs: { role: 'status' } });
    this.text = new TextSlot(this.el);
    this.kind = new ClassSwitch(this.el);
    this.shown = new Shown(this.el, false);
  }
}

export class Toasts {
  readonly el: HTMLDivElement;
  private readonly slots: ToastSlot[] = [];
  /** Oldest first. */
  private readonly entries: Entry[] = [];
  private dirty = false;

  constructor(doc: Document) {
    this.el = h(doc, 'div', { className: 'kp-toasts', attrs: { 'aria-live': 'polite' } });
    for (let i = 0; i < TOAST_MAX; i++) {
      const s = new ToastSlot(doc);
      this.slots.push(s);
      this.el.appendChild(s.el);
    }
  }

  push(msg: string, kind: ToastKind, nowMs: number): void {
    if (this.entries.length >= TOAST_MAX) this.entries.shift();
    this.entries.push({ msg, kind, expiresAt: nowMs + TOAST_MS });
    this.dirty = true;
  }

  /** Drops expired toasts and writes the slots when anything changed. */
  flush(nowMs: number): void {
    while (this.entries.length > 0 && this.entries[0]!.expiresAt <= nowMs) {
      this.entries.shift();
      this.dirty = true;
    }
    if (!this.dirty) return;
    this.dirty = false;
    for (let i = 0; i < TOAST_MAX; i++) {
      const slot = this.slots[i]!;
      const e = this.entries[i];
      slot.shown.set(e !== undefined);
      if (e !== undefined) {
        slot.text.set(e.msg);
        slot.kind.set(KIND_CLASS[e.kind]);
      }
    }
  }

  get count(): number {
    return this.entries.length;
  }

  /** Messages currently queued, oldest first. */
  messages(): readonly string[] {
    const out: string[] = [];
    for (let i = 0; i < this.entries.length; i++) out.push(this.entries[i]!.msg);
    return out;
  }
}

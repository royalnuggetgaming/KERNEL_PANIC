/**
 * A horizontal bar whose fill is driven only by `transform: scaleX()` (compositor-only, no layout). Fractions are
 * quantised to 1/1000 and the transform strings come from a lazily built table, so per-frame updates allocate
 * nothing and write the DOM only when the quantised value changes.
 */
import { saturate } from '../../core/math';
import { h } from '../dom';

const STEPS = 1000;
let table: string[] | null = null;

function scaleXTable(): string[] {
  if (table === null) {
    const t: string[] = [];
    for (let i = 0; i <= STEPS; i++) t.push(`scaleX(${(i / STEPS).toFixed(3)})`);
    table = t;
  }
  return table;
}

/** Quantised step index 0..1000 for a fraction (NaN -> 0). */
export function meterStep(frac: number): number {
  if (Number.isNaN(frac)) return 0;
  return Math.round(saturate(frac) * STEPS);
}

/** The transform string for a fraction (shared, never reallocated). */
export function scaleXFor(frac: number): string {
  return scaleXTable()[meterStep(frac)]!;
}

export class Meter {
  readonly el: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private step = -1;

  constructor(doc: Document, className: string) {
    this.fill = h(doc, 'div', { className: 'kp-meter-fill' });
    this.el = h(
      doc,
      'div',
      { className: className === '' ? 'kp-meter' : `kp-meter ${className}` },
      this.fill,
    );
    this.set(0);
  }

  set(frac: number): void {
    const s = meterStep(frac);
    if (s === this.step) return;
    this.step = s;
    this.fill.style.transform = scaleXTable()[s]!;
  }

  get value(): number {
    return this.step / STEPS;
  }
}

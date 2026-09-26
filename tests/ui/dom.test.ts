import { describe, expect, it } from 'vitest';
import {
  AttrSlot,
  ClassSwitch,
  Flag,
  NumSlot,
  Shown,
  TextSlot,
  ViewPool,
  button,
  h,
  markClick,
} from '../../src/ui/dom';
import { Meter, meterStep, scaleXFor } from '../../src/ui/widgets/Meter';
import { KeyCap } from '../../src/ui/widgets/KeyCap';
import { FakeDocument, asDocument, asElement, asFake } from './fakeDom';

const fdoc = new FakeDocument();
const doc = asDocument(fdoc);

describe('ui/dom', () => {
  it('h builds elements with class, text, attrs and children', () => {
    const child = h(doc, 'span', { text: 'hi' });
    const el = asFake(
      h(doc, 'div', { className: 'a b', attrs: { 'data-x': '1', role: 'status' } }, child, h(doc, 'i')),
    );
    expect(el.tagName).toBe('DIV');
    expect(el.classList.contains('a')).toBe(true);
    expect(el.classList.contains('b')).toBe(true);
    expect(el.getAttribute('data-x')).toBe('1');
    expect(el.getAttribute('role')).toBe('status');
    expect(el.children.length).toBe(2);
    expect(el.textContent).toBe('hi');
    expect(asFake(h(doc, 'p')).children.length).toBe(0);
  });

  it('TextSlot writes only on change', () => {
    const el = asFake(h(doc, 'span'));
    const slot = new TextSlot(asElement(el));
    slot.set('a');
    slot.set('a');
    slot.set('b');
    slot.set('b');
    expect(el.textWrites).toBe(2);
    expect(el.textContent).toBe('b');
    expect(slot.value).toBe('b');
  });

  it('TextSlot writes the empty string on first set', () => {
    const el = asFake(h(doc, 'span', { text: 'initial' }));
    new TextSlot(asElement(el)).set('');
    expect(el.textContent).toBe('');
  });

  it('NumSlot formats only when the number changes', () => {
    const el = asFake(h(doc, 'span'));
    let calls = 0;
    const slot = new NumSlot(asElement(el), (n) => {
      calls++;
      return `#${n}`;
    });
    slot.set(5);
    slot.set(5);
    slot.set(6);
    slot.set(Number.NaN);
    slot.set(Number.NaN);
    expect(calls).toBe(3);
    expect(el.textContent).toBe('#NaN');
  });

  it('Flag, Shown, AttrSlot and ClassSwitch diff their writes', () => {
    const el = asFake(h(doc, 'div'));
    const flag = new Flag(asElement(el), 'on');
    flag.set(false);
    expect(el.classWrites).toBe(0);
    flag.set(true);
    flag.set(true);
    expect(el.classList.contains('on')).toBe(true);
    expect(flag.value).toBe(true);
    expect(el.classWrites).toBe(1);
    const initial = new Flag(asElement(el), 'pre', true);
    expect(el.classList.contains('pre')).toBe(true);
    expect(initial.value).toBe(true);

    const shown = new Shown(asElement(el), false);
    expect(el.hidden).toBe(true);
    shown.set(true);
    expect(el.hidden).toBe(false);
    expect(shown.value).toBe(true);

    const attr = new AttrSlot(asElement(el), 'data-item');
    attr.set('x');
    expect(el.getAttribute('data-item')).toBe('x');

    const sw = new ClassSwitch(asElement(el));
    sw.set('st-a');
    sw.set('st-b');
    expect(el.classList.contains('st-a')).toBe(false);
    expect(el.classList.contains('st-b')).toBe(true);
    sw.set(null);
    expect(el.classList.contains('st-b')).toBe(false);
  });

  it('button is non-focusable and carries intent attributes', () => {
    const b = asFake(button(doc, 'kp-btn', 'GO', 'ready', 1, 'ready'));
    expect(b.tagName).toBe('BUTTON');
    expect(b.getAttribute('tabindex')).toBe('-1');
    expect(b.getAttribute('type')).toBe('button');
    expect(b.getAttribute('data-kind')).toBe('ready');
    expect(b.getAttribute('data-player')).toBe('1');
    expect(b.getAttribute('data-item')).toBe('ready');
    const d = asFake(h(doc, 'div'));
    markClick(asElement(d), 'back', 'any', null);
    expect(d.getAttribute('data-player')).toBe('any');
    expect(d.getAttribute('data-item')).toBeNull();
  });

  it('ViewPool grows on demand and toggles instead of rebuilding', () => {
    const container = asFake(h(doc, 'div'));
    let built = 0;
    const pool = new ViewPool(asElement(container), () => {
      built++;
      return { el: h(doc, 'div') };
    });
    pool.ensure(3);
    expect(built).toBe(3);
    expect(container.children.filter((c) => !c.hidden).length).toBe(3);
    pool.ensure(1);
    expect(built).toBe(3);
    expect(container.children.filter((c) => !c.hidden).length).toBe(1);
    expect(pool.count).toBe(1);
    expect(pool.capacity).toBe(3);
    pool.ensure(4);
    expect(built).toBe(4);
    expect(container.children.filter((c) => !c.hidden).length).toBe(4);
    expect(() => pool.get(9)).toThrow(RangeError);
    pool.ensure(-2);
    expect(pool.count).toBe(0);
  });
});

describe('ui/widgets Meter and KeyCap', () => {
  it('quantises fractions and shares transform strings', () => {
    expect(meterStep(0)).toBe(0);
    expect(meterStep(1)).toBe(1000);
    expect(meterStep(2)).toBe(1000);
    expect(meterStep(-1)).toBe(0);
    expect(meterStep(Number.NaN)).toBe(0);
    expect(scaleXFor(0.5)).toBe('scaleX(0.500)');
    expect(scaleXFor(0.5)).toBe(scaleXFor(0.5004));
  });

  it('writes the transform only when the quantised value changes', () => {
    const m = new Meter(doc, 'x');
    const fill = asFake(m.el).children[0]!;
    const base = fill.style.transformWrites;
    m.set(0.25);
    m.set(0.2501);
    m.set(0.25);
    expect(fill.style.transformWrites - base).toBe(1);
    expect(fill.style.transform).toBe('scaleX(0.250)');
    expect(m.value).toBeCloseTo(0.25);
    expect(asFake(m.el).classList.contains('kp-meter')).toBe(true);
    expect(asFake(new Meter(doc, '').el).className).toBe('kp-meter');
  });

  it('KeyCap shows label and held state', () => {
    const k = new KeyCap(doc);
    k.set({ code: 'KeyW', label: 'W', held: true });
    const el = asFake(k.el);
    expect(el.textContent).toBe('W');
    expect(el.classList.contains('is-held')).toBe(true);
    expect(el.getAttribute('data-code')).toBe('KeyW');
  });
});

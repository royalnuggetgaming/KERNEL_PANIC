import { describe, expect, it } from 'vitest';
import { button, h } from '../../src/ui/dom';
import { isPointerNode, resolvePointerIntent } from '../../src/ui/pointer';
import { FakeDocument, asDocument, asFake } from './fakeDom';

const doc = asDocument(new FakeDocument());

function tree() {
  const root = h(doc, 'div');
  const screen = h(doc, 'section', { attrs: { 'data-screen': 'shop' } });
  const btn = button(doc, 'b', 'BUY', 'confirm', 0, 'thrusters');
  const label = h(doc, 'span', { text: 'inner' });
  btn.appendChild(label);
  const plain = h(doc, 'p');
  screen.appendChild(btn);
  screen.appendChild(plain);
  root.appendChild(screen);
  return {
    root: asFake(root),
    screen: asFake(screen),
    btn: asFake(btn),
    label: asFake(label),
    plain: asFake(plain),
  };
}

describe('ui/pointer', () => {
  it('resolves the nearest clickable ancestor and its screen', () => {
    const t = tree();
    expect(resolvePointerIntent(t.label, t.root)).toEqual({
      screen: 'shop',
      kind: 'confirm',
      player: 0,
      itemId: 'thrusters',
    });
  });

  it('returns null for non-clickable targets, disabled targets and targets outside a screen', () => {
    const t = tree();
    expect(resolvePointerIntent(t.plain, t.root)).toBeNull();
    expect(resolvePointerIntent(null, t.root)).toBeNull();
    t.btn.setAttribute('aria-disabled', 'true');
    expect(resolvePointerIntent(t.label, t.root)).toBeNull();
    const loose = asFake(button(doc, 'b', 'X', 'back', 'any', 'back'));
    const root = asFake(h(doc, 'div'));
    root.appendChild(loose);
    expect(resolvePointerIntent(loose, root)).toBeNull();
    // Walk stops at a detached node without a screen.
    expect(resolvePointerIntent(asFake(button(doc, 'b', 'X', 'back', 'any', 'back')), root)).toBeNull();
  });

  it('parses players and ignores unknown kinds/screens', () => {
    const root = asFake(h(doc, 'div'));
    const screen = asFake(h(doc, 'section', { attrs: { 'data-screen': 'characterSelect' } }));
    const p2 = asFake(button(doc, 'b', '>', 'right', 1, 'vehicle'));
    const any = asFake(button(doc, 'b', 'BACK', 'back', 'any', null));
    const bogus = asFake(h(doc, 'div', { attrs: { 'data-kind': 'explode' } }));
    screen.appendChild(p2);
    screen.appendChild(any);
    screen.appendChild(bogus);
    root.appendChild(screen);
    expect(resolvePointerIntent(p2, root)).toEqual({
      screen: 'characterSelect',
      kind: 'right',
      player: 1,
      itemId: 'vehicle',
    });
    expect(resolvePointerIntent(any, root)).toEqual({
      screen: 'characterSelect',
      kind: 'back',
      player: 'any',
      itemId: null,
    });
    expect(resolvePointerIntent(bogus, root)).toBeNull();
    const badScreen = asFake(h(doc, 'section', { attrs: { 'data-screen': 'nowhere' } }));
    const inBad = asFake(button(doc, 'b', 'X', 'confirm', 'any', 'x'));
    badScreen.appendChild(inBad);
    root.appendChild(badScreen);
    expect(resolvePointerIntent(inBad, root)).toBeNull();
  });

  it('isPointerNode guards event targets', () => {
    expect(isPointerNode(null)).toBe(false);
    expect(isPointerNode({})).toBe(false);
    expect(isPointerNode(asFake(h(doc, 'div')))).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { KERNEL_PANIC } from '../../src/themes/kernelPanic';
import { Hud } from '../../src/ui/hud/Hud';
import { SPECIAL_ACTIVE_TEXT, SPECIAL_READY_TEXT, specialStatusText } from '../../src/ui/hud/SpecialGauge';
import { FakeDocument, asDocument, asFake } from './fakeDom';
import { hudPlayerVM, hudVM } from './fixtures';

function panel(vm: ReturnType<typeof hudPlayerVM>) {
  const hud = new Hud({ doc: asDocument(new FakeDocument()), theme: KERNEL_PANIC });
  hud.render(hudVM({ players: [vm, hudPlayerVM({ present: false, life: 'absent' })] }), 0);
  return asFake(hud.el).byClass('kp-pp')[0]!;
}

describe('ui/hud special gauge', () => {
  it('shows the special name with its live key and the charge percentage', () => {
    const p = panel(hudPlayerVM({ specialLabel: 'FIREWALL [R]', overdriveFrac: 0.42, specialPercent: 42 }));
    const g = p.first('kp-sp');
    expect(g.first('kp-sp-label').textContent).toBe('FIREWALL [R]');
    expect(g.first('kp-sp-status').textContent).toBe('42%');
    expect(g.classList.contains('is-ready')).toBe(false);
    expect(g.first('kp-pp-od').children[0]!.style.transform).toBe('scaleX(0.420)');
  });

  it('full meter: READY state on the gauge (and the panel keeps is-od-ready)', () => {
    const p = panel(hudPlayerVM({ overdriveFrac: 1, specialPercent: 100 }));
    const g = p.first('kp-sp');
    expect(g.classList.contains('is-ready')).toBe(true);
    expect(g.first('kp-sp-status').textContent).toBe(SPECIAL_READY_TEXT);
    expect(p.classList.contains('is-od-ready')).toBe(true);
  });

  it('while the special runs the meter shows the time left and reads ACTIVE', () => {
    const p = panel(hudPlayerVM({ overdriveFrac: 0, specialPercent: 0, specialActiveFrac: 0.5 }));
    const g = p.first('kp-sp');
    expect(g.classList.contains('is-active')).toBe(true);
    expect(g.classList.contains('is-ready')).toBe(false);
    expect(g.first('kp-sp-status').textContent).toBe(SPECIAL_ACTIVE_TEXT);
    expect(g.first('kp-pp-od').children[0]!.style.transform).toBe('scaleX(0.500)');
  });

  it('status strings are shared (no per-frame allocation)', () => {
    const a = specialStatusText(hudPlayerVM({ specialPercent: 37 }));
    const b = specialStatusText(hudPlayerVM({ specialPercent: 37 }));
    expect(a).toBe('37%');
    expect(a).toBe(b);
  });
});

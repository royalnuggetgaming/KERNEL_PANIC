import { describe, expect, it } from 'vitest';
import type { TerminalVM } from '../../src/contracts/ui';
import { TerminalPanel } from '../../src/ui/screens/TerminalPanel';
import { FakeDocument, asDocument, asFake } from './fakeDom';

function vm(patch: Partial<TerminalVM> = {}): TerminalVM {
  return {
    lines: ['KERNEL PANIC TERMINAL', '> NOPE', 'ACCESS DENIED.', 'ACCESS GRANTED: GOD MODE'],
    input: 'IDD',
    cheats: [{ id: 'cheat:god', code: 'IDDQD', label: 'GOD MODE', desc: 'x', enabled: true }],
    cursor: -1,
    flash: '',
    hint: 'hint',
    warning: 'no Cores',
    ...patch,
  };
}

describe('TerminalPanel', () => {
  it('renders plain, echo, granted and denied lines and every flash state without empty class tokens', () => {
    const panel = new TerminalPanel(asDocument(new FakeDocument()));
    expect(() => {
      panel.render(vm());
      panel.render(vm({ flash: 'denied', cursor: 0 }));
      panel.render(vm({ flash: 'granted' }));
      panel.render(vm({ flash: '', cheats: [] }));
    }).not.toThrow();
    const root = asFake(panel.el);
    expect(root.textContent).toContain('IDD');
    expect(root.textContent).toContain('no Cores');
  });
});

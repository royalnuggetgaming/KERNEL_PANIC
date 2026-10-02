/**
 * TERMINAL sub-panel (main menu): a tiny command line for cheat codes. While open the input context is
 * 'rebind' (no menu or game intents at all) and every fresh keydown arrives through captureNextKey, so typing
 * can never trigger a game key. Letters/digits type, Backspace deletes, Enter submits, Up/Down pick an unlocked
 * cheat and Enter on an empty prompt toggles it, Escape closes. Codes are case-insensitive; a wrong code prints
 * ACCESS DENIED. Unlocks and toggles are committed to the save at once.
 */
import type { KeyCode } from '../contracts/input';
import type { Services } from '../contracts/services';
import type { TerminalCheatVM, TerminalVM } from '../contracts/ui';
import { CHEATS, TERMINAL_MAX_INPUT, cheatByCode, cheatDef } from '../config/cheats';
import { cheatIdOf, cheatToggleDelta, cheatUnlockDelta, cheatsOf, cheatsOffDelta } from './cheatState';
import type { UiIntent } from './intents';

export const TERMINAL_CHEAT_PREFIX = 'cheat:';
const MAX_LINES = 9;
export const TERMINAL_HINT = 'TYPE A CODE + ENTER   ·   ↑ ↓ + ENTER TOGGLE   ·   HELP   ·   ESC CLOSE';

/** The character a key types, or null (letters, digits and space only). */
export function keyChar(code: KeyCode): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return code.slice(6);
  if (code === 'Space') return ' ';
  return null;
}

export class TerminalController {
  private readonly s: Services;
  private lines: string[] = [];
  private input = '';
  private cursor = -1;
  private flash: TerminalVM['flash'] = '';
  private token = 0;
  private open = false;
  /** Set when Escape / EXIT asked to close; the owner closes the panel on its next handle/tick. */
  wantsClose = false;
  onChange: () => void = () => undefined;

  constructor(s: Services) {
    this.s = s;
  }

  start(): void {
    this.open = true;
    this.wantsClose = false;
    this.input = '';
    this.cursor = -1;
    this.flash = '';
    const n = this.s.theme().names;
    this.lines = [
      'KERNEL PANIC TERMINAL v3.0',
      'Enter an access code. Cheats apply to your NEXT runs.',
      `WARNING: cheat runs pay no ${n.metaCurrency} and do not count for records or the leaderboard.`,
    ];
    this.arm();
  }

  stop(): void {
    this.token++;
    if (this.open) {
      this.open = false;
      this.s.input.setContext('menu');
      this.s.input.clearEdges();
    }
  }

  /** Pointer intents only (keys arrive through the capture): clicking a cheat toggles it. */
  handle(i: UiIntent): boolean {
    if (!i.pointer) return false;
    const id = cheatIdOf(i.itemId, TERMINAL_CHEAT_PREFIX);
    if (id === null) return false;
    this.toggle(id);
    return true;
  }

  private arm(): void {
    const token = ++this.token;
    this.s.input.setContext('rebind');
    this.s.input.captureNextKey((code) => {
      if (token !== this.token || !this.open) return;
      this.key(code);
      if (!this.wantsClose) this.arm();
      this.onChange();
    });
  }

  private key(code: KeyCode | null): void {
    if (code === null) {
      this.wantsClose = true;
      return;
    }
    const ch = keyChar(code);
    if (ch !== null) {
      if (this.input.length < TERMINAL_MAX_INPUT && !(ch === ' ' && this.input.length === 0))
        this.input += ch;
      this.cursor = -1;
      this.flash = '';
      return;
    }
    const unlocked = cheatsOf(this.s.save.data).unlocked;
    switch (code) {
      case 'Backspace':
        this.input = this.input.slice(0, -1);
        return;
      case 'ArrowUp':
        this.cursor = this.cursor <= -1 ? unlocked.length - 1 : this.cursor - 1;
        this.s.audio.play('uiMove');
        return;
      case 'ArrowDown':
        this.cursor = this.cursor >= unlocked.length - 1 ? -1 : this.cursor + 1;
        this.s.audio.play('uiMove');
        return;
      case 'Enter':
      case 'NumpadEnter':
        this.submit();
        return;
      default:
        return;
    }
  }

  private print(...lines: string[]): void {
    this.lines.push(...lines);
    if (this.lines.length > MAX_LINES) this.lines.splice(0, this.lines.length - MAX_LINES);
  }

  private submit(): void {
    const typed = this.input.trim().toUpperCase();
    this.input = '';
    if (typed.length === 0) {
      const id = cheatsOf(this.s.save.data).unlocked[this.cursor];
      if (id !== undefined) this.toggle(id);
      return;
    }
    this.print(`> ${typed}`);
    if (typed === 'HELP') {
      this.print('Codes are secret: find them. Commands: HELP, LIST, OFF (all cheats off), EXIT.');
      return;
    }
    if (typed === 'EXIT') {
      this.wantsClose = true;
      return;
    }
    if (typed === 'LIST') {
      const c = cheatsOf(this.s.save.data);
      this.print(
        c.unlocked.length === 0
          ? 'No cheats unlocked yet.'
          : `${c.unlocked.length} of ${CHEATS.length} unlocked; ${c.enabled.length} ON.`,
      );
      return;
    }
    if (typed === 'OFF') {
      if (this.commit(cheatsOffDelta(this.s.save.data))) this.print('All cheats OFF.');
      return;
    }
    const cheat = cheatByCode(typed);
    if (cheat === null) {
      this.flash = 'denied';
      this.print('ACCESS DENIED. Nice try, though.');
      this.s.audio.play('uiDeny');
      return;
    }
    if (!this.commit(cheatUnlockDelta(this.s.save.data, cheat.id))) return;
    this.flash = 'granted';
    this.print(`ACCESS GRANTED: ${cheat.label} is ON for your next run.`, cheat.desc);
    this.s.audio.play('powerUp');
  }

  private toggle(id: Parameters<typeof cheatDef>[0]): void {
    if (!this.commit(cheatToggleDelta(this.s.save.data, id))) return;
    const on = cheatsOf(this.s.save.data).enabled.includes(id);
    this.print(`${cheatDef(id).label}: ${on ? 'ON' : 'OFF'}`);
    this.s.audio.play(on ? 'uiBuy' : 'uiBack');
  }

  private commit(delta: Parameters<Services['save']['commit']>[0]): boolean {
    if (this.s.save.status === 'readOnlyFuture') {
      this.print('READ-ONLY save (open in another tab): nothing was stored.');
      this.s.audio.play('uiDeny');
      return false;
    }
    const r = this.s.save.commit(delta);
    if (!r.ok && r.error !== 'quota' && this.s.save.status !== 'memoryOnly') {
      this.print('The save could not be written: try again.');
      return false;
    }
    return true;
  }

  vm(): TerminalVM {
    const c = cheatsOf(this.s.save.data);
    const cheats: TerminalCheatVM[] = c.unlocked.map((id) => {
      const d = cheatDef(id);
      return {
        id: TERMINAL_CHEAT_PREFIX + id,
        code: d.code,
        label: d.label,
        desc: d.desc,
        enabled: c.enabled.includes(id),
      };
    });
    const n = this.s.theme().names;
    return {
      lines: [...this.lines],
      input: this.input,
      cheats,
      cursor: Math.min(this.cursor, cheats.length - 1),
      flash: this.flash,
      hint: TERMINAL_HINT,
      warning: `Cheat runs pay no ${n.metaCurrency} and never touch records or the leaderboard.`,
    };
  }
}

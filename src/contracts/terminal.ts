/**
 * TERMINAL sub-panel view models (v3, additive; split from ui.ts for the file-size rule). Re-exported by ui.ts.
 */
/** One cheat line in the TERMINAL (only unlocked cheats are listed). */
export interface TerminalCheatVM {
  /** 'cheat:<id>' (pointer item id; clicking toggles it). */
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly desc: string;
  readonly enabled: boolean;
}

/** TERMINAL sub-panel (main menu): a typed command line plus the unlocked cheats with ON/OFF toggles. */
export interface TerminalVM {
  /** Scrollback, oldest first (short lines). */
  readonly lines: readonly string[];
  /** What is typed so far. */
  readonly input: string;
  readonly cheats: readonly TerminalCheatVM[];
  /** Highlighted cheat row (-1 = the prompt). */
  readonly cursor: number;
  /** 'granted' / 'denied' flash of the last command, '' otherwise. */
  readonly flash: 'granted' | 'denied' | '';
  readonly hint: string;
  /** Always-visible warning: cheat runs pay no Cores and do not count for records. */
  readonly warning: string;
}

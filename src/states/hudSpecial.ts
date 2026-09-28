/**
 * HUD special-ability fields: 'RAILBURST [E]' from the theme name and the player's live first Special binding
 * (rebuilt only when the kind or key changes), the meter as a whole percentage, and the running special's
 * remaining fraction. Allocation-free on ordinary frames.
 */
import type { PlayerIndex, SpecialKind } from '../contracts/ids';
import type { Bindings, KeyCode } from '../contracts/input';
import type { PlayerEntity } from '../contracts/sim';
import type { ThemeDef } from '../contracts/theme';
import type { HudPlayerVM } from '../contracts/ui';
import { keyLabel } from '../config/keys';
import { OVERDRIVE } from '../config/tuning';
import { VEHICLES } from '../config/vehicles';

type SpecialFields = { -readonly [K in 'specialLabel' | 'specialPercent' | 'specialActiveFrac']: HudPlayerVM[K] };

/** Live bindings source (null: no key shown). */
export type BindingsReader = () => Bindings | null;

export class HudSpecialWriter {
  private readonly theme: ThemeDef;
  private readonly bindings: BindingsReader | null;
  private readonly kinds: [SpecialKind | null, SpecialKind | null] = [null, null];
  private readonly codes: [KeyCode | null, KeyCode | null] = [null, null];
  private readonly labels: [string, string] = ['', ''];

  constructor(theme: ThemeDef, bindings: BindingsReader | null) {
    this.theme = theme;
    this.bindings = bindings;
  }

  write(o: SpecialFields, p: Readonly<PlayerEntity>, i: PlayerIndex): void {
    const kind = VEHICLES[p.vehicle].special;
    const b = this.bindings === null ? null : this.bindings();
    const code = b === null ? null : (b.players[i].special[0] ?? null);
    if (kind !== this.kinds[i] || code !== this.codes[i]) {
      this.kinds[i] = kind;
      this.codes[i] = code;
      const name = this.theme.names.specials[kind];
      this.labels[i] = code === null ? name : `${name} [${keyLabel(code)}]`;
    }
    o.specialLabel = this.labels[i];
    const pct = Math.floor((p.overdrive / OVERDRIVE.MAX) * 100);
    o.specialPercent = pct > 100 ? 100 : pct < 0 || !(pct >= 0) ? 0 : pct;
    const s = p.special;
    o.specialActiveFrac = s.active && s.duration > 0 ? Math.max(0, Math.min(1, s.timer / s.duration)) : 0;
  }
}

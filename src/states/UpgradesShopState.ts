/**
 * UpgradesShop: one FSM state with two modes. 'midrun' is the Patch Bay pushed over Playing (midrunShop.ts);
 * 'meta' is the Firmware hangar that replaces MainMenu (hangar.ts). The payload decides which controller runs.
 */
import type { Services } from '../contracts/services';
import type { GameState, StatePayloads } from '../contracts/states';
import { HangarController } from './hangar';
import { IntentReader } from './intents';
import { MidrunShopController } from './midrunShop';

class UpgradesShopStateImpl implements GameState<'UpgradesShop'> {
  readonly id = 'UpgradesShop' as const;
  readonly layer = 'overlay' as const;
  readonly worldBelow = 'frozen' as const;
  private readonly s: Services;
  private readonly intents = new IntentReader();
  private readonly midrun: MidrunShopController;
  private readonly hangar: HangarController;
  private mode: 'midrun' | 'meta' | null = null;

  constructor(s: Services) {
    this.s = s;
    this.midrun = new MidrunShopController(s);
    this.hangar = new HangarController(s);
  }

  enter(payload: StatePayloads['UpgradesShop']): void {
    if (payload.mode === 'meta') {
      this.mode = 'meta';
      this.intents.open(this.s.ui, 'hangar');
      this.hangar.enter();
      return;
    }
    this.mode = this.midrun.enter() ? 'midrun' : null;
    this.intents.open(this.s.ui, 'shop');
  }

  exit(): void {
    this.intents.close();
    if (this.mode === 'meta') this.hangar.exit();
    else if (this.mode === 'midrun') this.midrun.exit();
    this.mode = null;
  }

  onCovered(): void {
    if (this.mode === 'midrun') this.midrun.onCovered();
  }

  onUncovered(): void {
    if (this.mode === 'midrun') this.midrun.onUncovered();
  }

  update(frameDt: number): void {
    const intents = this.intents.read(this.s.input, frameDt * 1000);
    if (this.mode === 'meta') this.hangar.update(intents);
    else if (this.mode === 'midrun') this.midrun.update(frameDt, intents);
  }
}

export function createUpgradesShopState(s: Services): GameState<'UpgradesShop'> {
  return new UpgradesShopStateImpl(s);
}

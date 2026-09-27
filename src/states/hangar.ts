/**
 * UpgradesShop{meta} controller: the Firmware hangar over the MenuBackdrop. One shared cursor; every purchase,
 * unlock or respec is committed to the save immediately (save.commit). Respec asks for a second confirm.
 * Within one frame P1's (and shared) intents are handled before P2's. A read-only save (newer version) refuses
 * every purchase.
 */
import { META_UPGRADE_IDS, VEHICLE_IDS, type MetaUpgradeId, type VehicleId } from '../contracts/ids';
import type { SaveDataV1, SaveDelta } from '../contracts/save';
import type { Services } from '../contracts/services';
import type { HangarVM } from '../contracts/ui';
import { metaDef, metaLevel } from '../config/metaCatalog';
import { metaBuy, metaRespec, metaUnlock, type MetaFailure, type MetaResult } from '../upgrades/MetaShop';
import { indexOfId, wrapIndex, type UiIntent } from './intents';
import { META_ITEM_PREFIX, RESPEC_ITEM, UNLOCK_ITEM_PREFIX, buildHangarVM } from './viewModels';

function metaIdOf(itemId: string): MetaUpgradeId | null {
  if (!itemId.startsWith(META_ITEM_PREFIX)) return null;
  const rest = itemId.slice(META_ITEM_PREFIX.length);
  for (const id of META_UPGRADE_IDS) if (id === rest) return id;
  return null;
}

function vehicleOf(itemId: string): VehicleId | null {
  if (!itemId.startsWith(UNLOCK_ITEM_PREFIX)) return null;
  const rest = itemId.slice(UNLOCK_ITEM_PREFIX.length);
  for (const v of VEHICLE_IDS) if (v === rest) return v;
  return null;
}

export class HangarController {
  private readonly s: Services;
  private cursor = 0;
  private message = '';
  private respecArmed = false;
  private dirty = true;
  private leaving = false;
  private unsubExternal: (() => void) | null = null;

  constructor(s: Services) {
    this.s = s;
  }

  enter(): void {
    const s = this.s;
    this.cursor = 0;
    this.message = '';
    this.respecArmed = false;
    this.leaving = false;
    s.input.setContext('menu');
    s.render.setCameraMode('attract');
    s.audio.setMood('menu');
    this.unsubExternal = s.save.onExternalChange(() => {
      this.dirty = true;
    });
    s.ui.show('hangar', this.vm());
    this.dirty = false;
  }

  exit(): void {
    if (this.unsubExternal !== null) this.unsubExternal();
    this.unsubExternal = null;
    this.s.ui.hide('hangar');
  }

  update(intents: readonly UiIntent[]): void {
    // P1 and shared intents first, then P2 (hangar contention within one frame resolves P1 then P2).
    for (let pass = 0; pass < 2; pass++) {
      for (const i of intents) {
        if (this.leaving) return;
        const second = i.player === 1;
        if (second === (pass === 1)) this.handle(i);
      }
    }
    if (this.dirty) {
      this.dirty = false;
      this.s.ui.update('hangar', this.vm());
    }
  }

  private get readOnly(): boolean {
    return this.s.save.status === 'readOnlyFuture';
  }

  private vm(): HangarVM {
    const vm = buildHangarVM(this.s.save.data, this.cursor, this.s.theme(), this.message);
    this.cursor = vm.cursor;
    return { ...vm, readOnly: this.readOnly };
  }

  private handle(i: UiIntent): void {
    const items = buildHangarVM(this.s.save.data, 0, this.s.theme(), '').items;
    switch (i.kind) {
      case 'up':
      case 'down':
        this.cursor = wrapIndex(this.cursor, i.kind === 'up' ? -1 : 1, items.length);
        this.respecArmed = false;
        this.message = '';
        this.dirty = true;
        this.s.audio.play('uiMove');
        return;
      case 'back':
        this.s.audio.play('uiBack');
        this.leaving = this.s.fsm.request('MainMenu');
        return;
      case 'confirm': {
        const target = i.pointer ? indexOfId(items, i.itemId) : this.cursor;
        const item = items[target];
        if (item === undefined) return;
        if (target !== this.cursor) this.respecArmed = false;
        this.cursor = target;
        this.dirty = true;
        this.activate(item.id);
        return;
      }
      case 'left':
      case 'right':
      case 'ready':
      case 'pause':
        return;
    }
  }

  private activate(itemId: string): void {
    const s = this.s;
    if (this.readOnly) {
      this.deny('Read-only save: purchases are disabled.');
      return;
    }
    const n = s.theme().names;
    const meta = metaIdOf(itemId);
    if (meta !== null) {
      this.respecArmed = false;
      if (this.settle((d) => metaBuy(d, meta)))
        this.message = `${metaDef(meta).label} upgraded to level ${metaLevel(s.save.data.meta, meta)}`;
      return;
    }
    const vehicle = vehicleOf(itemId);
    if (vehicle !== null) {
      this.respecArmed = false;
      if (this.settle((d) => metaUnlock(d, vehicle))) this.message = `${n.vehicles[vehicle]} unlocked`;
      return;
    }
    if (itemId !== RESPEC_ITEM) return;
    const r = metaRespec(s.save.data);
    if (!r.ok) {
      this.deny(this.failText(r.reason));
      return;
    }
    if (!this.respecArmed) {
      this.respecArmed = true;
      this.message = `Confirm again to reset ${n.meta} and refund ${r.price} ${n.metaCurrency}.`;
      s.audio.play('uiConfirm');
      return;
    }
    this.respecArmed = false;
    if (this.settle(metaRespec)) this.message = `Refunded ${r.price} ${n.metaCurrency}`;
  }

  /**
   * Evaluates `op` on the cached save and commits it; returns true when the purchase went through. SaveStore
   * re-validates the delta against the stored save: when another tab changed it, the delta is refused, the
   * cache is refreshed and `op` is re-evaluated to explain why.
   */
  private settle(op: (d: SaveDataV1) => MetaResult): boolean {
    const r = op(this.s.save.data);
    if (!r.ok) {
      this.deny(this.failText(r.reason));
      return false;
    }
    if (!this.commit(r.delta)) {
      const again = op(this.s.save.data);
      this.deny(again.ok ? 'The save changed in another tab: try again.' : this.failText(again.reason));
      return false;
    }
    this.s.audio.play('uiBuy');
    return true;
  }

  /** False only when the store refused a stale delta (nothing was applied). */
  private commit(delta: SaveDelta): boolean {
    const res = this.s.save.commit(delta);
    if (res.ok) return true;
    if (res.error === 'readOnly') {
      this.s.ui.toast('Read-only save: the purchase was not stored.', 'warn');
      return true;
    }
    // A refused stale delta reports 'unavailable' without touching the status; a failed write sets memoryOnly.
    if (res.error === 'unavailable' && this.s.save.status !== 'memoryOnly') return false;
    // The change is applied in memory; only persisting failed (quota / storage unavailable).
    this.s.ui.toast('Could not write the save: progress is kept for this session only.', 'error');
    return true;
  }

  private failText(reason: MetaFailure): string {
    const n = this.s.theme().names;
    switch (reason) {
      case 'funds':
        return `Not enough ${n.metaCurrency}`;
      case 'maxLevel':
        return 'Already at max level';
      case 'alreadyUnlocked':
        return 'Already unlocked';
      case 'nothingToRefund':
        return 'Nothing to refund';
      case 'invalid':
        return 'Not possible';
    }
  }

  private deny(message: string): void {
    this.message = message;
    this.dirty = true;
    this.s.audio.play('uiDeny');
  }
}

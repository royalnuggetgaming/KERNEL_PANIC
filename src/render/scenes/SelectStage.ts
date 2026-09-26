/**
 * CharacterSelect stage: two turntable pedestals (P1 left, P2 right) showing the selected vehicles with the
 * player hull materials; an empty pedestal (null) hides its craft. Turntables spin slowly (reduce motion slows
 * them further).
 */
import { Group, Mesh, type BufferGeometry } from 'three';
import type { VehicleId } from '../../contracts/ids';
import type { AssetSource } from './ArenaScene';

export const PEDESTAL_X = 3.4;
const SPIN = 0.6;

export class SelectStage {
  readonly root = new Group();
  private readonly craft: Mesh[] = [];
  private readonly assets: AssetSource;
  private readonly shown: (VehicleId | null)[] = [null, null];
  private t = 0;

  constructor(assets: AssetSource) {
    this.assets = assets;
    this.root.name = 'selectStage';
    for (let i = 0; i < 2; i++) {
      const m = new Mesh(assets.getGeometry('vehicle:lancer'), assets.getMaterial(i === 0 ? 'hull:0' : 'hull:1'));
      m.name = `pedestal:${String(i)}`;
      m.frustumCulled = false;
      m.matrixAutoUpdate = false;
      m.visible = false;
      this.craft.push(m);
      this.root.add(m);
    }
  }

  show(sel: readonly [VehicleId | null, VehicleId | null]): void {
    for (let i = 0; i < 2; i++) {
      const v = sel[i === 0 ? 0 : 1];
      const m = this.craft[i]!;
      this.shown[i] = v;
      if (v === null) {
        m.visible = false;
        continue;
      }
      const g: BufferGeometry = this.assets.getGeometry(`vehicle:${v}`);
      if (m.geometry !== g) m.geometry = g;
      m.visible = true;
    }
  }

  update(dt: number, reduceMotion: boolean): void {
    if (!this.root.visible) return;
    this.t += reduceMotion ? dt * 0.25 : dt;
    for (let i = 0; i < 2; i++) {
      const m = this.craft[i]!;
      if (this.shown[i] === null) continue;
      m.position.set(i === 0 ? -PEDESTAL_X : PEDESTAL_X, 1.1 + Math.sin(this.t * 2 + i) * 0.08, 0);
      m.rotation.set(0.15, this.t * SPIN * (i === 0 ? 1 : -1) + i * Math.PI, 0, 'YXZ');
      m.scale.setScalar(1.6);
      m.updateMatrix();
    }
  }
}

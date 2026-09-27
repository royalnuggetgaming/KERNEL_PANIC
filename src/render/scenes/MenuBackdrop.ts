/**
 * Attract-mode backdrop (MainMenu, Hangar): the voxel title floating above the arena and 6 idle drones (hull
 * meshes alternating the P1/P2 materials) drifting on lazy orbits. Only animated while visible.
 */
import { Group, Mesh } from 'three';
import { VEHICLE_IDS } from '../../contracts/ids';
import type { AssetSource } from './ArenaScene';

export const DRONE_COUNT = 6;
const TITLE_HEIGHT = 16;
const TITLE_SCALE = 1.5;

export class MenuBackdrop {
  readonly root = new Group();
  readonly title: Mesh;
  private readonly drones: Mesh[] = [];
  private t = 0;

  constructor(assets: AssetSource) {
    this.root.name = 'menuBackdrop';
    this.title = new Mesh(assets.getGeometry('title'), assets.getMaterial('title'));
    this.title.name = 'title';
    this.title.frustumCulled = false;
    this.title.matrixAutoUpdate = false;
    this.root.add(this.title);
    for (let i = 0; i < DRONE_COUNT; i++) {
      const v = VEHICLE_IDS[i % VEHICLE_IDS.length]!;
      const m = new Mesh(
        assets.getGeometry(`vehicle:${v}`),
        assets.getMaterial(i % 2 === 0 ? 'hull:0' : 'hull:1'),
      );
      m.name = `drone:${String(i)}`;
      m.frustumCulled = false;
      m.matrixAutoUpdate = false;
      this.drones.push(m);
      this.root.add(m);
    }
    this.update(0, false, 0, 1);
  }

  get visible(): boolean {
    return this.root.visible;
  }

  set visible(v: boolean) {
    this.root.visible = v;
  }

  /** Animates drones; the title turns to face the camera at (camX, camZ). */
  update(dt: number, reduceMotion: boolean, camX: number, camZ: number): void {
    if (!this.root.visible) return;
    this.t += reduceMotion ? dt * 0.25 : dt;
    const t = this.t;
    this.title.position.set(0, TITLE_HEIGHT + Math.sin(t * 0.8) * 0.4, 0);
    this.title.rotation.set(0, Math.atan2(camX, camZ) + Math.sin(t * 0.3) * 0.1, 0, 'YXZ');
    this.title.scale.setScalar(TITLE_SCALE);
    this.title.updateMatrix();
    for (let i = 0; i < this.drones.length; i++) {
      const m = this.drones[i]!;
      const phase = (i / DRONE_COUNT) * Math.PI * 2;
      const r = 11 + (i % 3) * 5;
      const a = phase + t * (0.18 + (i % 2) * 0.07) * (i % 2 === 0 ? 1 : -1);
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      const heading = a + (i % 2 === 0 ? Math.PI / 2 : -Math.PI / 2);
      m.position.set(x, 0.6 + Math.sin(t * 1.3 + phase) * 0.25, z);
      m.rotation.set(0, heading, Math.sin(t + phase) * 0.15, 'YXZ');
      m.updateMatrix();
    }
  }
}

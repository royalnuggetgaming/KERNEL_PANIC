/**
 * Static arena props (4 draw calls): floor plane, sky dome, hex force-field wall band and the
 * pylons (one per ARENA.PORTALS portal, merged into the arena:pylon geometry). Matrices are
 * computed once (matrixAutoUpdate off); the arena is always in view, so frustum culling is off.
 */
import { Group, Mesh, type BufferGeometry, type ShaderMaterial } from 'three';
import type { GeometryKey, MaterialKey } from '../../contracts/render';

export interface AssetSource {
  getMaterial(key: MaterialKey): ShaderMaterial;
  getGeometry(key: GeometryKey): BufferGeometry;
}

function staticMesh(assets: AssetSource, geo: GeometryKey, mat: MaterialKey, order: number): Mesh {
  const m = new Mesh(assets.getGeometry(geo), assets.getMaterial(mat));
  m.name = geo;
  m.frustumCulled = false;
  m.matrixAutoUpdate = false;
  m.renderOrder = order;
  m.updateMatrix();
  return m;
}

export class ArenaScene {
  readonly root = new Group();
  readonly floor: Mesh;
  readonly sky: Mesh;
  readonly wall: Mesh;
  readonly pylons: Mesh;

  constructor(assets: AssetSource) {
    this.sky = staticMesh(assets, 'arena:sky', 'sky', -10);
    this.floor = staticMesh(assets, 'arena:floor', 'floor', -5);
    this.pylons = staticMesh(assets, 'arena:pylon', 'pylon', 0);
    this.wall = staticMesh(assets, 'arena:wall', 'wall', 5);
    this.root.name = 'arena';
    this.root.matrixAutoUpdate = false;
    this.root.add(this.sky, this.floor, this.pylons, this.wall);
  }

  /** Wall and pylons hide outside gameplay (menus keep the floor and sky as a backdrop). */
  setGameplay(on: boolean): void {
    this.wall.visible = on;
    this.pylons.visible = on;
  }
}

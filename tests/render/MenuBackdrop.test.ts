import { BoxGeometry, ShaderMaterial, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CameraRig } from '../../src/render/CameraRig';
import { MenuBackdrop } from '../../src/render/scenes/MenuBackdrop';
import type { AssetSource } from '../../src/render/scenes/ArenaScene';

const assets: AssetSource = {
  getMaterial: () => new ShaderMaterial(),
  getGeometry: () => new BoxGeometry(1, 1, 1),
};

describe('MenuBackdrop', () => {
  it('keeps the 3D title in the top band of the attract view, clear of the DOM title and menu', () => {
    // Regression (Wave 3 browser smoke): at height 9 the voxel title projected onto the DOM title/tagline.
    const backdrop = new MenuBackdrop(assets);
    for (const [w, h] of [
      [1512, 982],
      [1280, 720],
    ] as const) {
      const rig = new CameraRig(1);
      rig.setViewport(w, h);
      rig.setMode('attract');
      for (let i = 0; i < 30; i++) rig.update(null, 1, 1 / 60);
      const cam = rig.camera;
      cam.updateMatrixWorld(true);
      backdrop.update(0, false, cam.position.x, cam.position.z);
      const p = new Vector3().setFromMatrixPosition(backdrop.title.matrix).project(cam);
      // NDC y 0.55 is ~22% from the top of the screen; the DOM title sits at ~34%.
      expect(p.y).toBeGreaterThan(0.55);
      expect(p.y).toBeLessThan(0.95);
    }
  });
});

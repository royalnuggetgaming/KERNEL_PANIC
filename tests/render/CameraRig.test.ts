import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { ViewRect } from '../../src/contracts/world';
import { CAMERA } from '../../src/config/tuning';
import { CameraRig } from '../../src/render/CameraRig';
import { framingFits, createFramingPoints, collectFramingPoints } from '../../src/render/cameraMath';
import { createTestWorld, placePlayer } from '../helpers/worldFixture';

const DT = 1 / 120;

function run(rig: CameraRig, w: Parameters<CameraRig['update']>[0], frames: number): void {
  for (let i = 0; i < frames; i++) rig.update(w, 1, DT);
}

describe('CameraRig', () => {
  it('follow: snaps on attach, then keeps both players framed (versus included)', () => {
    const w = createTestWorld({ mode: 'versus' });
    placePlayer(w, 0, -10, 0);
    placePlayer(w, 1, 10, 0);
    const rig = new CameraRig(1);
    rig.setViewport(1600, 1000);
    rig.setMode('follow');
    rig.update(w, 1, DT);
    const pts = createFramingPoints();
    const n = collectFramingPoints(w, pts);
    expect(framingFits(pts, n, rig.aspect, rig.pose.targetX, rig.pose.targetZ, rig.pose.distance)).toBe(true);
    // Players run to opposite edges: zoom-out wins quickly and reaches maxDist.
    placePlayer(w, 0, 0, -31);
    placePlayer(w, 1, 0, 31);
    run(rig, w, 240);
    expect(rig.distance).toBeCloseTo(rig.maxDist, 0);
    // The camera looks at the target from the pitched rig.
    const dir = rig.camera.getWorldDirection(new Vector3());
    expect(dir.y).toBeCloseTo(-Math.sin((CAMERA.PITCH_DEG * Math.PI) / 180), 3);
  });

  it('publishes a view rect containing the framed players', () => {
    const w = createTestWorld();
    placePlayer(w, 0, -6, 3);
    placePlayer(w, 1, 8, -2);
    const rig = new CameraRig();
    rig.setViewport(1280, 720);
    rig.setMode('follow');
    run(rig, w, 10);
    const r: ViewRect = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
    rig.viewRect(r);
    for (const p of w.players) {
      expect(p.x).toBeGreaterThan(r.minX);
      expect(p.x).toBeLessThan(r.maxX);
      expect(p.z).toBeGreaterThan(r.minZ);
      expect(p.z).toBeLessThan(r.maxZ);
    }
  });

  it('boss intro pushes in on the boss; countdown swoops from maxDist', () => {
    const w = createTestWorld({ mode: 'solo' });
    placePlayer(w, 0, 0, 10);
    const rig = new CameraRig();
    rig.setViewport(1600, 1000);
    rig.setMode('follow');
    run(rig, w, 5);
    rig.bossIntro(0, -12);
    run(rig, w, Math.floor(CAMERA.BOSS_INTRO * 120) - 1);
    expect(rig.pose.targetZ).toBeLessThan(-5);
    rig.countdownSwoop();
    rig.update(w, 1, DT);
    expect(rig.distance).toBeGreaterThan(rig.maxDist * 0.95);
    run(rig, w, 600);
    expect(rig.distance).toBeLessThan(rig.maxDist * 0.6);
  });

  it('solo zooms out up to +15% at max speed', () => {
    const w = createTestWorld({ mode: 'solo' });
    const p = w.players[0];
    placePlayer(w, 0, 0, 0);
    const rig = new CameraRig();
    rig.setViewport(1600, 1000);
    rig.setMode('follow');
    run(rig, w, 5);
    const still = rig.distance;
    p.vx = p.stats.moveSpeed;
    run(rig, w, 240);
    expect(rig.distance).toBeGreaterThan(still * 1.1);
    expect(rig.distance).toBeLessThanOrEqual(still * (1 + CAMERA.SOLO_SPEED_ZOOM) + 1e-6);
  });

  it('gameover pushes in slowly; attract and select modes place the camera', () => {
    const w = createTestWorld();
    const rig = new CameraRig();
    rig.setViewport(1600, 1000);
    rig.setMode('follow');
    run(rig, w, 5);
    const start = rig.distance;
    rig.setMode('gameover');
    run(rig, w, 120);
    const mid = rig.distance;
    expect(mid).toBeLessThan(start);
    expect(mid).toBeGreaterThan(start * 0.7);
    run(rig, w, 1200);
    expect(rig.distance).toBeCloseTo(start * 0.7, 3);
    rig.setMode('attract');
    rig.update(null, 1, 1);
    expect(rig.camera.position.y).toBeGreaterThan(10);
    rig.setMode('select');
    rig.update(null, 1, 1);
    expect(rig.camera.position.z).toBeGreaterThan(5);
    expect(rig.mode).toBe('select');
  });

  it('shake offsets the camera but never the published pose; reduce motion disables it', () => {
    const w = createTestWorld();
    const rig = new CameraRig(9);
    rig.setViewport(1600, 1000);
    rig.setMode('follow');
    run(rig, w, 5);
    const before = { ...rig.pose };
    rig.trauma(0.35);
    rig.update(w, 1, DT);
    expect(rig.pose.targetX).toBeCloseTo(before.targetX, 6);
    expect(rig.shake.trauma).toBeGreaterThan(0);
    rig.setReduceMotion(true);
    rig.trauma(0.35);
    rig.update(w, 1, DT);
    expect(rig.shake.offsetX).toBe(0);
  });

  it('recomputes maxDist on resize and snaps after an aspect jump', () => {
    const w = createTestWorld();
    placePlayer(w, 0, -20, 0);
    placePlayer(w, 1, 20, 0);
    const rig = new CameraRig();
    rig.setViewport(1600, 1000);
    rig.setMode('follow');
    run(rig, w, 240);
    const wide = rig.distance;
    rig.setViewport(600, 1000);
    expect(rig.maxDist).toBeGreaterThan(0);
    rig.update(w, 1, DT);
    expect(rig.distance).toBeGreaterThan(wide);
  });
});

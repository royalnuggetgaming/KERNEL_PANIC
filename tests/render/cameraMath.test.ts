import { describe, expect, it } from 'vitest';
import type { ViewRect } from '../../src/contracts/world';
import { ARENA, CAMERA, SIM } from '../../src/config/tuning';
import { FollowController } from '../../src/render/cameraFollow';
import {
  collectFramingPoints,
  collectFramingPointsInterp,
  createFramingPoints,
  framingFits,
  leadFromPlayers,
  projectToNdc,
  solveFraming,
  solveMaxDistance,
  viewRectOnGround,
  type CameraPose,
  type FramingPoint,
} from '../../src/render/cameraMath';
import { createTestWorld, placePlayer } from '../helpers/worldFixture';

const ASPECTS = [0.5, 1.0, 1.6, 2.4] as const;

function pose(): CameraPose {
  return { targetX: 0, targetZ: 0, distance: 0 };
}

function pts(list: readonly (readonly [number, number, number])[]): FramingPoint[] {
  const out = createFramingPoints();
  for (let i = 0; i < list.length; i++) {
    const [x, z, pad] = list[i]!;
    out[i]!.x = x;
    out[i]!.z = z;
    out[i]!.pad = pad;
  }
  return out;
}

function rect(): ViewRect {
  return { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
}

describe('solveMaxDistance', () => {
  it.each(ASPECTS)('fits the arena plus margin inside NDC +-0.95 at aspect %s', (aspect) => {
    const d = solveMaxDistance(aspect);
    expect(d).toBeGreaterThanOrEqual(CAMERA.MIN_DIST);
    const p = { targetX: 0, targetZ: 0, distance: d };
    const o = { x: 0, y: 0 };
    const r = ARENA.RADIUS + CAMERA.ARENA_MARGIN;
    let maxAbs = 0;
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      projectToNdc(p, aspect, Math.sin(a) * r, Math.cos(a) * r, o);
      maxAbs = Math.max(maxAbs, Math.abs(o.x), Math.abs(o.y));
    }
    // 16 samples of the circle: between samples the chord bulges slightly; allow a small tolerance.
    expect(maxAbs).toBeLessThanOrEqual(CAMERA.MAXDIST_NDC + 0.01);
    // Tight: 2% closer no longer fits.
    const closer = { targetX: 0, targetZ: 0, distance: d * 0.98 };
    let worst = 0;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      projectToNdc(closer, aspect, Math.sin(a) * r, Math.cos(a) * r, o);
      worst = Math.max(worst, Math.abs(o.x), Math.abs(o.y));
    }
    expect(worst).toBeGreaterThan(CAMERA.MAXDIST_NDC);
  });

  it('needs more distance for portrait than landscape', () => {
    expect(solveMaxDistance(0.5)).toBeGreaterThan(solveMaxDistance(1.6));
    expect(solveMaxDistance(0.0001)).toBeGreaterThan(solveMaxDistance(0.5));
  });
});

describe('solveFraming', () => {
  it.each([1.0, 1.6, 2.4])('two players at opposite edges give maxDist at aspect %s', (aspect) => {
    const maxD = solveMaxDistance(aspect);
    const p = pts([
      [0, -ARENA.RADIUS, CAMERA.PAD_ALIVE],
      [0, ARENA.RADIUS, CAMERA.PAD_ALIVE],
    ]);
    const out = solveFraming(p, 2, aspect, 0, 0, maxD, pose());
    expect(out.distance).toBe(maxD);
    expect(framingFits(p, 2, aspect, out.targetX, out.targetZ, maxD * 1.5)).toBe(true);
    const o = { x: 0, y: 0 };
    for (let i = 0; i < 2; i++) {
      projectToNdc(out, aspect, p[i]!.x, p[i]!.z, o);
      // Edge players cannot keep their padding in the safe box; at maxDist they stay inside the arena fit box.
      expect(Math.abs(o.x)).toBeLessThanOrEqual(CAMERA.MAXDIST_NDC);
      expect(Math.abs(o.y)).toBeLessThanOrEqual(CAMERA.MAXDIST_NDC);
    }
  });

  it.each(ASPECTS)('keeps every padded point in the safe box when it fits (aspect %s)', (aspect) => {
    const maxD = solveMaxDistance(aspect);
    const p = pts([
      [-8, 3, CAMERA.PAD_ALIVE],
      [6, -5, CAMERA.PAD_DOWNED],
    ]);
    const out = solveFraming(p, 2, aspect, 0, 0, maxD, pose());
    expect(out.distance).toBeLessThan(maxD);
    expect(framingFits(p, 2, aspect, out.targetX, out.targetZ, out.distance)).toBe(true);
    if (out.distance > CAMERA.MIN_DIST) {
      // Minimal: 3% closer breaks the fit.
      expect(framingFits(p, 2, aspect, out.targetX, out.targetZ, out.distance * 0.97)).toBe(false);
    }
  });

  it('clamps to MIN_DIST for a single close target and centres on it', () => {
    const out = solveFraming(pts([[2, 1, 7]]), 1, 1.6, 0, 0, solveMaxDistance(1.6), pose());
    expect(out.distance).toBe(CAMERA.MIN_DIST);
    expect(out.targetX).toBeCloseTo(2);
    expect(out.targetZ).toBeCloseTo(1);
  });

  it('adds a lead clamped to LEAD_MAX and clamps the centre to CENTER_CLAMP', () => {
    const maxD = solveMaxDistance(1.6);
    const a = solveFraming(pts([[0, 0, 7]]), 1, 1.6, 100, 0, maxD, pose());
    expect(a.targetX).toBeCloseTo(CAMERA.LEAD_MAX);
    const b = solveFraming(pts([[30, 0, 7]]), 1, 1.6, 0, 0, maxD, pose());
    expect(Math.hypot(b.targetX, b.targetZ)).toBeCloseTo(CAMERA.CENTER_CLAMP);
  });

  it('keeps the target and clamps the distance with an empty set', () => {
    const p: CameraPose = { targetX: 3, targetZ: -2, distance: 500 };
    solveFraming(createFramingPoints(), 0, 1.6, 0, 0, 80, p);
    expect(p).toEqual({ targetX: 3, targetZ: -2, distance: 80 });
    p.distance = 1;
    solveFraming(createFramingPoints(), 0, 1.6, 0, 0, 80, p);
    expect(p.distance).toBe(CAMERA.MIN_DIST);
  });

  it('frames a Downed player and excludes an Offline one', () => {
    const w = createTestWorld({ mode: 'coop' });
    placePlayer(w, 0, -20, 0);
    placePlayer(w, 1, 20, 0);
    const out = createFramingPoints();
    w.players[1].life = 'downed';
    expect(collectFramingPoints(w, out)).toBe(2);
    expect(out[1]).toEqual({ x: 20, z: 0, pad: CAMERA.PAD_DOWNED });
    const maxD = solveMaxDistance(1.6);
    const both = solveFraming(out, 2, 1.6, 0, 0, maxD, pose());
    expect(framingFits(out, 2, 1.6, both.targetX, both.targetZ, both.distance)).toBe(true);
    w.players[1].life = 'offline';
    expect(collectFramingPoints(w, out)).toBe(1);
    expect(out[0]!.pad).toBe(CAMERA.PAD_ALIVE);
    const solo = solveFraming(out, 1, 1.6, 0, 0, maxD, pose());
    expect(solo.distance).toBeLessThan(both.distance);
    w.players[0].life = 'respawning';
    expect(collectFramingPoints(w, out)).toBe(0);
  });

  it('versus: an eliminated player is still framed with downed padding; bosses get pad 4', () => {
    const w = createTestWorld({ mode: 'versus' });
    placePlayer(w, 0, -10, 0);
    placePlayer(w, 1, 10, 0);
    w.players[0].life = 'downed';
    const out = createFramingPoints();
    expect(collectFramingPoints(w, out)).toBe(2);
    expect(out[0]!.pad).toBe(CAMERA.PAD_DOWNED);
    const b = w.bosses[0]!;
    b.alive = true;
    b.x = b.prevX = 5;
    b.z = b.prevZ = -12;
    expect(collectFramingPoints(w, out)).toBe(3);
    expect(out[2]).toEqual({ x: 5, z: -12, pad: CAMERA.PAD_BOSS });
  });

  it('interpolates prev/current positions and computes the lead from alive players', () => {
    const w = createTestWorld({ mode: 'solo' });
    const p = w.players[0];
    p.prevX = 0;
    p.x = 10;
    p.prevZ = 4;
    p.z = 8;
    p.vx = 10;
    p.vz = 0;
    const out = createFramingPoints();
    expect(collectFramingPointsInterp(w, 0.25, out)).toBe(1);
    expect(out[0]!.x).toBeCloseTo(2.5);
    expect(out[0]!.z).toBeCloseTo(5);
    const lead = { x: 0, z: 0 };
    expect(leadFromPlayers(w, lead)).toBe(1);
    expect(lead.x).toBeCloseTo(10 * CAMERA.LEAD_TIME);
    p.life = 'downed';
    expect(leadFromPlayers(w, lead)).toBe(0);
    expect(lead).toEqual({ x: 0, z: 0 });
  });
});

describe('viewRectOnGround', () => {
  it.each(ASPECTS)('contains the framed points (aspect %s)', (aspect) => {
    const maxD = solveMaxDistance(aspect);
    const cases: (readonly (readonly [number, number, number])[])[] = [
      [
        [-12, 4, 7],
        [10, -6, 7],
      ],
      [
        [-25, 0, 7],
        [25, 0, 5],
      ],
      [[0, 0, 7]],
      [
        [0, -24, 7],
        [3, 20, 7],
      ],
    ];
    for (const c of cases) {
      const p = pts(c);
      const out = solveFraming(p, c.length, aspect, 0, 0, maxD, pose());
      const r = viewRectOnGround(out, aspect, rect());
      for (let i = 0; i < c.length; i++) {
        expect(p[i]!.x).toBeGreaterThanOrEqual(r.minX);
        expect(p[i]!.x).toBeLessThanOrEqual(r.maxX);
        expect(p[i]!.z).toBeGreaterThanOrEqual(r.minZ);
        expect(p[i]!.z).toBeLessThanOrEqual(r.maxZ);
      }
    }
  });

  it('matches the screen edges: corners of the rect project onto the frame', () => {
    const p: CameraPose = { targetX: 4, targetZ: -3, distance: 40 };
    const r = viewRectOnGround(p, 1.6, rect());
    const o = { x: 0, y: 0 };
    projectToNdc(p, 1.6, r.maxX, r.maxZ, o);
    expect(o.x).toBeCloseTo(1, 5);
    expect(o.y).toBeCloseTo(-1, 5);
    projectToNdc(p, 1.6, r.minX, r.minZ, o);
    expect(o.y).toBeCloseTo(1, 5);
    expect(Math.abs(o.x)).toBeLessThan(1);
    expect((r.minX + r.maxX) / 2).toBeCloseTo(4);
  });
});

describe('FollowController (smoothing + zoom hysteresis)', () => {
  const dt = 1 / 120;

  it('zooms out immediately and with priority', () => {
    const f = new FollowController();
    f.snap(0, 0, 30);
    f.update(0, 0, 60, dt);
    expect(f.distance).toBeGreaterThan(30);
    for (let i = 0; i < 240; i++) f.update(0, 0, 60, dt);
    expect(f.distance).toBeCloseTo(60, 1);
  });

  it('holds when the goal is less than 6% below the current distance', () => {
    const f = new FollowController();
    f.snap(0, 0, 50);
    for (let i = 0; i < 600; i++) f.update(0, 0, 50 * 0.95, dt);
    expect(f.distance).toBe(50);
  });

  it('waits ZOOM_IN_HOLD before zooming in, and resets the timer when the goal returns', () => {
    const f = new FollowController();
    f.snap(0, 0, 50);
    const holdFrames = Math.floor((CAMERA.ZOOM_IN_HOLD * 120) / 1) - 2;
    for (let i = 0; i < holdFrames; i++) f.update(0, 0, 30, dt);
    expect(f.distance).toBe(50);
    // Goal bounces back above the threshold: timer resets (no pumping).
    f.update(0, 0, 49, dt);
    expect(f.holdTimer).toBe(0);
    for (let i = 0; i < holdFrames; i++) f.update(0, 0, 30, dt);
    expect(f.distance).toBe(50);
    for (let i = 0; i < 4; i++) f.update(0, 0, 30, dt);
    expect(f.zoomingIn).toBe(true);
    for (let i = 0; i < 600; i++) f.update(0, 0, 30, dt);
    expect(f.distance).toBeCloseTo(30, 2);
    expect(f.zoomingIn).toBe(false);
  });

  it('a zoom-out cancels a zoom-in in progress; forceZoomIn skips the hold', () => {
    const f = new FollowController();
    f.snap(0, 0, 50);
    f.forceZoomIn();
    f.update(0, 0, 30, dt);
    expect(f.distance).toBeLessThan(50);
    f.update(0, 0, 70, dt);
    expect(f.zoomingIn).toBe(false);
  });

  it('is frame-rate independent for the centre', () => {
    const a = new FollowController();
    const b = new FollowController();
    a.snap(0, 0, 40);
    b.snap(0, 0, 40);
    for (let i = 0; i < 120; i++) a.update(10, -5, 40, 1 / 120);
    for (let i = 0; i < 60; i++) b.update(10, -5, 40, 1 / 60);
    expect(a.x).toBeCloseTo(b.x, 1);
    expect(a.z).toBeCloseTo(b.z, 1);
    a.update(0, 0, 40, 0);
    expect(a.x).toBeCloseTo(b.x, 1);
  });

  it('SIM.DT sanity: one second of 120 Hz smoothing lands close to the goal', () => {
    const f = new FollowController();
    f.snap(0, 0, 40);
    for (let i = 0; i < SIM.HZ; i++) f.update(8, 0, 40, SIM.DT);
    expect(f.x).toBeGreaterThan(7.9);
  });
});

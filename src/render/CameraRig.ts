/**
 * Camera modes (plan section 4): 'attract' (MenuBackdrop orbit), 'select' (SelectStage turntables), 'follow'
 * (adaptive shared framing: solveFraming on interpolated positions -> FollowController smoothing with asymmetric
 * zoom + hysteresis), 'gameover' (slow push-in at CAMERA.GAMEOVER_TIME_SCALE). Boss intro push-in, countdown swoop
 * from maxDist (only on a hard cut: see countdownSwoop), solo speed zoom-out, snap on aspect jumps > CAMERA.ASPECT_SNAP. Trauma shake is applied after
 * framing and never feeds the solver or the published view rect. Allocation-free per frame.
 */
import { PerspectiveCamera } from 'three';
import type { CameraMode } from '../contracts/render';
import type { ViewRect, WorldView } from '../contracts/world';
import { CAMERA } from '../config/tuning';
import { FollowController } from './cameraFollow';
import {
  collectFramingPointsInterp,
  createFramingPoints,
  leadFromPlayers,
  PITCH_COS,
  PITCH_SIN,
  solveFraming,
  solveMaxDistance,
  viewRectOnGround,
  type CameraPose,
} from './cameraMath';
import type { CameraCues } from './fx/FxDirector';
import { ScreenShake } from './ScreenShake';

const ATTRACT_RADIUS = 48;
const ATTRACT_HEIGHT = 22;
const ATTRACT_SPEED = 0.07;
const SELECT_POS = { x: 0, y: 6.2, z: 15 } as const;
const SELECT_LOOK = { x: 0, y: 1.1, z: 0 } as const;
/** Fraction of the distance removed by the GameOver push-in. */
const GAMEOVER_PUSH_FRAC = 0.3;

function smoothstep01(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

export class CameraRig implements CameraCues {
  readonly camera: PerspectiveCamera;
  readonly shake: ScreenShake;
  readonly follow = new FollowController();
  /** Current unshaken ground pose (follow/gameover). */
  readonly pose: CameraPose = { targetX: 0, targetZ: 0, distance: CAMERA.MIN_DIST };
  private readonly goal: CameraPose = { targetX: 0, targetZ: 0, distance: CAMERA.MIN_DIST };
  private readonly points = createFramingPoints();
  private readonly lead = { x: 0, z: 0 };
  private modeValue: CameraMode = 'attract';
  private aspectValue = 16 / 9;
  private maxDistValue = solveMaxDistance(16 / 9);
  private snapPending = true;
  /** A countdown swoop was cued since the last update (consumed by it). */
  private swoopCue = false;
  private bossIntroLeft = 0;
  private bossX = 0;
  private bossZ = 0;
  private gameoverT = 0;
  private gameoverStart: number = CAMERA.MIN_DIST;
  private attractAngle = 0;
  private reduceMotion = false;

  constructor(seed = 0x5eed) {
    this.camera = new PerspectiveCamera(CAMERA.FOV_DEG, this.aspectValue, 0.5, 1500);
    this.camera.matrixAutoUpdate = true;
    this.shake = new ScreenShake(seed);
  }

  get mode(): CameraMode {
    return this.modeValue;
  }

  get aspect(): number {
    return this.aspectValue;
  }

  get maxDist(): number {
    return this.maxDistValue;
  }

  get distance(): number {
    return this.pose.distance;
  }

  setViewport(width: number, height: number): void {
    const aspect = width / (height > 0 ? height : 1);
    const prev = this.aspectValue;
    if (Math.abs(aspect / prev - 1) > CAMERA.ASPECT_SNAP) this.snapPending = true;
    this.aspectValue = aspect;
    this.maxDistValue = solveMaxDistance(aspect);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  setMode(m: CameraMode): void {
    if (m === this.modeValue) return;
    if (m === 'gameover') {
      this.gameoverT = 0;
      this.gameoverStart = this.follow.distance;
    }
    if (m === 'follow' && this.modeValue !== 'gameover') this.snapPending = true;
    this.modeValue = m;
  }

  setReduceMotion(on: boolean): void {
    this.reduceMotion = on;
    this.shake.setReduceMotion(on);
  }

  /** Next follow update jumps straight to the goal (world attach, resize). */
  requestSnap(): void {
    this.snapPending = true;
  }

  trauma(amount: number): void {
    this.shake.add(amount);
  }

  bossIntro(x: number, z: number): void {
    this.bossIntroLeft = CAMERA.BOSS_INTRO;
    this.bossX = x;
    this.bossZ = z;
    this.follow.forceZoomIn();
  }

  /**
   * Wave/round countdown cue. The swoop (start at maxDist, then zoom in) only happens when the camera is cutting
   * anyway (world attach, i.e. the first wave coming from CharacterSelect). Mid-run the previous frame shows the
   * same arena (the frozen shop frame, or live play), so jumping the distance to maxDist would be a hard cut that
   * reads as the screen flashing; the sim also cues this every countdown second (3, 2, 1). There the camera just
   * keeps easing, so the distance stays continuous.
   */
  countdownSwoop(): void {
    if (this.reduceMotion) return;
    this.swoopCue = true;
  }

  /** Ground rect of the unshaken pose (published to the sim). */
  viewRect(out: ViewRect): ViewRect {
    return viewRectOnGround(this.pose, this.aspectValue, out);
  }

  update(w: WorldView | null, alpha: number, dt: number): void {
    this.shake.update(dt);
    const swoop = this.swoopCue;
    this.swoopCue = false;
    switch (this.modeValue) {
      case 'attract':
        this.updateAttract(dt);
        return;
      case 'select':
        this.camera.position.set(SELECT_POS.x, SELECT_POS.y, SELECT_POS.z);
        this.camera.up.set(0, 1, 0);
        this.camera.lookAt(SELECT_LOOK.x, SELECT_LOOK.y, SELECT_LOOK.z);
        return;
      case 'follow':
        this.updateFollow(w, alpha, dt, swoop);
        break;
      case 'gameover':
        this.updateGameover(dt);
        break;
    }
    this.applyPose();
  }

  private updateAttract(dt: number): void {
    this.attractAngle += dt * (this.reduceMotion ? ATTRACT_SPEED * 0.25 : ATTRACT_SPEED);
    const a = this.attractAngle;
    this.camera.position.set(Math.sin(a) * ATTRACT_RADIUS, ATTRACT_HEIGHT, Math.cos(a) * ATTRACT_RADIUS);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, 3, 0);
  }

  private updateFollow(w: WorldView | null, alpha: number, dt: number, swoop: boolean): void {
    const f = this.follow;
    const g = this.goal;
    g.targetX = f.x;
    g.targetZ = f.z;
    g.distance = f.distance;
    if (w !== null) {
      const n = collectFramingPointsInterp(w, alpha, this.points);
      leadFromPlayers(w, this.lead);
      solveFraming(this.points, n, this.aspectValue, this.lead.x, this.lead.z, this.maxDistValue, g);
      if (w.mode === 'solo') {
        const p = w.players[0];
        const top = p.stats.moveSpeed > 0 ? p.stats.moveSpeed : 1;
        const speed = Math.sqrt(p.vx * p.vx + p.vz * p.vz);
        const k = speed / top > 1 ? 1 : speed / top;
        const d = g.distance * (1 + CAMERA.SOLO_SPEED_ZOOM * k);
        g.distance = d > this.maxDistValue ? this.maxDistValue : d;
      }
      if (this.bossIntroLeft > 0) {
        this.bossIntroLeft -= dt;
        g.targetX = this.bossX;
        g.targetZ = this.bossZ;
        g.distance = CAMERA.MIN_DIST;
      }
    }
    if (this.snapPending) {
      this.snapPending = false;
      if (swoop) {
        f.snap(g.targetX, g.targetZ, this.maxDistValue);
        f.forceZoomIn();
      } else {
        f.snap(g.targetX, g.targetZ, g.distance);
      }
    } else {
      f.update(g.targetX, g.targetZ, g.distance, dt);
    }
    this.pose.targetX = f.x;
    this.pose.targetZ = f.z;
    this.pose.distance = f.distance;
  }

  private updateGameover(dt: number): void {
    this.gameoverT += (dt * CAMERA.GAMEOVER_TIME_SCALE) / CAMERA.GAMEOVER_PUSH;
    const k = smoothstep01(this.gameoverT);
    const d = this.gameoverStart * (1 - GAMEOVER_PUSH_FRAC * k);
    this.pose.targetX = this.follow.x;
    this.pose.targetZ = this.follow.z;
    this.pose.distance = d;
  }

  private applyPose(): void {
    const s = this.shake;
    const tx = this.pose.targetX + s.offsetX;
    const tz = this.pose.targetZ + s.offsetZ;
    const d = this.pose.distance;
    const cam = this.camera;
    cam.position.set(tx, d * PITCH_SIN, tz + d * PITCH_COS);
    cam.up.set(0, 1, 0);
    cam.lookAt(tx, 0, tz);
    if (s.roll !== 0) cam.rotateZ(s.roll);
  }
}

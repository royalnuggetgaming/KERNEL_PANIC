/**
 * Pure follow-camera smoothing (plan section 4 SMOOTHING): critically damped smoothDamp on the centre
 * (CAMERA.CENTER_SMOOTH) and an asymmetric zoom: zooming out (CAMERA.ZOOM_OUT_SMOOTH) always has priority; zooming
 * in (CAMERA.ZOOM_IN_SMOOTH) starts only after the goal has stayed more than CAMERA.ZOOM_IN_THRESHOLD below the
 * current distance for CAMERA.ZOOM_IN_HOLD seconds, so the camera never pumps. Frame-rate independent.
 */
import { CAMERA } from '../config/tuning';
import { smoothDamp, type SmoothDampState } from '../core/math';

export class FollowController {
  x = 0;
  z = 0;
  distance: number = CAMERA.MIN_DIST;
  /** Seconds the goal has been below the hysteresis threshold. */
  holdTimer = 0;
  /** True while a zoom-in is in progress (latched until the goal is reached or a zoom-out wins). */
  zoomingIn = false;
  private readonly vx: SmoothDampState = { velocity: 0 };
  private readonly vz: SmoothDampState = { velocity: 0 };
  private readonly vd: SmoothDampState = { velocity: 0 };

  /** Jumps to a pose without smoothing (first frame, aspect jumps). */
  snap(x: number, z: number, distance: number): void {
    this.x = x;
    this.z = z;
    this.distance = distance;
    this.vx.velocity = 0;
    this.vz.velocity = 0;
    this.vd.velocity = 0;
    this.holdTimer = 0;
    this.zoomingIn = false;
  }

  /** Starts a zoom-in immediately (countdown swoop, boss intro push-in). */
  forceZoomIn(): void {
    this.zoomingIn = true;
    this.holdTimer = 0;
  }

  update(goalX: number, goalZ: number, goalDist: number, dt: number): void {
    if (!(dt > 0)) return;
    this.x = smoothDamp(this.x, goalX, this.vx, CAMERA.CENTER_SMOOTH, dt);
    this.z = smoothDamp(this.z, goalZ, this.vz, CAMERA.CENTER_SMOOTH, dt);
    const d = this.distance;
    if (goalDist > d + 1e-4) {
      // Zoom-out always wins and cancels any pending zoom-in.
      this.zoomingIn = false;
      this.holdTimer = 0;
      this.distance = smoothDamp(d, goalDist, this.vd, CAMERA.ZOOM_OUT_SMOOTH, dt);
      return;
    }
    if (this.zoomingIn) {
      this.distance = smoothDamp(d, goalDist, this.vd, CAMERA.ZOOM_IN_SMOOTH, dt);
      if (Math.abs(this.distance - goalDist) < 1e-3) {
        this.distance = goalDist;
        this.vd.velocity = 0;
        this.zoomingIn = false;
      }
      return;
    }
    this.vd.velocity = 0;
    if (goalDist < d * (1 - CAMERA.ZOOM_IN_THRESHOLD)) {
      this.holdTimer += dt;
      if (this.holdTimer >= CAMERA.ZOOM_IN_HOLD) {
        this.holdTimer = 0;
        this.zoomingIn = true;
        this.distance = smoothDamp(d, goalDist, this.vd, CAMERA.ZOOM_IN_SMOOTH, dt);
      }
    } else {
      this.holdTimer = 0;
    }
  }
}

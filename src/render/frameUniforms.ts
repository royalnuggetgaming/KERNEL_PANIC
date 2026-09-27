/**
 * Per-frame writes into the shared uniform block (render/assetTypes.ts SharedUniforms): the wrapped render clock
 * (uTime), interpolated sim time (uSimTime), beat, sector palette + fog, P2 colourblind swap, player light pools,
 * CSS-pixel resolution (marker sizes), reduce-flashes. Allocation-free after construction.
 */
import { Color } from 'three';
import type { WorldView } from '../contracts/world';
import type { ThemeDef } from '../contracts/theme';
import { SIM } from '../config/tuning';
import type { SharedUniforms } from './assetTypes';

/** uTime starts here so spawn-time records written early never read as negative (death-dissolve) times. */
export const CLOCK_START = 16;
/** uTime wraps after this many seconds (keeps float precision; record ages are far shorter). */
export const CLOCK_WRAP = 4096;

/** Wrapped render clock used by uTime and every ring/instance time stamp. */
export class RenderClock {
  private raw = 0;
  time = CLOCK_START;

  advance(dt: number): void {
    if (dt > 0) this.raw += dt;
    this.time = CLOCK_START + (this.raw % CLOCK_WRAP);
  }
}

/** Pure: render sim time for interpolation alpha (prev state = time - DT). */
export function renderSimTime(worldTime: number, alpha: number): number {
  return worldTime - (1 - alpha) * SIM.DT;
}

export class FrameUniforms {
  private readonly u: SharedUniforms;
  private readonly theme: ThemeDef;
  private readonly scratch = new Color();
  private sector: 1 | 2 | 3 = 1;

  constructor(u: SharedUniforms, theme: ThemeDef) {
    this.u = u;
    this.theme = theme;
    this.setSector(1);
    this.setColorblind(false);
  }

  setSector(s: 1 | 2 | 3): void {
    this.sector = s;
    const sectors = this.theme.palette.sectors;
    const pal = s === 1 ? sectors[0] : s === 2 ? sectors[1] : sectors[2];
    const list = this.u.uPalette.value;
    const hexes = [pal.floor, pal.grid, pal.accent, pal.sky, pal.fog, pal.enemy, pal.elite];
    for (let i = 0; i < list.length && i < hexes.length; i++) list[i]!.setHex(hexes[i]!);
    this.scratch.setHex(pal.fog);
    this.u.uFog.value.set(this.scratch.r, this.scratch.g, this.scratch.b, this.theme.shading.fogDensity);
  }

  get currentSector(): 1 | 2 | 3 {
    return this.sector;
  }

  setColorblind(on: boolean): void {
    this.u.uP1Color.value.setHex(this.theme.palette.p1);
    this.u.uP2Color.value.setHex(on ? this.theme.palette.p2Colorblind : this.theme.palette.p2);
  }

  setReduceFlashes(on: boolean): void {
    this.u.uReduceFlashes.value = on ? 1 : 0;
  }

  setBeat(phase: number): void {
    this.u.uBeat.value = phase;
  }

  /** CSS pixels (markers are sized in CSS px). */
  setResolution(cssWidth: number, cssHeight: number): void {
    this.u.uResolution.value.set(cssWidth, cssHeight);
  }

  update(time: number, w: WorldView | null, alpha: number): void {
    this.u.uTime.value = time;
    const pos = this.u.uPlayerPos.value;
    if (w === null) {
      for (let i = 0; i < pos.length; i++) pos[i]!.set(0, 0, 0);
      return;
    }
    this.u.uSimTime.value = renderSimTime(w.time, alpha);
    for (let i = 0; i < pos.length && i < 2; i++) {
      const p = w.players[i === 0 ? 0 : 1];
      const k = p.life === 'alive' ? 1 : p.life === 'downed' ? 0.45 : 0;
      pos[i]!.set(p.prevX + (p.x - p.prevX) * alpha, k, p.prevZ + (p.z - p.prevZ) * alpha);
    }
  }
}

/**
 * Record layouts of the write-once GPU rings (render/GpuRingBuffer). The shaders below read exactly these
 * attributes; render/fx writes records with these float offsets. Structurally compatible with
 * render/GpuRingBuffer RingAttribute. Times are in the shared uTime clock (seconds, as written to uTime).
 */
export interface RingRecordAttribute {
  readonly name: string;
  readonly size: 1 | 2 | 3 | 4;
  readonly offset: number;
}

export interface RingRecordLayout {
  /** Floats per record. */
  readonly stride: number;
  readonly attributes: readonly RingRecordAttribute[];
}

/**
 * Particles (12 floats): aP0 = (x, y, z, t0); aV0 = (vx, vy, vz, life s); aPX = (size u, drag 1/s,
 * gravity u/s^2 (positive pulls down), tint slot). life <= 0 or age outside [0, life] collapses the quad.
 */
export const PARTICLE_RECORD: RingRecordLayout = {
  stride: 12,
  attributes: [
    { name: 'aP0', size: 4, offset: 0 },
    { name: 'aV0', size: 4, offset: 4 },
    { name: 'aPX', size: 4, offset: 8 },
  ],
};

/**
 * Shockwaves (8 floats): aW0 = (x, z, t0, life s); aW1 = (max radius u, ring width u, tint slot, strength).
 */
export const SHOCKWAVE_RECORD: RingRecordLayout = {
  stride: 8,
  attributes: [
    { name: 'aW0', size: 4, offset: 0 },
    { name: 'aW1', size: 4, offset: 4 },
  ],
};

/**
 * Damage digits (8 floats): aD0 = (x, y, z, t0); aD1 = (value (integer >= 0, up to 6 digits), life s,
 * tint slot, scale; scale > 1.2 renders as a crit with a pop).
 */
export const DIGIT_RECORD: RingRecordLayout = {
  stride: 8,
  attributes: [
    { name: 'aD0', size: 4, offset: 0 },
    { name: 'aD1', size: 4, offset: 4 },
  ],
};

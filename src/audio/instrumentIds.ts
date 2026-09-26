/** Music instrument ids shared by the pure Composer and the Web Audio instruments. */

export const INSTRUMENT_IDS = ['pad', 'bass', 'distBass', 'arp', 'kick', 'hat', 'snare', 'lead'] as const;
export type InstrumentId = (typeof INSTRUMENT_IDS)[number];

/** Index of an instrument id, or -1 for an unknown name. */
export function instrumentIndex(name: string): number {
  for (let i = 0; i < INSTRUMENT_IDS.length; i++) if (INSTRUMENT_IDS[i] === name) return i;
  return -1;
}

/**
 * Minimum music intensity at which each layer plays (plan section 2: pad, sub bass, FM arp, 808 kit, and a
 * square lead strictly above 0.7). Layers fade in over LAYER_FADE above their threshold.
 */
export const LAYER_THRESHOLDS: Readonly<Record<InstrumentId, number>> = {
  pad: 0,
  bass: 0.15,
  distBass: 0.15,
  hat: 0.3,
  kick: 0.3,
  snare: 0.45,
  arp: 0.5,
  lead: 0.7,
};

export const LAYER_FADE = 0.12;

/**
 * ABYSSAL LIGHT (plan section 2): two bathysphere drones descend a lightless ocean trench, harvesting Lumen from
 * bioluminescent predators. Same mechanics and meshes as KERNEL PANIC, recoloured: dark water, caustic seabed,
 * light shafts, dense fog to black, slow D Dorian drones.
 */
import type { ThemeDef } from '../contracts/theme';

export const ABYSSAL_LIGHT: ThemeDef = {
  id: 'abyssalLight',
  title: 'ABYSSAL LIGHT',
  tagline: 'Harvest the light of the deep before the dark harvests you.',
  names: {
    runCurrency: 'Lumen',
    metaCurrency: 'Pearls',
    shop: 'Tether Station',
    meta: 'Refits',
    lives: 'Spare Hulls',
    wave: 'Swell',
    sector: 'Dive',
    vehicles: { lancer: 'MANTA', bulwark: 'DREDGER', specter: 'NEEDLEFISH', tinker: 'LANTERN' },
    vehicleBlurbs: {
      lancer: 'Balanced drone. Twin sonar darts.',
      bulwark: 'Heavy drone. Harpoon spread, ram dash, -20% contact damage.',
      specter: 'Glass cannon. Piercing spine stream, 2 dash charges.',
      tinker: 'Support. Chaining arc lamp, healing light.',
    },
    specials: {
      railburst: 'SONAR LANCE',
      firewall: 'BUBBLE DOME',
      blinkSwarm: 'INK BLINK',
      patchDrone: 'LIGHT CONE',
    },
    enemies: {
      shard: 'JELLY',
      dart: 'EEL',
      fork: 'SIPHON',
      spiker: 'URCHIN',
      warden: 'ISOPOD',
      leech: 'LAMPREY',
    },
    bosses: { forkBomb: 'BROOD MOTHER', raceCondition: 'TWIN ANGLERS', kernel: 'ABYSSAL MAW' },
    teamItems: {
      spareKernel: 'Spare Hull',
      linkAmp: 'Cable Amplifier',
      linkRange: 'Cable Length',
      reviveProtocol: 'Rescue Winch',
    },
    extract: 'SURFACE',
    pushDeeper: 'DIVE DEEPER',
    overflow: 'CRUSH DEPTH',
    versus: 'VERSUS',
    coop: 'CO-OP',
  },
  palette: {
    p1: 0x3cf0ff,
    p2: 0xff5fd8,
    p2Colorblind: 0xffa040,
    enemyShot: 0xff5a36,
    enemyShotCore: 0xffd6b0,
    pickup: 0xffe46b,
    link: 0xb08cff,
    ui: { bg: 0x02070d, panel: 0x08192a, text: 0xdff6ff, dim: 0x7493aa },
    // Bioluminescent enemies glow lime, elites violet-blue; walls deep blue to violet, all >= 30-40 deg off the
    // player hues and the coral enemy bullets (tests/render/sectorPalette.test.ts covers every theme).
    sectors: [
      {
        floor: 0x031019,
        grid: 0x2a8fc0,
        accent: 0x3a6dff,
        sky: 0x04192b,
        fog: 0x010509,
        enemy: 0x9dff4a,
        elite: 0x8a5cff,
      },
      {
        floor: 0x040a16,
        grid: 0x3560c8,
        accent: 0x5a5cff,
        sky: 0x060d22,
        fog: 0x010308,
        enemy: 0xa8ff3a,
        elite: 0x6b5cff,
      },
      {
        floor: 0x080514,
        grid: 0x6a3cc8,
        accent: 0x8a3cff,
        sky: 0x0b0620,
        fog: 0x020107,
        enemy: 0x7dff5a,
        elite: 0x4f6bff,
      },
    ],
  },
  // Meshes are shared with KERNEL PANIC (organic lathe creatures are not built): only the palette changes.
  geometry: { enemyFamily: 'platonic', hullStyle: 'sled', emissiveMask: 'edges', edgeWidth: 0.055 },
  shading: {
    floorMode: 'CAUSTICS',
    skyMode: 'ABYSS_RAYS',
    fogDensity: 0.017,
    heatShimmer: 0,
    minEmissive: 0.24,
    bloomStrength: 1.0,
    bloomThreshold: 0.75,
  },
  audio: {
    bpm: 76,
    rootMidi: 50,
    mode: 'dorian',
    progression: [0, 10, 5, 3],
    // Each dive sinks lower: D, C, A#.
    sectorKeyShift: [0, -2, -4],
    bossKeyShift: 1,
    timbre: 'abyssal',
  },
};

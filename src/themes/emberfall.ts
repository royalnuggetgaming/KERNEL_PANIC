/**
 * EMBERFALL (plan section 2): salvage tug pilots skim a shattered molten asteroid orbiting a dying red giant,
 * fighting rogue mining drones for Scrap. Same mechanics and meshes as KERNEL PANIC, recoloured: lava floor with
 * a cracked crust, a huge star corona in the sky, heat shimmer, 124 BPM industrial E Phrygian.
 */
import type { ThemeDef } from '../contracts/theme';

export const EMBERFALL: ThemeDef = {
  id: 'emberfall',
  title: 'EMBERFALL',
  tagline: 'Strip the molten rock for Scrap before the star swallows it.',
  names: {
    runCurrency: 'Scrap',
    metaCurrency: 'Alloy',
    shop: 'Salvage Bay',
    meta: 'Forge',
    lives: 'Spare Tugs',
    wave: 'Wave',
    sector: 'Orbit',
    vehicles: { lancer: 'TUG', bulwark: 'ANVIL', specter: 'SKIFF', tinker: 'WELDER' },
    vehicleBlurbs: {
      lancer: 'Balanced tug. Twin rivet gun.',
      bulwark: 'Heavy hauler. Flak spread, ram dash, -20% contact damage.',
      specter: 'Glass cannon. Piercing plasma needle, 2 dash charges.',
      tinker: 'Support. Chaining arc welder, repair drone.',
    },
    specials: {
      railburst: 'RIVET RAIL',
      firewall: 'CRUST DOME',
      blinkSwarm: 'FLARE JUMP',
      patchDrone: 'REPAIR RIG',
    },
    enemies: {
      shard: 'DRILL',
      dart: 'DIVER',
      fork: 'GOLEM',
      spiker: 'FLARE',
      warden: 'BRUTE',
      leech: 'MAGNET',
    },
    bosses: { forkBomb: 'FOUNDRY CRAWLER', raceCondition: 'TWIN SMELTERS', kernel: 'THE FURNACE CORE' },
    teamItems: {
      spareKernel: 'Spare Tug',
      linkAmp: 'Cable Booster',
      linkRange: 'Cable Reach',
      reviveProtocol: 'Tow Rescue',
    },
    extract: 'BREAK ORBIT',
    pushDeeper: 'BURN CLOSER',
    overflow: 'MELTDOWN',
    versus: 'VERSUS',
    coop: 'CO-OP',
  },
  palette: {
    p1: 0x2ee8ff,
    p2: 0xff4fe0,
    // Yellow instead of orange: an orange P2 would vanish against the lava.
    p2Colorblind: 0xffe95a,
    // Crimson bullets with a white-hot core sit apart from the orange lava seams.
    enemyShot: 0xff1f4a,
    enemyShotCore: 0xfff2ea,
    pickup: 0xffe27a,
    link: 0xbfe6ff,
    ui: { bg: 0x0d0503, panel: 0x1f0d07, text: 0xfff0e6, dim: 0xb08a78 },
    // Acid-green drones and violet elites read against the warm world; walls glow lava red-orange, >= 30 deg
    // off the player hues. The lava seams (grid) turn from orange to white-hot amber as the orbits close in, so
    // they never match the crimson enemy bullets (tests/render/sectorPalette.test.ts covers every theme).
    sectors: [
      {
        floor: 0x120604,
        grid: 0xff5a10,
        accent: 0xff5a1a,
        sky: 0x1a0705,
        fog: 0x0e0403,
        enemy: 0x8aff3c,
        elite: 0x8a6cff,
      },
      {
        floor: 0x150503,
        grid: 0xff7414,
        accent: 0xff4020,
        sky: 0x220604,
        fog: 0x110403,
        enemy: 0x6dff4a,
        elite: 0x6a7dff,
      },
      {
        floor: 0x1a0404,
        grid: 0xff9a20,
        accent: 0xff2a2a,
        sky: 0x2a0505,
        fog: 0x140303,
        enemy: 0x7aff3a,
        elite: 0xa070ff,
      },
    ],
  },
  // Meshes are shared with KERNEL PANIC (faceted tug hulls are not built): only the palette changes.
  geometry: { enemyFamily: 'platonic', hullStyle: 'sled', emissiveMask: 'edges', edgeWidth: 0.04 },
  shading: {
    floorMode: 'LAVA',
    skyMode: 'CORONA',
    fogDensity: 0.01,
    heatShimmer: 0.8,
    minEmissive: 0.15,
    bloomStrength: 0.85,
    bloomThreshold: 0.85,
  },
  audio: {
    bpm: 124,
    rootMidi: 52,
    mode: 'phrygian',
    progression: [0, 1, 10, 1],
    // Each orbit closer to the star climbs: E, F, G.
    sectorKeyShift: [0, 1, 3],
    bossKeyShift: 1,
    timbre: 'industrial',
  },
};

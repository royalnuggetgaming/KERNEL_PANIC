# KERNEL PANIC: How to Play

This manual is also in the game: **HOW TO PLAY** on the main menu and in the pause menu. It is generated from
the game data (`src/states/manualPages.ts`), so the numbers match the current build. Keys are the defaults;
the in-game manual shows your own bindings.

## Contents

1. [Goal](#goal)
2. [Controls](#controls)
3. [Move, Fire, Focus, Dash, Special](#move-fire-focus-dash-special)
4. [Link Beam](#link-beam)
5. [Combos & Sync Kills](#combos-sync-kills)
6. [Bits & the Patch Bay](#bits-the-patch-bay)
7. [Powerups: Systems (Patch Bay)](#powerups-systems-patch-bay)
8. [Powerups: Patch Cards (Common, Uncommon)](#powerups-patch-cards-common-uncommon)
9. [Powerups: Patch Cards (Rare, Legendary, Mythic)](#powerups-patch-cards-rare-legendary-mythic)
10. [Powerups: Team & Utility](#powerups-team-utility)
11. [Downed, Revive & Spare Kernels](#downed-revive-spare-kernels)
12. [Enemies](#enemies)
13. [Bosses](#bosses)
14. [Sectors & OVERFLOW](#sectors-overflow)
15. [Firmware & Cores](#firmware-cores)
16. [VERSUS Mode](#versus-mode)
17. [Difficulty](#difficulty)
18. [Themes](#themes)
19. [Tips](#tips)

## Goal

You are antivirus daemons inside a crashing server. Corrupted processes pour out of portals around the arena: destroy them, survive every cycle and keep the kernel alive.

|                    |                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| **The run**        | 3 sectors × 5 cycles = 15 cycles. The last cycle of every sector is a boss.                                   |
| **Between cycles** | Spend the Bits you collected in the Patch Bay on upgrades that last for the rest of the run.                  |
| **Winning**        | Beat the final boss, then choose EXTRACT (bank the victory) or PUSH DEEPER into endless OVERFLOW waves.       |
| **Losing**         | The run ends when every player is down and no Spare Kernels are left. You still earn Cores for your progress. |
| **Modes**          | SOLO, CO-OP (two players, one keyboard) and VERSUS (a best-of-five duel).                                     |

Every run pays Cores for permanent Firmware upgrades, so each attempt makes the next one easier.

## Controls

These are your current key bindings. Change them in CONTROLS (main menu or pause).

|                  |                                                      |
| ---------------- | ---------------------------------------------------- |
| **Move**         | P1: W A S D · P2: ↑ ← ↓ →                            |
| **Fire / Focus** | P1: SPACE or F · P2: PERIOD (.) or NUM 0             |
| **Dash**         | P1: L-SHIFT or Q · P2: SLASH (/) or R-SHIFT or NUM . |
| **Special**      | P1: E or R · P2: COMMA (,) or NUM ENTER              |
| **Pause**        | ESC or P                                             |

### Menus

|              |                                           |
| ------------ | ----------------------------------------- |
| **Navigate** | Either player’s move keys                 |
| **Confirm**  | ENTER or NUM ENTER or a player’s Fire key |
| **Back**     | BKSP or ESC or a player’s Dash key        |
| **Mouse**    | Click any menu item, shop row or button   |

### Patch Bay and character select

Each player moves their own cursor with their own keys: Fire buys or confirms, Dash undoes the last purchase, Special toggles READY. Player 2 joins at character select by pressing their Fire key.

|          |                                                                          |
| -------- | ------------------------------------------------------------------------ |
| **Solo** | Both key sets control Player 1, so use whichever hand position you like. |

## Move, Fire, Focus, Dash, Special

|             |                                                                                                                                                                                        |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Move**    | Steer with your move keys. Your craft has a little inertia, so start turning early.                                                                                                    |
| **Fire**    | Autofire is ON by default: your craft shoots where it faces and aim assist snaps to the nearest enemy in front of you. Turn autofire off per player in SETTINGS to hold Fire to shoot. |
| **Focus**   | Hold Fire to focus: your facing locks (strafe!), spread tightens by 60%, damage rises by 15%, but you move 30% slower.                                                                 |
| **Dash**    | A quick 7 u burst with 0.2 s of invulnerability: dash THROUGH bullets and enemies. Recharges in 1.4 s. It also shakes off latched Leeches.                                             |
| **Special** | Fills from damage you deal and +3 per kill (the OVR bar). Press Special when it is full.                                                                                               |

### Specials by craft

|                          |                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| **LANCER: RAILBURST**    | A 40 u piercing rail beam for 400 damage.                                                    |
| **BULWARK: FIREWALL**    | A 4.5 u bubble for 3.5 s that deletes enemy bullets. Bulwark’s dash also rams for 40 damage. |
| **SPECTER: BLINK SWARM** | Teleport 8 u and leave 6 seeking mines (45 damage each).                                     |
| **TINKER: PATCH DRONE**  | A drone that heals 8 HP/s within 6 u for 6 s and shoots nearby enemies.                      |

Special Tuning (Patch Bay) raises the tier: each tier adds 25% radius, duration and damage.

## Link Beam

In CO-OP, a beam joins the two craft whenever both are alive and between 4 and 14 u apart.

|                      |                                                                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Damage**           | The beam deals 22 damage per second to every enemy it crosses.                                                                            |
| **Shared kills**     | Beam kills count for both players’ combos.                                                                                                |
| **Positioning**      | Stay a medium distance apart and sweep the beam through crowds: circle around each other, or let one player kite while the other anchors. |
| **Solo: Echo Drone** | Playing alone, an Echo Drone orbits you at 6 u and forms the beam with you at 60% damage.                                                 |
| **Leeches**          | Leech enemies latch onto the beam and cut it. Kill them or dash through them.                                                             |
| **Upgrades**         | The team row sells Link Amplifier (more beam damage) and Link Range (longer beam).                                                        |

The beam is disabled in VERSUS.

## Combos & Sync Kills

Each kill within 2 s of your previous kill extends your combo chain (the bar under your HUD panel shows the time left).

### Combo tiers

|                 |                                             |
| --------------- | ------------------------------------------- |
| **10 kills**    | Score ×1.5, +10% Bits                       |
| **25 kills**    | Score ×2, +20% Bits                         |
| **50 kills**    | Score ×3, +30% Bits                         |
| **100 kills**   | Score ×4, +40% Bits                         |
| **Getting hit** | Taking damage keeps only 50% of your chain. |

### Sync kills

In CO-OP, when both players score a kill within 0.4 s of each other, each gets +2 Bits and +3 special charge. The HUD flashes SYNC KILL.

## Bits & the Patch Bay

|                 |                                                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Bits**        | Enemies drop Bits pickups. Your magnet (3.5 u to start) pulls them in; uncollected ones blink and vanish after 12 s. Each player has their own wallet. |
| **Catch-up**    | A player whose wallet is below 60% of their partner’s gets +20% from pickups.                                                                          |
| **Cycle clear** | Clearing a cycle vacuums every pickup to the nearest player and pays a clear bonus that grows each cycle.                                              |

### The Patch Bay

After every cycle the Patch Bay opens with one panel per player. Every row shows what it does, and upgrades show what the next level adds. The INSTALLED list shows what you own.

|                   |                                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------- |
| **Systems**       | Eight stat rows you can level up at any visit; prices rise per level and per cycle.                        |
| **Repair**        | Heal part of your max HP.                                                                                  |
| **Patch cards**   | Three random cards per visit with special effects. Rarer cards appear in later sectors.                    |
| **Lock**          | Keep one card for your next visit at the same price (move right on a card row).                            |
| **Team row**      | Shared items either player can pay for: Spare Kernels, Link Amplifier, Link Range, Revive Protocol.        |
| **Reroll / Gift** | Draw new cards; send Bits to your partner.                                                                 |
| **Keys**          | Fire buys, Dash undoes (full refund), Special toggles READY. The next cycle starts when everyone is READY. |

The next pages list every powerup.

## Powerups: Systems (Patch Bay)

Stat rows are always on sale. Each level adds the listed amount; prices rise with level and cycle.

|                    |                                                                |
| ------------------ | -------------------------------------------------------------- |
| **Thrusters**      | +7% move speed per level (6 levels)                            |
| **Plating**        | +20 max HP per level (heals you by the same amount) (8 levels) |
| **Overclock**      | +12% fire rate per level (8 levels)                            |
| **Payload**        | +15% damage per level (8 levels)                               |
| **Magnet**         | +25% pickup radius per level (5 levels)                        |
| **Coolant**        | -12% dash cooldown per level (5 levels)                        |
| **Capacitor**      | +20% special charge rate per level (5 levels)                  |
| **Special Tuning** | +25% special radius, duration and damage per level (2 levels)  |
| **Repair**         | Heal 35% of your max HP (up to 2 per visit)                    |

## Powerups: Patch Cards (Common, Uncommon)

### Common

|                       |                                                            |
| --------------------- | ---------------------------------------------------------- |
| **Split Shot**        | Fire 2 extra side bullets at ±12° (-15% damage); stacks ×2 |
| **Overdrive Battery** | +25% special charge rate; stacks ×3                        |
| **Bounty**            | +20% Bits from pickups; stacks ×2                          |
| **Shard Cache**       | Instantly gain 25 Bits (free)                              |

### Uncommon

|                   |                                                           |
| ----------------- | --------------------------------------------------------- |
| **Pierce**        | +1 pierce: shots pass through one more enemy; stacks ×3   |
| **Afterimage**    | Your dash leaves a damaging trail for 1.5 s (30 damage/s) |
| **Double Buffer** | +1 dash charge                                            |
| **Vampire Code**  | Heal 1 HP for every 12 kills; stacks ×2                   |
| **Overheat**      | +40% fire rate while you are below 30% HP                 |

Unique cards can be owned once; the others stack up to the listed count.

## Powerups: Patch Cards (Rare, Legendary, Mythic)

### Rare

|                    |                                                                  |
| ------------------ | ---------------------------------------------------------------- |
| **Ricochet**       | +1 wall bounce: shots bounce off the arena wall; stacks ×2       |
| **Chain Arc**      | 15% of hits arc to 3 nearby enemies for 50% damage               |
| **Micro-Missiles** | Launch 2 homing missiles every 1.2 s (20 damage each); stacks ×2 |
| **Nanoshield**     | A shield blocks one hit, then recharges for 12 s                 |
| **Orbitals**       | 2 blades orbit your craft, dealing 18 damage/s on contact        |
| **Glass Lens**     | +35% damage, -20% max HP                                         |

### Legendary

|                 |                                                 |
| --------------- | ----------------------------------------------- |
| **FORK()**      | Every 5th volley fires twice                    |
| **SUDO**        | Your special fires 2 times per use              |
| **ROOT ACCESS** | Combo tier +1 permanently (more score and Bits) |

### MYTHIC (super rare)

|                      |                                                                                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ROOT OF ALL EVIL** | MYTHIC: +100% fire rate, +50% damage, +4 pierce; every hit chains to 3 enemies (60% damage); a 3.2 u purge field deletes enemy bullets and burns enemies (60 damage/s) |

Legendary cards appear only after you buy the Legendary Pool Firmware.

MYTHIC: from sector 2 on, every fresh card slot has a 0.5% chance to hold the one Mythic card instead (no Firmware needed). It glows gold in the Patch Bay; grab it if you can afford it.

## Powerups: Team & Utility

Team items are shared: either player can pay from their own wallet and both benefit. Hidden in VERSUS.

|                     |                                                                               |
| ------------------- | ----------------------------------------------------------------------------- |
| **Spare Kernel**    | Extra team life, spent automatically to reboot a lost player (hold up to 3)   |
| **Link Amplifier**  | +40% link beam damage per level for both players (3 levels)                   |
| **Link Range**      | +4 u max link length per level (base 14 u) (2 levels)                         |
| **Revive Protocol** | Revives take 1.2 s instead of 2 s and restore 60% HP instead of 40% (1 level) |

### Utility

|            |                                                                         |
| ---------- | ----------------------------------------------------------------------- |
| **Reroll** | Draw 3 new patch cards (a locked card stays); the price rises each time |
| **Lock**   | Lock keeps 1 card for your next visit at today's price                  |
| **Gift**   | Give 10 Bits to your partner (Undo refunds it); CO-OP only              |
| **Undo**   | Dash undoes your last purchase this visit for a full refund             |

## Downed, Revive & Spare Kernels

|                      |                                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Downed**           | At 0 HP you are DOWNED: you can crawl slowly and a bleed-out timer starts (12 s, shorter each time you go down in the same cycle).                                       |
| **Revive**           | Your partner revives you by staying within 2.5 u of you for 2 s. You come back with 40% HP and brief invulnerability. Progress slowly decays if they step away.          |
| **Spare Kernels**    | If you bleed out, or everyone is down, a Spare Kernel is spent automatically to reboot a player. The team starts with 1 and can hold 3; buy more in the team row.        |
| **Offline ghost**    | Bled out with no Spare Kernels left? You become an OFFLINE ghost: you still fly around, collect Bits at 50% and touching enemies MARKS them (+20% damage taken for 4 s). |
| **Cycle-end reboot** | When the cycle is cleared, downed players return at 40% HP and offline players at 30% HP.                                                                                |
| **Game over**        | The run ends only when nobody is left standing and no Spare Kernels remain.                                                                                              |

## Enemies

Enemies arrive in formations at the portals farthest from you, each announced by a warning ring. New kinds unlock as the cycles go on.

|                       |                                                                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **SHARD (Cycle 1+)**  | Swarms straight at you. Weak alone, dangerous in packs: sweep them with shots or the Link Beam.                                           |
| **DART (Cycle 2+)**   | Stops, shows a line for 0.6 s, then lunges along it. Sidestep the line or dash through it.                                                |
| **FORK (Cycle 3+)**   | Splits into 2 SHARDs when destroyed. Kill it at range so the pieces do not land on you.                                                   |
| **SPIKER (Cycle 4+)** | Keeps its distance and, after a warning pulse, fires a ring of 10 bullets every 3.8 s. Slip through the gaps and close in between bursts. |
| **WARDEN (Cycle 6+)** | A 100° front shield blocks your shots and it fires 3-shot volleys. It turns slowly: flank it or hit it from behind.                       |
| **LEECH (Cycle 7+)**  | Fast; latches onto the Link Beam and cuts it. Kill it or dash through it to restore the beam.                                             |
| **CORRUPTED elites**  | From Sector 2, some enemies glitch: ×2.5 HP and ×3 Bits.                                                                                  |

Enemy bullets are always hot orange: anything orange hurts.

## Bosses

A boss ends every sector. Its HP bar is at the top of the screen. Bosses have ×1.6 HP with two players and ENRAGE after 150 s (attacks ×1.5 faster).

|                               |                                                                                                                                                                  |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **FORK BOMB (Cycle 5)**       | 1600 HP. Splits into 2 at 66% HP and into 4 at 33%. Focus one piece at a time and keep moving around the edge.                                                   |
| **RACE CONDITION (Cycle 10)** | Twin processes of 2100 HP each. Both must die within 3 s of each other (6 s solo) or the dead one respawns at 50% HP. Bring both low, then finish them together. |
| **THE KERNEL (Cycle 15)**     | 5600 HP in three phases: rotating firewall segments, bullet spirals, then a desperation phase that summons enemies. Save your special for the last phase.        |

Bosses drop a big pile of Bits. In OVERFLOW they return every 5 cycles.

## Sectors & OVERFLOW

|                           |                                                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Sectors**               | 3 sectors of 5 cycles. Each sector changes the arena colours, adds tougher enemies and ends with a boss.              |
| **Cycle timer**           | A cycle lasts 40 s, growing 3 s per cycle (max 70 s). Enemy HP grows 5% per cycle.                                    |
| **PURGE**                 | When the timer runs out, the survivors de-rez and pay 50% of their Bits: no reason to stall.                          |
| **Clear**                 | Bullets vanish, time slows, pickups fly to you, downed players reboot and the Patch Bay opens.                        |
| **EXTRACT / PUSH DEEPER** | After Cycle 15 the last Patch Bay visit asks: EXTRACT ends the run as a victory; PUSH DEEPER continues into OVERFLOW. |
| **OVERFLOW**              | Endless cycles: enemy HP +12% per cycle and a boss every 5th cycle. Your victory is already banked.                   |

## Firmware & Cores

Every run ends at the results screen, which pays Cores: 1 per 10 Bits earned, +3 per cycle cleared, +15 per boss, +40 for a victory (max 400 per run). Abandoning still pays for progress.

Cores are earned at the end of every run, even a loss. Spend them in Firmware (main menu) on permanent upgrades: every one applies automatically to every future run, and shows under INSTALLED (tagged FIRMWARE) in the Patch Bay, the HUD and the pause menu.

### Firmware: SURVIVAL

|                 |                                                                |
| --------------- | -------------------------------------------------------------- |
| **Hull FW**     | +5% max HP, -5% revive time per level, every run (5 levels)    |
| **Second Boot** | Start every run with +1 Spare Kernel (an extra life) (1 level) |

### Firmware: FIREPOWER

|                  |                                                     |
| ---------------- | --------------------------------------------------- |
| **Overclock FW** | +3% fire rate per level, every run (5 levels)       |
| **Pre-Charge**   | Your special starts every run 50% charged (1 level) |

### Firmware: ECONOMY

|                    |                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| **Boot Cache**     | Start every run with +25 Bits and +8% pickup radius per level; levels 2 and 4 add a free Patch Bay reroll each visit (4 levels) |
| **Legendary Pool** | Legendary patch cards (FORK(), SUDO, ROOT ACCESS) can appear in the Patch Bay (1 level)                                         |

### Craft

|                   |                                                                                |
| ----------------- | ------------------------------------------------------------------------------ |
| **Craft unlocks** | SPECTER 60 Cores, TINKER 90 Cores. RESPEC refunds all Firmware (unlocks stay). |

There is also a TERMINAL on the main menu. Rumour says typing the right words into it does strange things...

## VERSUS Mode

Once Player 2 joins, set the MODE row at character select to VERSUS. First to 3 round wins takes the match.

|                |                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Rounds**     | Up to 90 s. Knock your rival down to win the round; there is no revive.                                          |
| **Timeout**    | The player with the higher HP fraction wins. An exact tie starts SUDDEN DEATH: both drop to 1 HP for up to 20 s. |
| **PvP damage** | Your shots hit your rival for 45% damage; damaging specials for 25%. Dash i-frames work against shots too.       |
| **Hazards**    | Weaker enemy waves roam the arena and chase the nearest player. No bosses.                                       |
| **Shop**       | The Patch Bay opens between rounds (no team row, no gift). Winner +40, loser +60 Bits (catch-up), draw +40 each. |
| **Disabled**   | Link Beam, revive, Spare Kernels, Offline ghost and sync kills.                                                  |
| **Cores**      | 5 per round won (either player) + 10 for a decided match, up to 60 per match.                                    |

## Difficulty

Pick a difficulty in SETTINGS before a run (character select shows the current one). It changes how hard the arena hits, never the rules.

|            |                                                                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **CASUAL** | Enemy speed -20%, enemy count -30%, damage to you -40%, enemy HP -20%. Best for learning the game or relaxed co-op.                       |
| **NORMAL** | The intended balance (the default).                                                                                                       |
| **HARD**   | Enemy speed +35%, enemy count +75%, damage to you +75%, enemy HP +25%. Close to the original release; for players who know every pattern. |

The difficulty in effect when a run starts stays for the whole run. Cores rewards are the same on every difficulty.

## Themes

Three themes change the look, music and names, never the rules: every craft, enemy, card and number is the same. Pick one in SETTINGS > THEME, then choose RESTART TO APPLY (the game reloads; progress is kept).

|                   |                                                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **KERNEL PANIC**  | Neon circuit grid inside a crashing server; dark synthwave. Currencies: Bits and Cores.                                       |
| **ABYSSAL LIGHT** | Caustic-lit seabed in a lightless trench, dense dark water; slow, tense drones and sonar pings. Currencies: Lumen and Pearls. |
| **EMBERFALL**     | Cracked lava crust under a dying red giant, heat shimmer; hard industrial percussion. Currencies: Scrap and Alloy.            |

## Tips

|                             |                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------- |
| **Keep moving**             | Most damage comes from standing still. Circle the arena and leave yourself an exit.   |
| **Dash through, not away**  | Dashing through a bullet wall or a Dart lunge is safer than running from it.          |
| **Watch the rings**         | Every spawn shows a warning ring at a portal about a second ahead.                    |
| **Flank Wardens**           | Their front shield blocks shots: get behind or beside them.                           |
| **Pop Forks away from you** | They split into small, fast Shards.                                                   |
| **Use the beam**            | In CO-OP the Link Beam shreds crowds; keep your partner at medium range.              |
| **Buy early damage**        | Payload, Overclock and a good card in the first visits make every later cycle easier. |
| **Save a revive**           | Keep a Spare Kernel for the boss cycles.                                              |
| **Laptop keyboards**        | If a key drops out when both players hold keys, run CONTROLS > KEY TEST and rebind.   |
| **Stuck?**                  | Spend Cores on Firmware between runs; every run pays out.                             |

## SPOILERS: Terminal cheat codes

<details>
<summary>Click to reveal the codes (spoilers!)</summary>

Open **TERMINAL** on the main menu and type a code, then Enter (case does not matter; Escape closes). A right code unlocks the cheat for good and switches it on for your next runs; switch cheats on/off in the terminal (Up/Down + Enter, or click) or in the FIRMWARE hangar. Type `OFF` to switch all off. **Cheat runs pay no Cores and never count for records or the leaderboard.** Cheats never apply in VERSUS.

| Code          | Cheat        | Effect                                           |
| ------------- | ------------ | ------------------------------------------------ |
| `IDDQD`       | GOD MODE     | Enemies, bullets and bosses cannot hurt you      |
| `GLASSCANNON` | GLASS CANNON | 1 max HP, x5 damage                              |
| `BITRAIN`     | BIT RAIN     | +500 starting Bits, x2.5 Bit pickups             |
| `TURBO`       | TURBO        | x2 move speed, fire rate and bullet speed        |
| `BULLETSTORM` | BULLET STORM | +4 bullets per shot in a wide fan                |
| `BLINKBLINK`  | BLINK BLINK  | +3 dash charges, dash cooldown -60%              |
| `FULLCHARGE`  | FULL CHARGE  | Special starts full and charges x3 faster        |
| `SUDORMRF`    | SUDO RM -RF  | Start every run with the Mythic ROOT OF ALL EVIL |

</details>

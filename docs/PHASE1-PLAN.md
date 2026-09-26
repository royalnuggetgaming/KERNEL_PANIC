# KERNEL PANIC — Phase 1 Plan (for approval)

Codename **LINKLINE**. 1–2 player couch co-op 3D neon arena shooter. Vite + Three.js 0.186 + strict TypeScript. No code has been written yet.

## Approved decisions (2026-09-26) — these override anything below

1. **Architecture approved** as written in this document, with the changes in this list.
2. **Theme: KERNEL PANIC only for v1.** Keep the theme system (`ThemeDef`, `themes/registry.ts`, theme uniforms) so more themes can be added later as data. Do **not** create `src/themes/abyssalLight.ts` or `src/themes/emberfall.ts`, and skip their shader floor modes (caustics, lava) and extra geometry families. Section 2 keeps their design only as future follow-ups.
3. **Modes: co-op AND a competitive VERSUS mode.** This plan does not yet design versus. Wave 0 must write a versus addendum into `docs/ARCHITECTURE.md` before freezing contracts, covering at least:
   - the ruleset: PvP damage, round structure and win condition;
   - what happens to the Link Beam, revive, Offline ghost and the shared team row (disabled or repurposed);
   - how the shop, Cores/rewards and the adaptive camera work in versus;
   - a mode picker in CharacterSelect;
   - the new files and tests (for example `config/versus.ts`, `sim/versusRules.ts`, `tests/sim/versusRules.test.ts`).
   The contracts must include the mode from Wave 0 (for example `RunMode = 'solo' | 'coop' | 'versus'`).
4. **No CI file.** Drop `.github/workflows/ci.yml`. The user's push token probably lacks GitHub's Workflows permission. `npm run verify` is the gate.
5. **Toolchain:** Node 24 LTS (installed on the user's Mac at `~/.local/node`; the cloud environment uses its own Node >= 22.12, ideally 24). TypeScript **6.0.3** is the gating compiler, because typescript-eslint 8.70.1 declares the peer range `>=4.8.4 <6.1.0` (checked against npm). TypeScript 7.0.2 runs only as a non-gating check.
6. **Git:** work on `feat/game`. When everything passes, merge into `main` and push to `origin`. The user's Phase 4 authorizes this push. Never force-push. Commits end with the Co-Authored-By trailer.
7. **Orchestration:** the user explicitly asked for specialized sub-agents per module and a critic loop. Use the Workflow tool for the waves in section 12. `/loop` is a timer, not a build tool.
8. **Guardrail:** after 5 unresolved attempts on the same (file, error signature), stop autonomous work, log the exact error, what was tried and the file, and ask the user.
9. **Performance verification:** the 60/120 FPS targets are for the user's M3 Pro MacBook Pro (DPR 2, ProMotion). A cloud container has no real GPU. Gate on the CPU-side budgets, draw-call and program counts, zero steady-state allocation and headless tests; treat software-rendered FPS as non-gating. The final on-device FPS check happens on the user's Mac.
10. **Budget:** the user has a $100 usage credit for the cloud session and set no token ceiling.


## 1. Core gameplay loop

### Pitch

LINKLINE (codename; the title shown in game comes from the chosen theme, default KERNEL PANIC) is a 1-2 player couch co-op neon arena shooter for one laptop keyboard.
- Two hover-craft auto-fire into waves of procedural enemies across 3 sectors: 4 combat waves plus 1 boss each, 15 waves, about 18 minutes, then an optional endless OVERFLOW.
- Players stretch a damaging LINK BEAM between their craft, chain kills into combo tiers, and revive each other under fire.
- After every wave they spend per-player Shards in a side-by-side shop: stat rows, rarity patch cards, and a shared team row.
- At the end of a run they bank Cores into permanent Firmware upgrades and unlocks.
- Every mesh, texture, shader and sound is generated in code.

### Moment to moment

Every 1-3 s, each player does the following.

(1) MOVE. 8-way, screen-relative movement with inertia: accel 80 u/s^2, decel 100 u/s^2, top speed from vehicle stats. SOCD is 'last pressed wins' per axis, and diagonals are normalised.

(2) AUTO-FIRE (default on, per player). Shots go along facing. A 20 deg aim-assist cone within 24 u snaps to the nearest enemy. Facing turns toward the move direction at 720 deg/s.
- Holding FIRE/FOCUS locks facing so the player can strafe, tightens spread by 60%, adds +15% damage and slows movement by 30%.
- With autofire off in Settings, FIRE becomes hold-to-shoot.

(3) DASH (tap). 0.16 s burst covering 7 u, 0.2 s of i-frames, 1.4 s base cooldown. It passes through bullets and sheds latched Leeches. Bulwark's dash is a ram dealing 40 damage.

(4) SPECIAL (tap). Spends a 0-100 Overdrive meter filled by damage dealt plus 3 per kill, typically full every 25-35 s.

(5) COLLECT. Enemies drop physical Shard pickups (value 1/5/25). A magnet radius (base 3.5 u) pulls them in. Uncollected Shards blink at 9 s and vanish at 12 s.

(6) COMBO. A kill within 2.0 s of the previous one extends the chain.
- Tiers at 10/25/50/100 kills give score x1.5/x2/x3/x4 and Shards +10/20/30/40%.
- Taking a hit halves the chain.

(7) LINK BEAM. When 2 living players are 4-14 u apart, a beam joins them. It deals 22 DPS to every enemy it crosses (upgradeable), and beam kills count for both players' combos.
- In solo, the beam runs from the ship to an ECHO DRONE orbiting at 6 u, at 60% damage.
- Leech enemies latch onto the beam and cut it until dashed off or killed.

(8) SYNC KILL. When both players kill within 0.4 s of each other, each gets +2 Shards and +3 Overdrive.

(9) READ TELEGRAPHS. Every spawn gets a 0.8 s ground warning ring at a portal. Dart lunges show a line telegraph, Spiker bullet rings a pulse, and boss attacks their own decals.

Readability: enemy bullets are always hot orange/red, P1 is cyan and P2 is magenta, and a colourblind palette option changes P2 to orange.

### Run structure

RUN SHAPE
- MainMenu > PLAY > CharacterSelect. P1 is auto-joined; P2 drops in by pressing their Fire key. Each player picks a vehicle and presses Special to Ready.
- Playing starts wave 1 after a 3 s countdown with the players invulnerable.
- 3 sectors x 5 waves = 15 waves: waves 1-4 of each sector are combat, wave 5 is a boss. Global wave index is w = 1..15.

COMBAT WAVES
- Duration: 40 s + 3 s x (w-1), capped at 70 s.
- When the timer ends, PURGE runs: surviving non-boss enemies de-rez over 1.5 s and pay 50% of their Shards, so stalling is pointless.
- WaveDirector threat budget: round(30 + 14w + 1.8w^2), x1.5 in 2P. That is 46 at w1 and 516 at w15.
- Budget is spent in pulses every 3.8 s (3.5 s in S2, 3.2 s in S3). Each pulse is a formation (ring, line, pincer or cluster) arriving at the 3 of 8 edge portals farthest from the players.
- At most 180 enemies alive; excess spawns are deferred.
- Enemy HP x1.07^(w-1), and x1.2 in 2P. Scaling is fixed at wave start and never recomputed mid-wave.

ENEMIES (cost / unlock wave)
- Shard 1 / w1
- Dart 2 / w2
- Fork 4 / w3 (splits into 2 Shards)
- Spiker 6 / w4
- Warden 7 / w6 (100 deg front shield, rewards flanking)
- Leech 4 / w7
- CORRUPTED elites from sector 2: 6% chance +2% per sector, 2.5x HP, x3 drops, glitch shader.

BOSSES (2P HP x1.6; enrage at 150 s)
- w5 FORK BOMB: 2400 HP; splits 1->2->4 at 66% and 33% HP.
- w10 RACE CONDITION: twin bosses of 2600 HP each. Both must die within 3 s of each other (6 s in solo) or the dead one respawns at 50%.
- w15 THE KERNEL: 7000 HP, 3 phases: rotating firewall segments, bullet spirals, then a desperation phase that summons adds.
- Boss attacks are data-driven compositions of shared primitives: ring, spiral, aimed volley, sweep beam, charge, summon.

WAVE CLEAR OUTRO (2.0 s)
- Enemy bullets are wiped and players are invulnerable.
- 0.6 s of 0.35x slow-mo is applied through the accumulator time scale, so the sim stays deterministic.
- All pickups are vacuumed to the nearest living player, so no currency is lost.
- Wave-end reboot: Downed players revive at 40% HP and Offline players at 30%.
- Clear bonus: 15 + 5w Shards to each player (Offline players get 50%).
- Then the UpgradesShop{midrun} is pushed.

AFTER WAVE 15
The shop offers EXTRACT (GameOver victory) or PUSH DEEPER into OVERFLOW (endless): +12% enemy HP per wave, and a boss every 5th wave cycling through the 3 bosses.

RUN END
TEAM WIPE (defeat), EXTRACT (victory), or ABANDON from Pause (abandoned). Every ending goes through GameOver, the only place persistent rewards are committed.

### Economy and shop

TWO CURRENCIES. Code names are shards and cores; the theme supplies display names (for example Bits and Cores in KERNEL PANIC).

1) SHARDS: run-only, integer, one wallet per player, clamped to [0, 9,999,999].
- Drops: Shard 1, Dart 2, Fork 3, Spiker 4, Warden 5, Leech 3; elite x3; boss 60 in denominations.
- The player who collects a pickup gets its full value.
- Combo tiers add +10-40%.
- Catch-up: when a player's wallet is below 60% of the partner's at pickup time, that pickup gets +20%.
- Wave-clear bonus: 15 + 5w to each player.
- Design target: 2-3 meaningful purchases per visit, never 'buy everything'. This is enforced by the economy Monte Carlo test.

2) CORES: persistent, one shared local profile.
- Awarded once at GameOver: floor(shardsEarnedTotal/10) + 3 x wavesCleared + 15 x bossesKilled + 40 if victory was ever achieved.
- Capped at 400 per run.
- Abandoning pays the same progress-based formula, so quitting is never worse than dying.
- Guarded by runId, so they are never awarded twice.

MID-RUN SHOP (UpgradesShop{midrun})
- Pushed after every wave: 14 visits plus the final EXTRACT/PUSH DEEPER visit.
- Two side-by-side panels, each driven only by its owner's keys at the same time.
- Each panel has:
  - (a) STAT ROWS, always available: Thrusters, Plating, Overclock, Payload, Magnet, Coolant, Capacitor, Special Tuning.
  - (b) REPAIR, a consumable.
  - (c) 3 seeded PATCH CARDS for that player. Rarity weights move from C60/U28/R10/L2 in S1 to C40/U32/R20/L8 in S3; Legendaries need the Legendary Pool firmware.
  - (d) TEAM ROW that either player can fund from their own wallet: Spare Kernel, Link Amplifier, Link Range, Revive Protocol.
  - (e) Utility rows: Reroll (escalating price; free Firmware rerolls are used first), Lock (one card carries to the next visit at its original price), and Gift 10 Shards to the partner (co-op only).
- Keys:
  - Fire buys, and only on a fresh press after a 350 ms open guard.
  - Dash undoes the last purchase (LIFO within this visit, exact refund).
  - Special toggles READY.
  - The next wave starts only when every joined player is Ready. A 1.5 s countdown can be cancelled by un-readying.
- There is no shop timer (couch game).

PERSISTENT FIRMWARE (UpgradesShop{meta}, the Hangar)
- Reached from MainMenu, with one shared panel.
- Offers meta upgrades, vehicle unlocks, the Legendary Pool and Respec (refunds the recorded amounts spent; unlocks are not refundable).
- Meta effects are copied into the run as a snapshot at run start. Firmware at max adds only about +15% power; most power comes from mid-run builds.

### Two-player dynamics

MODE AND RESOURCES
- Co-op against the game. There is no friendly fire, and craft softly push each other apart.
- Split wallets and per-player builds (for example glass-cannon Specter next to tank Bulwark), plus a shared team row and shared team Spare Kernels.
- The catch-up bonus and gifting keep split wallets friendly.
- The Link Beam, Race Condition's twin-kill window, Warden front shields (flanking) and Tinker's heal drone make positioning a two-person dance.

REVIVE RULES
- DOWNED at 0 HP: the craft becomes a flickering core that can crawl at 25% speed. Enemies stop targeting it. Bleed-out is 12 s.
- Every further down in the same wave cuts bleed-out by 2 s, to a minimum of 6 s.
- The partner revives by staying within 2.5 u for 2.0 s cumulative. Progress decays at 50%/s while away, and the reviver can keep shooting.
- A revived player returns at 40% HP with 2 s of invulnerability.

SPARE KERNELS AND OFFLINE
- When bleed-out expires, a team Spare Kernel is spent automatically if one is held: the player respawns beside the partner after 1.5 s at 60% HP with 2 s of invulnerability.
- Otherwise the player goes OFFLINE: a translucent ghost wisp, clamped inside the camera view, that cannot shoot or die.
  - It pulls Shards into its own wallet at 50% value.
  - It MARKS enemies by touching them (+20% damage taken for 4 s).
  - It reboots at 30% HP at wave end, so nobody sits out.

NO LIVING PLAYER
- If a Spare Kernel is held, one is spent immediately on the player downed longest.
- Otherwise TEAM WIPE and GameOver follow after a 1.0 s grace.
- When the last enemy and the last player go down on the same tick, the wave-clear check runs first and the wave counts as cleared.

KERNEL STOCK
Every run starts with 1 Spare Kernel (+1 with the Second Boot firmware), and the team holds at most 3.

SOLO
- Chosen by not joining P2.
- Both the P1 and P2 binding sets drive P1, so either hand layout works.
- The Echo Drone carries the Link Beam, and Leeches latch onto it.
- Downed in solo means a kernel is spent (1.5 s respawn), otherwise GameOver.
- Race Condition's window is 6 s. Threat budget x1.0 and HP x1.0. Gift is hidden.

FRIENDLY COMPETITION
Per-player score, kills, damage, revives and Shards appear on the HUD and the GameOver MVP card.

## 2. Themes

### KERNEL PANIC (recommended default)

Inside a crashing server, two antivirus daemons skim a glowing circuit-grid arena and purge corrupted processes before the kernel panics.

The whole UI speaks the fiction:
- waves are process cycles
- the shop is the Patch Bay
- lives are Spare Kernels
- the meta shop is Firmware
- the currencies are Bits and Cores

**Vehicles**

Hover-sleds, all mechanics shared across themes.
- LANCER (balanced): 100 HP, 12 u/s, twin blaster 9 shots/s x 10 dmg. Special RAILBURST: a 0.25 s piercing rail 40 u long, 400 dmg.
- BULWARK (heavy): 150 HP, 10 u/s, 3-pellet spread 3.5 volleys/s x 9 dmg, 20% contact damage reduction, ram dash 40 dmg. Special FIREWALL: a dome of radius 4.5 for 3.5 s that deletes enemy bullets and also covers the partner.
- SPECTER (glass cannon, unlock 60 Cores): 75 HP, 14 u/s, needle gun 14/s x 5 dmg with pierce 1, 2 dash charges. Special BLINK SWARM: teleport 8 u and leave 6 seeker mines of 45 dmg each.
- TINKER (support, unlock 90 Cores): 110 HP, 11 u/s, arc pistol 6/s x 12 dmg chaining to 1 more enemy. Special PATCH DRONE: for 6 s, heals 8 HP/s within 6 u, including the partner, and runs an auto-turret.

Hull tint comes from a uniform: P1 cyan #19E6FF, P2 magenta #FF3FD0 (orange #FF9A1F in the colourblind palette).

**Enemies**

Glitch processes made of Platonic solids.
- SHARD: tetrahedron chaser.
- DART: stretched octahedron; telegraphs a lunge.
- FORK: cube that splits.
- SPIKER: dodecahedron that fires radial rings.
- WARDEN: icosahedron with a front shield.
- LEECH: torus that latches onto the beam.
- CORRUPTED variants use RGB-split glitch dissolve.
- Bosses: FORK BOMB (subdivided cube cluster), RACE CONDITION (twin counter-rotating torus-knot cores), THE KERNEL (nested rotating ring lattice with firewall segments).

**Procedural visuals**

FLOOR
- A single plane with an fwidth-antialiased circuit grid and hex overlay (FLOOR_MODE_GRID).
- Data-flow pulses along the grid lines are sampled from a 256^2 noise DataTexture.
- Two player light pools come in through uniforms, and 8 shockwave ripples through a vec4[8] uniform ring.
- A beat pulse is driven by the audio clock.

SKY
An inverted sphere with a 3-octave FBM nebula, hashed-cell stars and a falling hex-glyph rain.

SURFACES
- One neonSurface shader for all hulls, enemies and bosses: barycentric edge glow, fresnel rim, vertex-colour albedo, a per-vertex emissive mask, noise-threshold spawn and death dissolve, and hit flash.
- A fixed-direction key light is baked into the shader, so there are no dynamic lights.

OTHER EFFECTS
- Projectiles: capsule SDF quads.
- Particles: an analytic GPU ring buffer.
- Arena wall: a hex force field.
- Title: a voxel logo from an in-code 5x7 bitmap font.
- Post: HDR custom dual-Kawase bloom plus a composite pass (ACES, vignette, damage chromatic aberration, scanlines, grain).

**Audio**

Dark synthwave at 112 BPM in A minor/Dorian, using an i-VI-III-VII progression.

Layers, cross-faded by intensity:
- a sidechain-ducked detuned 3-saw pad
- an octave-pulse sub bass
- a gated FM arpeggio
- 808-style kick, noise hats and snare
- a square lead above 0.7 intensity

Music changes by state and sector:
- Boss waves move up a key and add distorted bass.
- The shop plays a low-passed lounge variant of the same progression.
- Sector keys are A minor, C minor and E minor.

SFX:
- square/saw lasers with pitch drops
- noise plus sub-thump explosions through a WaveShaper crunch
- FM glass shimmer for power-ups
- a glitch stutter when a Corrupted enemy dies

**Why it fits**

Every mechanic has a diegetic reason.
- Enemies are processes, so Platonic solids are the correct art rather than a budget cut.
- Currencies, Spare Kernels and Patch cards explain the systems.
- The Link Beam is a data link, and the boss names describe how each fight plays.

It is also the cheapest look to render at 60+ FPS on Retina: emissive geometry on a dark void, one bloom pass, no shadows and no real-time lights. Cyan and magenta team colours stay readable against every sector palette.

### ABYSSAL LIGHT

Two bathysphere drones descend a lightless ocean trench, harvesting Lumen from bioluminescent predators to power the mothership above.
- Sectors are dives.
- The shop is the tether station.
- The Link Beam is a shared power cable.
- The currencies are Lumen and Pearls.

**Vehicles**

The same four chassis and stat sheets, reskinned: MANTA (Lancer, sonar lance), DREDGER (Bulwark, harpoon spread, bubble dome), NEEDLEFISH (Specter, spine stream, ink blink), LANTERN (Tinker, light cone that heals the partner). Hull profiles are rounded lathe shapes with porthole emissive masks.

**Enemies**

The same six behaviours, reskinned:
- Shard: jelly drifter (a LatheGeometry bell with vertex-shader tentacle ribbons)
- Dart: eel lunger
- Fork: siphonophore that splits
- Spiker: urchin that fires spine rings
- Warden: armoured isopod with a front shield
- Leech: lamprey that latches onto the cable

Bosses: BROOD MOTHER (splits), TWIN ANGLERS (sync kill), ABYSSAL MAW (3 phases).

**Procedural visuals**

- FLOOR_MODE_CAUSTICS: animated Voronoi caustics on a noise-displaced seabed ring.
- Exponential fog to black through custom fog uniforms (never scene.fog, so the shader program never changes).
- Additive light-shaft cones with noise-scrolled alpha.
- Marine snow in the same GPU particle ring.
- Creatures come from LatheGeometry and TubeGeometry with vertex-shader pulsing (sin(time + seed)). Bioluminescent spots come from hashed cells in the same neonSurface shader, driven by the theme's emissive mask parameters.

**Audio**

70-80 BPM D Dorian drones, sonar pings through feedback delay and procedural reverb, whale-like FM glides, muffled low-passed explosions, bubbly pickups, and a heartbeat sub pulse at low HP.

**Why it fits**

Darkness plus bioluminescence reuses the emissive-plus-bloom pipeline unchanged, and the cable fiction makes the Link Beam intuitive. The feel is very different from KERNEL PANIC: slow, tense and organic. The risk is readability in the dark, which is handled with a minimum emissive floor and high-contrast enemy bullets.

### EMBERFALL

Salvage tug pilots skim a shattered molten asteroid orbiting a dying red giant, fighting rogue mining drones and magma constructs for Scrap. Each sector is an orbit closer to the star, and the heat haze rises. The currencies are Scrap and Alloy.

**Vehicles**

The same four chassis: TUG (Lancer, rivet gun), ANVIL (Bulwark, flak, crust dome), SKIFF (Specter, plasma needle), WELDER (Tinker, repair beam). Hard-surface faceted hulls are built from extruded, bevelled profiles with molten-seam emissive masks.

**Enemies**

Same six behaviours:
- Shard: drill drone
- Dart: dive-bomber
- Fork: ore golem that splits
- Spiker: flare turret
- Warden: obsidian brute with a front shield
- Leech: magnetic mine that latches onto the tow cable

Bosses: FOUNDRY CRAWLER (splits), TWIN SMELTERS (sync kill), THE FURNACE CORE (3 phases).

**Procedural visuals**

- FLOOR_MODE_LAVA: a domain-warped FBM lava flow with cracked Voronoi crust and emissive seams.
- Rocks are icospheres displaced at Boot on the CPU with 3D simplex FBM.
- An animated FBM corona billboard for the star.
- Heat shimmer is a cheap UV offset in the composite pass, whose strength is a theme uniform.
- Ember particles use the shared GPU ring.

**Audio**

Industrial percussion from filtered noise hits, metallic FM clangs, distorted low saws, and a rumbling brown-noise bed that rises with intensity. 124 BPM in E Phrygian.

**Why it fits**

Warm oranges contrast with the cyan and magenta player hulls. Faceted hard-surface geometry is quick to generate and merge. The salvage fiction matches the economy. The feel differs from the other two themes: aggressive, hot and mechanical. Heat shimmer costs one texture lookup inside the existing composite pass, so it adds no extra pass.

## 3. State machine

STRUCTURE
- A strict pushdown FSM in src/engine/StateMachine.ts, with its edge table in src/engine/transitions.ts.
- StateId: 'Boot' | 'MainMenu' | 'CharacterSelect' | 'Playing' | 'UpgradesShop' | 'Paused' | 'GameOver'.
- Base states replace the whole stack; overlay states push onto a live base. Maximum stack depth is 3: Playing, UpgradesShop{midrun}, Paused.
- Only three operations exist: replace, push and pop. Each edge is Edge { from, to, op, guard? }.
- Every (from, to) pair not listed below is rejected: InvalidTransitionError in DEV and tests; logged and dropped in PROD.

THE 16 EDGES
1. Boot -> MainMenu (replace)
2. MainMenu -> CharacterSelect (replace)
3. MainMenu -> UpgradesShop{meta} (replace)
4. UpgradesShop{meta} -> MainMenu (replace; guard: mode = meta)
5. CharacterSelect -> MainMenu (replace)
6. CharacterSelect -> Playing{config} (replace)
7. Playing -> Paused{reason} (push)
8. Playing -> UpgradesShop{midrun} (push)
9. Playing -> GameOver{outcome: defeat} (replace, clears the stack)
10. UpgradesShop{midrun} -> Playing (pop; guard: the state below is Playing)
11. UpgradesShop{midrun} -> Paused (push)
12. UpgradesShop{midrun} -> GameOver{outcome: victory} (replace; EXTRACT)
13. Paused -> Playing | UpgradesShop (pop; guard: the target equals the state directly below)
14. Paused -> GameOver{outcome: abandoned} (replace)
15. GameOver -> CharacterSelect{prefill: last picks} (replace; Retry)
16. GameOver -> MainMenu (replace)

Settings, Controls/Key Test and Credits are sub-panels inside MainMenu and Paused, not FSM states.

REQUEST SEMANTICS
- services.fsm.request(to, ...payload) only enqueues and returns false when the request is statically invalid from the current top.
- The queue is FIFO and is applied at the START of the next rAF, before any sim step, so nothing transitions mid-tick, mid-render or inside enter/exit. Requests made inside enter/exit go to the next frame.
- Each queued request is re-validated against the stack as it stands at apply time. If it is stale (a blur Pause during Boot, or a Pause after GameOver was applied), it is dropped with a DEV warning.
- At most 4 transitions are applied per frame.
- After each applied transition the FSM calls input.clearEdges() and input.suppressHeldUntilRelease(), so a confirm press never becomes a shot or a purchase in the next state.
- The sim never requests transitions directly. PlayingState reads RunFlags (defeat, waveClearReady, victory) after stepping, and rules.ts has already applied the tie-break (wave clear beats wipe on the same tick).

PER-FRAME DISPATCH (GameLoop)
- fixedUpdate(1/120) runs only on the top state; only Playing has a sim.
- update(frameDt) runs on the top state: menus, UI and input repeat.
- render(alpha, frameDt) runs on the topmost state whose world is live.
- Overlays declare worldBelow: 'frozen'. On onCovered, the base renders ONE frozen composite frame (dim 0.55 plus a blur mix from the bloom mip), then stops rendering, so the GPU idles in Pause and the shop while the DOM overlay animates. On a resize while covered, one frozen frame is re-rendered.

LIFECYCLE ORDER
- replace: exit is called on every stack entry, top to bottom, then enter on the new state.
- push: below.onCovered(by), then overlay.enter(payload, from).
- pop: overlay.exit(to), then below.onUncovered(from).

ENTER/EXIT DUTIES

Boot
- enter (sync) starts an async pipeline. Its progress is polled in update and shown on BootScreen:
  1. Detect WebGL2 and EXT_color_buffer_float (LDR fallback if the extension is missing); fatal panel if WebGL2 is missing.
  2. Load and migrate the save.
  3. Resolve the ThemeDef from the save's settings.
  4. Build the AssetLibrary incrementally across frames: noise textures, all geometries, all materials, InstanceBatches and ring buffers.
  5. Run ShaderWarmup: compileAsync over a warm scene holding every material x geometry x instancing variant, 2 full-size offscreen PostFX frames, and initTexture for every DataTexture.
  6. Record baselines for renderer.info.programs and memory.
  7. Show 'Press any key'. The first keydown or click awaits audio.unlock(), which pre-renders the SFX bank through OfflineAudioContext, then requests MainMenu.
- exit: unmount BootScreen and release the warm scene. It holds only shared resources, so nothing is disposed.

MainMenu
- enter: mount MainMenuScreen, camera 'attract' (MenuBackdrop orbit with 6 idle drones and the voxel title), music 'menu'.
- exit: unmount.

CharacterSelect
- enter: attach SelectStage turntables and per-player cursors with drop-in join. Locked vehicles show their Core price, and a prefill from Retry is applied.
- When every joined player is Ready, a 0.6 s countdown builds RunConfig: runId, crypto seed or ?seed=, picks, meta snapshot, fire modes, themeId. It then requests Playing.
- exit: save lastLoadout through a settings delta; hide the stage.

Playing
- enter{config}: services.session.current = services.createRun(config); render.attachWorld(run.world); mount HUD; music 'combat'; start the wave-1 countdown.
- fixedUpdate:
  1. input.sample(p, intent) for both players.
  2. run.tick(intents).
  3. Read run.flags, which requests Paused (pause edge or focus lost), UpgradesShop{midrun} (waveClearReady), or GameOver{defeat}.
- update: drain SimEvents once per frame to render.consumeEvents, audio.consumeEvents and hud, then run.clearEvents(); update the HUD VM.
- render: render.frame(alpha, frameDt), with the camera updated on interpolated positions.
- onCovered: freeze; render one frozen frame; duck music (low-pass 700 Hz, -9 dB).
- onUncovered(from):
  - loop.resetAccumulator() so no catch-up burst follows.
  - If from = UpgradesShop: run.applyShopResults() (recompute stats; max-HP changes heal by the delta), run.beginNextWave() (or enter OVERFLOW if PUSH DEEPER was chosen), then the countdown.
  - If from = Paused: restore music.
- exit (always a replace to GameOver): keep services.session.current so GameOver can render and summarise it; unmount HUD.

UpgradesShop{midrun}
- enter: shop = run.openShop() builds this visit's ShopModel (seeded offers, per-player transaction logs, open guard); mount ShopScreen; music 'shop'.
- update: per-player MenuIntents become ShopTx, processed P1 then P2 each frame. When all are Ready and the countdown ends, request pop, or GameOver{victory} on EXTRACT.
- exit: shop.commit() clears the undo logs and persists card locks into RunState; settings are saved with debounce. Run state is never saved.

UpgradesShop{meta}
- enter: HangarScreen over MenuBackdrop.
- Every purchase or respec calls save.commit(delta) immediately.
- exit: unmount.

Paused
- enter: PauseScreen (Resume, Settings, Controls/Key Test, Abandon with a 600 ms hold-to-confirm); input.releaseAll().
- Resume requests pop; Abandon requests GameOver{abandoned}.
- Auto-pause never auto-resumes.
- exit: unmount.

GameOver
- enter:
  - summary = run.summary(outcome); cores = computeRunRewards(summary).
  - save.commitRun(runId, delta), which is idempotent by lastCommittedRunId, then update records and the leaderboard.
  - Show GameOverScreen with the MVP card and the Cores breakdown; music 'gameover' or 'victory'.
  - The camera runs a 1.2 s slow push-in at time scale 0.25 on the frozen, finished world.
- exit: run.dispose() returns every pooled entity and zeroes batch counts; render.detachWorld(); services.session.current = null. renderer.info.memory must equal the Boot baseline.

LIFECYCLE HOOKS (engine/lifecycle.ts)
- window blur, visibilitychange hidden, pagehide, fullscreenchange (exit) and webglcontextlost call input.releaseAll().
- They request Paused{reason} only when the top state is Playing. In every other state they only release input.
- Hidden also calls audio.suspend(); visible calls resume.

## 4. Camera

CHOSEN: a single adaptive shared camera with bounding-box framing and fixed yaw. There is no split-screen and no movement tether.

Why:
- Split-screen doubles scene and bloom passes at DPR 1.5 on a 3024x1964 panel.
- It turns a 16:10 laptop screen into two 8:10 panes.
- It hides the Link Beam, revive beacons and flanking, which are the core co-op mechanics.
- The arena is bounded (playable radius 32 u) and the maximum zoom-out is solved to fit the whole arena at any aspect, so both players are always visible without restricting movement.
- Fixed yaw keeps WASD and the arrows screen-relative.

RIG
- PerspectiveCamera, vertical FOV 42 deg, pitch 58 deg below horizontal, looking at a ground-plane target.
- distance is clamped to [minDist 26, maxDist(aspect)].
- maxDist is recomputed on resize by a 16-iteration binary search: the smallest distance at which the arena circle plus a 4 u margin (sampled at 16 points) projects inside NDC +/-0.95. This handles portrait and narrow windows.

FRAMING
solveFraming in render/cameraMath.ts is a pure, unit-tested function run on interpolated render positions.
- Framing set:
  - Alive player: padding 7 u.
  - Downed player: padding 5 u, so the beacon stays on screen.
  - Offline ghost: excluded, but clamped by the sim to the last published view rectangle inset by 1.5 u.
  - Living boss: padding 4 u.
  - Solo Echo Drone: excluded (it orbits within 6 u anyway).
- Goal centre: the midpoint of the set's AABB, plus a lead of average alive-player velocity x 0.2 s (clamped to 4 u), then clamped to 12 u from the arena centre.
- Goal distance: a 12-iteration binary search for the smallest distance at which every padded point (4 offsets each) lands inside the NDC safe box x in [-0.82, 0.82], y in [-0.78, 0.72]. The top is reserved for the boss bar and wave banner. The result is clamped to [minDist, maxDist].

SMOOTHING
- Critically damped smoothDamp that behaves the same at any frame rate.
- Centre smooth time 0.18 s.
- Zoom-out 0.30 s and always has priority.
- Zoom-in 0.65 s, starting only after the goal has stayed more than 6% below the current distance for 0.4 s (no pumping).
- Runs once per rendered frame with frameDt and interpolated positions, so it is smooth at 120 Hz and never touches the sim.

READABILITY WHEN ZOOMED OUT
- Above distance 45, each player gets a constant-screen-size 24 px marker (P1 triangle, P2 diamond, in the player colour) from MarkerView's sizeAttenuation-free shader, with opacity easing in.
- Downed markers add a bleed-out arc and revive progress.

SHAKE
- Trauma-based. Each event adds at most 0.35 trauma; trauma decays at 1.6/s.
- Offset = trauma^2 x settings.screenShake x 1D value noise: at most 0.6 u of x/z translation and 1.2 deg of roll.
- Applied after framing so it never affects the solver. Disabled when reduce motion is on.

EDGE CASES
- (a) Players on opposite sides of the arena: goal distance reaches maxDist and the whole arena fits; markers appear.
- (b) One Downed: still framed with reduced padding so the partner can find them.
- (c) One Offline: only the survivor is framed; the ghost stays inside the view by construction.
- (d) Solo: one target plus up to +15% zoom-out at max speed.
- (e) No living player (wipe): the camera eases to the last downed position, then runs GameOver's push-in at time scale 0.25, applied to the accumulator input rather than dt so the sim stays deterministic.
- (f) Teleports (Specter Blink, kernel respawn): no snap; the fast zoom-out absorbs them.
- (g) Boss intro: a 1.2 s push-in to the boss with players invulnerable. Boss padding may force maxDist, which is intended.
- (h) Wave countdown: a swoop from maxDist to the goal.
- (i) Resize or DPR change: recompute maxDist; snap without smoothing if the aspect changed by more than 10%.

MODE CAMERAS
'attract' (MenuBackdrop orbit), 'select' (SelectStage turntables), 'follow' (gameplay), 'gameover' (push-in). The mode is set through RenderPort.setCameraMode.

## 5. Controls

All bindings use KeyboardEvent.code, so they are layout independent.
- Control, Meta and Alt (both sides) are FORBIDDEN in bindings:
  - Ctrl+Arrow switches macOS Spaces or opens Mission Control before the browser sees it.
  - Cmd combos quit or close the tab, and macOS drops keyup while Cmd is held.
  - Option+Space is a common launcher hotkey.
- The only modifiers allowed are ShiftLeft and ShiftRight, which sit on dedicated matrix lines and are ghost-safe.
- The defaults work on the MacBook built-in keyboard, which has no numpad.

DEFAULT GAMEPLAY BINDINGS [primary, alternates]

P1 (left hand, FPS posture):
- Up KeyW, Left KeyA, Down KeyS, Right KeyD.
- FIRE/FOCUS (hold) [Space, KeyF].
- DASH (tap) [ShiftLeft, KeyQ].
- SPECIAL (tap) [KeyE, KeyR].

P2 (right hand on the arrows, left hand resting on , . /):
- Up ArrowUp [Numpad8]; Left ArrowLeft [Numpad4]; Down ArrowDown [Numpad5, Numpad2]; Right ArrowRight [Numpad6].
- FIRE/FOCUS (hold) [Period, Numpad0].
- DASH (tap) [Slash, ShiftRight, NumpadDecimal].
- SPECIAL (tap) [Comma, NumpadEnter].
- Numpad codes are always active as alternates for external keyboards, and work whatever the NumLock state.

SOLO: both binding sets drive P1.

GLOBAL KEYS
- Pause: Escape or KeyP, from either player.
- Escape in browser fullscreen also exits fullscreen, and fullscreenchange auto-pauses.
- Debug overlay: Backquote, only with ?debug=1.
- Fullscreen and mute are menu-only.

MENUS
- Shared menus (MainMenu, Pause, GameOver, Hangar):
  - Navigate with WASD or the arrows.
  - Confirm with Enter, NumpadEnter, Space or Period.
  - Back with Escape or Backspace.
- CharacterSelect and the mid-run shop give each player a cursor driven only by their own keys:
  - Move keys navigate; Left/Right on a card row switches between its Buy and Lock columns.
  - Fire buys or confirms.
  - Dash undoes or goes back.
  - Special toggles Ready.
  - Reroll and Gift are ordinary rows, so no extra keys are needed.
- Software repeat from the held state: 350 ms delay, then every 90 ms. OS repeat events are ignored.
- Buying requires a fresh press after the shop's 350 ms open guard.
- DOM buttons use tabindex=-1 and preventDefault on mousedown, so Space never double-activates a focused button. Mouse clicks map to the same MenuIntents.

DEVICE (input/KeyboardDevice.ts, pure, over an injected KeyEventTargetLike)
- keydown and keyup listeners in the capture phase.
- A code-to-slot Map is prebuilt from KNOWN_CODES; unknown codes are ignored without allocating.
- State lives in typed arrays: down (Uint8Array), pressCount (Uint16Array), lastPressSeq (Uint32Array, for SOCD).
- Events with e.repeat or e.isComposing never create edges.
- An event with metaKey or ctrlKey set is neither recorded nor prevented, so OS and browser shortcuts keep working.
- preventDefault is called for every bound code, plus Space, the arrows, Tab, Backspace, Slash and Quote. This covers page scroll, Firefox quick-find and back-navigation.

LATENCY
- Handlers write state immediately.
- IntentSampler runs at the start of every fixed 120 Hz step, so a key reaches the sim within 8.3 ms, plus the frame.
- Taps are latched through pressCount > lastSeen, so a press and release inside one tick still counts: one dash, or one tick of fire.
- SOCD is last-pressed-wins per axis, and diagonals are normalised to length 1.

STUCK-KEY PROTECTION
- On MetaLeft or MetaRight keydown: releaseAll() and set metaHeld; while metaHeld, non-modifier keydowns are ignored.
- On Meta keyup: releaseAll() again, and suppressHeldUntilRelease() so a key still physically held must be pressed again.
- window blur, visibilitychange hidden, pagehide, contextmenu and fullscreenchange also call releaseAll().
- A repeat keydown for a key believed to be up silently re-asserts it as down without an edge, which self-heals.
- After every FSM transition: clearEdges() and suppressHeldUntilRelease().

GHOSTING
- Autofire is on by default, so each player normally holds at most 2 movement keys. The worst case is 3 (2 move + Focus): 6 keys across both players, with Space and Shift on ghost-safe lines.
- Controls panel > KEY TEST: live keycaps, a readout of simultaneously held keys, and a prompt to hold the busiest combo (W+D+Space + ArrowUp+ArrowRight+Period). It suggests a rebind or autofire when a key drops.

REBINDING
- Capture-next-key flow in ControlsPanel.
- bindingValidation rejects forbidden codes, rejects Escape and KeyP (reserved for pause), and requires every action to keep at least one code.
- A code already bound elsewhere triggers a swap offer.
- Bindings persist in the save and are re-validated on load (reset per action if invalid).

PER-PLAYER SETTINGS: autofire on/off, and hold versus toggle for Focus.

## 6. Upgrades and saves

STACKING (upgrades/stats.ts, a pure function)
stat = clamp((base + sum(flat)) x (1 + sum(add%)) x product(mul), min, max)
- Vehicle base, Firmware snapshot, stat rows, cards and team items all feed the same three pools, in catalog order, so the result is deterministic and independent of purchase order.
- Recomputed only when the shop exits, at run start, or on an event (Glass Lens, Overheat threshold). Never per frame.
- Card ownership is a Uint8Array of stack counts plus a bitmask, so hot-path checks do not allocate.

HARD CAPS (bound both physics and performance)
- moveSpeed <= 1.6x vehicle base
- fireRate <= 20 shots/s; any excess ratio becomes a damage multiplier, so the upgrade is never wasted. The weapon cadence accumulator fires several shots in one tick when needed.
- damage multiplier <= 4.0
- projectiles per shot <= 5
- pierce <= 4
- bounces <= 2
- dashCooldown >= 0.6 s
- dash charges <= 3
- maxHp in [1, 400]
- magnetRadius <= 12 u
- critChance <= 0.5 (crit x2)
- Spare Kernels held <= 3
- wallet in [0, 9,999,999]

PRICING (upgrades/pricing.ts, integer only)
price = max(5, round5(base x growth^level x (1 + 0.06 x (w - 1)))), where w is the global wave index.

MID-RUN STAT ROWS (per player)

| Row | Effect per level | Max | Base | Growth |
|---|---|---|---|---|
| Thrusters | +7% speed | 6 | 30 | 1.35 |
| Plating | +20 max HP, heals by that delta | 8 | 25 | 1.30 |
| Overclock | +12% fire rate | 8 | 35 | 1.35 |
| Payload | +15% damage | 8 | 35 | 1.35 |
| Magnet | +25% pickup radius | 5 | 20 | 1.30 |
| Coolant | -12% dash cooldown | 5 | 30 | 1.35 |
| Capacitor | +20% special charge | 5 | 30 | 1.35 |
| Special Tuning | tier II/III: +25% radius, duration, damage | 2 | 90 | 1.80 |

REPAIR (consumable)
- Heals 35% of max HP.
- Price 15 + 4w, x1.5 for each further buy in the same visit; at most 2 per visit.
- Rejected with fullHp at full HP.

PATCH CARDS (per player; 3 seeded offers per visit)
- Offers are drawn without replacement from rng.fork('shop', visit, player). Uniques already owned and cards at their stack cap are excluded. When the pool is exhausted, rarity falls back downward, and finally a 'Shard Cache' card (+25 Shards, price 0) is offered.
- Price by rarity: C 45, U 75, R 120, L 190, then x the wave inflation.
- Common: Split Shot (+2 side bullets at +/-12 deg, -15% damage; stack 2), Overdrive Battery (+25% special charge; stack 3), Bounty (+20% Shards; stack 2).
- Uncommon: Pierce (+1; stack 3), Afterimage (dash leaves a 1.5 s trail doing 30 DPS; unique), Double Buffer (+1 dash charge; unique), Vampire Code (+1 HP per 12 kills; stack 2), Overheat (+40% fire rate below 30% HP; unique).
- Rare: Ricochet (+1 bounce; stack 2), Chain Arc (15% chance to arc to 3 enemies for 50% damage; unique), Micro-Missiles (2 homing missiles every 1.2 s, 20 dmg; stack 2), Nanoshield (blocks 1 hit every 12 s; unique), Orbitals (2 orbiting blades, 18 DPS; unique), Glass Lens (+35% damage, -20% max HP; unique).
- Legendary (needs the Legendary Pool firmware): FORK() (every 5th shot doubles), SUDO (special fires twice), ROOT ACCESS (combo tier +1 permanently); all unique.

TEAM ROW (shared stock; either player buys from their own wallet)
- Spare Kernel: 150 x (1 + 0.5 x boughtThisRun); 1 per visit; hold cap 3.
- Link Amplifier: +40% beam DPS; 3 levels at 90/150/240.
- Link Range: max link length 14 -> 18 -> 22; 2 levels at 70/130.
- Revive Protocol: revive time 2.0 -> 1.2 s and revive HP 40% -> 60%; 1 level at 110.

UTILITY ROWS
- Reroll: 5 + 5 x rerollsThisVisit, x inflation. Free Firmware rerolls are used first.
- Lock: at most 1 card; it carries to the next visit at its original price.
- Gift: 10 Shards, co-op only; requires the giver to have at least 10.

META FIRMWARE (Cores; the price list per level is explicit)

| Upgrade | Effect per level | Prices by level |
|---|---|---|
| Hull FW | +5% max HP | 20/35/55/80/110 |
| Boot Cache | +25 starting Shards | 25/45/70/100 |
| Reroll Cache | +1 free reroll per visit | 60/120 |
| Magnet FW | +10% pickup radius | 15/30/50 |
| Overclock FW | +3% fire rate | 25/40/60/85/115 |
| Field Medic | -10% revive time | 30/55/85 |
| Pre-Charge | special starts 50% charged | 80 |
| Second Boot | +1 starting Spare Kernel | 150 |
| Legendary Pool | unlocks Legendary cards | 120 |

- Unlocks: Specter 60, Tinker 90.
- Maxing everything costs about 1,600 Cores, roughly 20-25 runs.
- Respec refunds firmwareSpent (the recorded amounts), never current prices. Unlocks cannot be refunded.

TRANSACTION RULES (upgrades/ShopModel.ts, pure, no DOM)
- Every buy, undo, reroll, lock, gift and ready goes through a single apply(tx), which re-validates everything: player present and joined, wallet >= price, level < max, availability (co-op-only items, Legendary Pool), visit limits, hold caps, full HP.
- apply returns PurchaseResult. Failure reasons: funds, maxLevel, capped, soldOut, unavailable, absent, fullHp, visitLimit, heldCap, alreadyOwned, nothingToUndo, teamDependency, invalid.
- Each frame's transactions are processed P1 then P2 in a fixed order.
  - Personal items cannot conflict between players.
  - For team stock, the first transaction wins and the second gets soldOut with no charge, plus a 'Partner bought it' toast.
- UNDO:
  - LIFO per player, within the current visit only.
  - Refunds the exact price paid from the log entry, never a recomputed price.
  - Restores the stored PlayerRunState snapshot, including hp and maxHp, so undoing Plating, Repair or Glass Lens is exact.
  - A team purchase can be undone only by its buyer, and only while it is still on top of the team log; otherwise teamDependency.
  - A gift can be undone by the giver.
  - Rerolls are never refundable.
  - Leaving the shop commits everything and clears the logs.
- 'capped': if a stat is already at its hard cap, the row shows CAPPED. The purchase is allowed only if the level still changes another stat or the fire-rate overflow; otherwise it is rejected as capped.
- Max-HP rules: increases add current HP by the delta; decreases (Glass Lens) clamp current HP to at least 1.
- A Downed or Offline player can shop (the wave-end reboot runs before the shop anyway).
- Solo hides the P2 panel and Gift, and rejects P2 transactions as absent.
- Numbers: all integers, checked with Number.isSafeInteger. NaN, non-finite values and negatives are rejected and asserted in DEV.
- Meta purchases never affect a run in progress, because of the snapshot.
- Hangar contention within one frame resolves P1 then P2.

PERSISTENCE (save/*)

Keys
- localStorage 'linkline.save' holds the envelope { v: 1, ts, rev, crc: crc32(stableStringify(data)), data: SaveDataV1 }.
- 'linkline.save.bak' holds the previous good envelope; the backup is written first, then the main key.
- 'linkline.save.corrupt' keeps one quarantined raw blob.

SaveDataV1 contents
- cores, lifetimeCores
- meta levels, firmwareSpent
- unlocks: vehicles
- settings: volumes, quality, frameCap, screenShake, reduceFlashes, reduceMotion, colorblind, autofire[2], focusToggle[2], showFps, themeId
- bindings
- lastLoadout
- records: runs, victories, bestWave, bestScore, top 10 leaderboard
- lastCommittedRunId

Load
1. Parse with a reviver that drops __proto__, constructor and prototype keys.
2. Check the crc.
3. Run the migration chain migrations[v] (v -> v+1) until CURRENT_SAVE_VERSION.
4. Sanitize:
   - clamp every level to [0, max] and refund Cores for clamped or removed levels from firmwareSpent
   - drop unknown ids
   - coerce numbers (finite, integer, cores 0..1e9)
   - dedupe unlocks; the starter vehicles are always unlocked
   - re-validate bindings (reset per action if invalid)
   - cap the leaderboard at 10

Failure handling
- Load fails: try .bak. If that fails too: defaults, quarantine the raw blob, show a toast.
- v > CURRENT (a save from a newer build): run on in-memory defaults in read-only mode and never overwrite it; warning toast.
- localStorage missing or throwing (private mode): MemoryStorage plus a toast.
- QuotaExceeded: evict .corrupt and retry once, then keep the in-memory state and show a toast.

Writes
- Always DELTA commits: re-read the stored value, apply the delta, validate, write.
- A storage event from another tab reloads the cache while not in a run.
- commitRun(runId) is idempotent via lastCommittedRunId.
- Writes happen only at Boot (after migration), on Hangar purchases, on settings or bindings changes (500 ms debounce, flushed by the frame tick and on pagehide), and at GameOver. Never while Playing, because localStorage is synchronous.
- Mid-run state is never persisted, so a reload abandons the run by design.

## 7. File tree

```text
/Users/aaronak/test
├── .editorconfig
├── .gitignore                    (existing; add dist/ coverage/ .vite/ *.tsbuildinfo)
├── .nvmrc                        (24.21.0)
├── .prettierrc.json
├── .prettierignore
├── .github/
│   └── workflows/
│       └── ci.yml
├── README.md                     (rewritten: pitch, controls, scripts, architecture, perf notes)
├── docs/
│   └── ARCHITECTURE.md           (layer matrix, ownership map, contract-change protocol)
├── eslint.config.js
├── index.html
├── package.json
├── package-lock.json             (generated by npm install, committed)
├── tsconfig.json                 (app + tests, DOM libs)
├── tsconfig.pure.json            (L0-L4 pure layers: lib ES2023 only, no DOM, no three)
├── tsconfig.node.json            (vite/vitest/eslint configs + scripts)
├── vite.config.ts
├── vitest.config.ts
├── scripts/
│   ├── check-arch.mjs
│   └── typecheck-scope.mjs
├── src/
│   ├── main.ts
│   ├── vite-env.d.ts
│   ├── contracts/
│   │   ├── ids.ts
│   │   ├── states.ts
│   │   ├── input.ts
│   │   ├── sim.ts
│   │   ├── simEvents.ts
│   │   ├── run.ts
│   │   ├── upgrades.ts
│   │   ├── save.ts
│   │   ├── audio.ts
│   │   ├── render.ts
│   │   ├── ui.ts
│   │   ├── theme.ts
│   │   └── services.ts
│   ├── core/
│   │   ├── math.ts
│   │   ├── rng.ts
│   │   ├── hash.ts
│   │   ├── assert.ts
│   │   ├── result.ts
│   │   ├── logger.ts
│   │   ├── EntityPool.ts
│   │   ├── EventChannel.ts
│   │   └── SpatialGrid.ts
│   ├── config/
│   │   ├── tuning.ts
│   │   ├── quality.ts
│   │   ├── vehicles.ts
│   │   ├── enemies.ts
│   │   ├── bosses.ts
│   │   ├── waves.ts
│   │   ├── runCatalog.ts
│   │   ├── cards.ts
│   │   └── metaCatalog.ts
│   ├── themes/
│   │   ├── registry.ts
│   │   ├── kernelPanic.ts
│   │   ├── abyssalLight.ts
│   │   └── emberfall.ts
│   ├── engine/
│   │   ├── transitions.ts
│   │   ├── StateMachine.ts
│   │   ├── GameLoop.ts
│   │   ├── FramePacer.ts
│   │   ├── PerfMonitor.ts
│   │   ├── ResolutionGovernor.ts
│   │   └── lifecycle.ts
│   ├── input/
│   │   ├── keyCodes.ts
│   │   ├── defaultBindings.ts
│   │   ├── bindingValidation.ts
│   │   ├── KeyboardDevice.ts
│   │   ├── IntentSampler.ts
│   │   ├── MenuNavigator.ts
│   │   └── InputService.ts
│   ├── entities/
│   │   ├── players.ts
│   │   ├── weapons.ts
│   │   ├── specials.ts
│   │   ├── projectiles.ts
│   │   ├── pickups.ts
│   │   ├── damage.ts
│   │   ├── cardEffects.ts
│   │   ├── linkBeam.ts
│   │   ├── revive.ts
│   │   ├── combo.ts
│   │   ├── enemies.ts
│   │   ├── enemyBehaviors.ts
│   │   ├── bosses.ts
│   │   └── bossPatterns.ts
│   ├── sim/
│   │   ├── createWorld.ts
│   │   ├── stepWorld.ts
│   │   ├── collision.ts
│   │   ├── rules.ts
│   │   ├── WaveDirector.ts
│   │   ├── stateHash.ts
│   │   └── RunSession.ts
│   ├── upgrades/
│   │   ├── pricing.ts
│   │   ├── stats.ts
│   │   ├── offers.ts
│   │   ├── ShopModel.ts
│   │   ├── MetaShop.ts
│   │   └── rewards.ts
│   ├── save/
│   │   ├── defaults.ts
│   │   ├── migrations.ts
│   │   ├── sanitize.ts
│   │   ├── storage.ts
│   │   └── SaveStore.ts
│   ├── states/
│   │   ├── BootState.ts
│   │   ├── MainMenuState.ts
│   │   ├── CharacterSelectState.ts
│   │   ├── PlayingState.ts
│   │   ├── UpgradesShopState.ts
│   │   ├── PausedState.ts
│   │   ├── GameOverState.ts
│   │   └── viewModels.ts
│   ├── shaders/
│   │   ├── chunks/
│   │   │   ├── common.ts
│   │   │   ├── noise.ts
│   │   │   ├── lighting.ts
│   │   │   └── instancing.ts
│   │   ├── neonSurface.ts
│   │   ├── floor.ts
│   │   ├── sky.ts
│   │   ├── projectile.ts
│   │   ├── particle.ts
│   │   ├── beam.ts
│   │   ├── decal.ts
│   │   ├── marker.ts
│   │   ├── digits.ts
│   │   ├── shockwave.ts
│   │   ├── trail.ts
│   │   └── post/
│   │       ├── bloom.ts
│   │       └── composite.ts
│   ├── assets/
│   │   ├── noise.ts
│   │   ├── textures.ts
│   │   ├── materials.ts
│   │   ├── AssetLibrary.ts
│   │   └── geometry/
│   │       ├── MeshBuilder.ts
│   │       ├── vehicles.ts
│   │       ├── enemies.ts
│   │       ├── bosses.ts
│   │       ├── arena.ts
│   │       ├── fxShapes.ts
│   │       └── voxelFont.ts
│   ├── render/
│   │   ├── Renderer.ts
│   │   ├── PostFX.ts
│   │   ├── ShaderWarmup.ts
│   │   ├── CameraRig.ts
│   │   ├── cameraMath.ts
│   │   ├── ScreenShake.ts
│   │   ├── InstanceBatch.ts
│   │   ├── GpuRingBuffer.ts
│   │   ├── RenderBridge.ts
│   │   ├── scenes/
│   │   │   ├── ArenaScene.ts
│   │   │   ├── MenuBackdrop.ts
│   │   │   └── SelectStage.ts
│   │   ├── views/
│   │   │   ├── PlayerView.ts
│   │   │   ├── EnemyView.ts
│   │   │   ├── BossView.ts
│   │   │   ├── ProjectileView.ts
│   │   │   ├── PickupView.ts
│   │   │   ├── BeamView.ts
│   │   │   ├── DecalView.ts
│   │   │   └── MarkerView.ts
│   │   └── fx/
│   │       ├── FxDirector.ts
│   │       ├── ParticleSystem.ts
│   │       ├── ShockwaveSystem.ts
│   │       ├── TrailRenderer.ts
│   │       └── DamageNumbers.ts
│   ├── audio/
│   │   ├── AudioEngine.ts
│   │   ├── VoicePool.ts
│   │   ├── SfxBank.ts
│   │   ├── sfxRecipes.ts
│   │   ├── synth.ts
│   │   ├── reverb.ts
│   │   ├── theory.ts
│   │   ├── Composer.ts
│   │   ├── Sequencer.ts
│   │   ├── instruments.ts
│   │   └── AudioEventRouter.ts
│   ├── ui/
│   │   ├── UIRoot.ts
│   │   ├── dom.ts
│   │   ├── format.ts
│   │   ├── Toasts.ts
│   │   ├── styles/
│   │   │   ├── base.css
│   │   │   ├── hud.css
│   │   │   └── screens.css
│   │   ├── widgets/
│   │   │   ├── Meter.ts
│   │   │   ├── KeyCap.ts
│   │   │   ├── MenuList.ts
│   │   │   └── ShopPanel.ts
│   │   ├── hud/
│   │   │   ├── Hud.ts
│   │   │   ├── PlayerPanel.ts
│   │   │   ├── BossBar.ts
│   │   │   └── WaveBanner.ts
│   │   └── screens/
│   │       ├── BootScreen.ts
│   │       ├── MainMenuScreen.ts
│   │       ├── SettingsPanel.ts
│   │       ├── ControlsPanel.ts
│   │       ├── CharacterSelectScreen.ts
│   │       ├── ShopScreen.ts
│   │       ├── HangarScreen.ts
│   │       ├── PauseScreen.ts
│   │       └── GameOverScreen.ts
│   ├── app/
│   │   ├── Game.ts
│   │   ├── createServices.ts
│   │   └── errorOverlay.ts
│   └── debug/
│       ├── devApi.ts
│       ├── DebugOverlay.ts
│       └── Autopilot.ts
└── tests/
    ├── helpers/
    │   ├── fakeClock.ts
    │   ├── fakeKeyboard.ts
    │   ├── memoryStorage.ts
    │   ├── fakePorts.ts
    │   ├── scriptedIntents.ts
    │   └── worldFixture.ts
    ├── fixtures/
    │   └── saves/
    │       ├── v1-valid.json
    │       ├── v1-overleveled.json
    │       ├── future-v99.json
    │       └── corrupt.txt
    ├── core/      rng.test.ts  EntityPool.test.ts  EventChannel.test.ts  SpatialGrid.test.ts  hash.test.ts
    ├── engine/    StateMachine.test.ts  GameLoop.test.ts  FramePacer.test.ts  ResolutionGovernor.test.ts  lifecycle.test.ts
    ├── input/     KeyboardDevice.test.ts  IntentSampler.test.ts  bindingValidation.test.ts  MenuNavigator.test.ts
    ├── entities/  weapons.test.ts  revive.test.ts  linkBeam.test.ts  combo.test.ts  damage.test.ts  enemyBehaviors.test.ts  bosses.test.ts
    ├── sim/       collision.test.ts  rules.test.ts  WaveDirector.test.ts  determinism.test.ts  soak.test.ts  economy.test.ts  RunSession.test.ts
    ├── upgrades/  pricing.test.ts  stats.test.ts  offers.test.ts  ShopModel.test.ts  ShopModel.fuzz.test.ts  MetaShop.test.ts  rewards.test.ts
    ├── save/      SaveStore.test.ts  migrations.test.ts  sanitize.test.ts
    ├── audio/     VoicePool.test.ts  theory.test.ts  Composer.test.ts  Sequencer.test.ts
    ├── assets/    geometry.test.ts  noise.test.ts
    ├── render/    cameraMath.test.ts
    ├── ui/        format.test.ts
    └── states/    flow.test.ts  shopFlow.test.ts  gameOverCommit.test.ts
```

## 8. File responsibilities

### `package.json, package-lock.json`

type module, private, engines node >=24.

Dependencies
- three 0.186.1 (exact).

DevDependencies
- typescript ~6.0.3: the typescript-eslint 8.70.1 peer range is <6.1.0, so TS 7.0.2 is not used as the gate.
- @types/three 0.186.0, vite ^8.3.1, vitest ^5.0.2, @vitest/coverage-v8 ^5.0.2, eslint ^10.11.0, @eslint/js ^10, typescript-eslint ^8.70.1, globals ^17, prettier ^3, @types/node ^24.
- Exact resolved versions are recorded by the lockfile and verified against the registry in Wave 0.

Scripts
- dev, build (typecheck && vite build), preview
- typecheck: runs tsc -b over all 3 tsconfigs
- typecheck:scope
- typecheck:ts7: non-gating, `npx -p typescript@7.0.2 tsc -p tsconfig.json --noEmit`
- lint (--max-warnings=0), check:arch, test, test:coverage, format, format:check
- verify = format:check, typecheck, check:arch, lint, test, build

package-lock.json is generated once by npm install in Wave 0 and committed.

- **Exports:** npm scripts
- **Depends on:** none

### `tsconfig.json, tsconfig.pure.json, tsconfig.node.json`

Base compiler options:
- strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes, noImplicitOverride, noFallthroughCasesInSwitch, noUnusedLocals, noUnusedParameters
- verbatimModuleSyntax, isolatedModules, erasableSyntaxOnly (so no enums or namespaces)
- target ES2022, module ESNext, moduleResolution bundler, no baseUrl
- explicit types, set so the config stays TS7-clean

The three configs:
- tsconfig.json covers src plus tests with DOM libs and vite/client.
- tsconfig.pure.json uses lib [ES2023] and types [], and includes src/{contracts,core,config,themes,engine,input,entities,sim,upgrades,save,states}. This proves those layers never touch the DOM or three.
- tsconfig.node.json covers vite.config.ts, vitest.config.ts, eslint.config.js and scripts/*.

- **Exports:** n/a
- **Depends on:** none

### `vite.config.ts, vitest.config.ts`

Vite: base './', build.target es2022, sourcemap true, chunkSizeWarningLimit 1200, server port 5173 with strictPort, define __DEV__. No plugins, no manualChunks and no custom rollup output options, which avoids Rolldown option drift.

Vitest: environment node, include tests/**/*.test.ts, v8 coverage with thresholds (lines 85%, branches 80%) on the pure layers.

- **Exports:** default config (the only default exports allowed)
- **Depends on:** vite, vitest/config

### `eslint.config.js, .prettierrc.json, .prettierignore, .editorconfig`

ESLint:
- Flat config with typescript-eslint strictTypeChecked and stylisticTypeChecked using projectService.
- no-floating-promises, switch-exhaustiveness-check.
- no-non-null-assertion is off; `!` is allowed only after a bounds-checked index.
- no-restricted-imports bans 'three' outside assets/render/app/debug.

Prettier and editorconfig give a uniform format across parallel agents.

- **Exports:** n/a
- **Depends on:** typescript-eslint, @eslint/js, globals

### `scripts/check-arch.mjs`

A dependency-free Node script that fails the build on any violation:
- Enforces the layer import matrix from docs/ARCHITECTURE.md (lower layers cannot import higher ones; siblings only where listed).
- Checks the 'three' allow-list.
- Requires no cycles between top-level directories.
- Caps files at 400 lines.
- Bans: TODO, FIXME, placeholder, 'not implemented', @ts-ignore, @ts-expect-error without a reason, 'as any', 'export default' in src, console.* outside core/logger.ts, 'enum ', 'namespace ', and new THREE.*Material/*Geometry outside assets/ and render/InstanceBatch.ts and render/GpuRingBuffer.ts.

- **Exports:** process exit code
- **Depends on:** node:fs, node:path

### `scripts/typecheck-scope.mjs`

Runs `tsc -p tsconfig.json --noEmit --pretty false` and keeps only the diagnostics under the path prefixes given. A parallel agent can verify its own files while siblings are mid-edit.

- **Exports:** CLI: node scripts/typecheck-scope.mjs src/input tests/input
- **Depends on:** node:child_process

### `.nvmrc, .gitignore, .github/workflows/ci.yml`

.nvmrc pins 24.21.0.

.gitignore gains dist/, coverage/, .vite/ and *.tsbuildinfo, and still ignores node_modules.

ci.yml runs on push and PR with Node 24: npm ci, then npm run verify. It is committed as its own last commit, so it can be dropped if the push credential lacks the GitHub 'workflow' scope.

- **Exports:** n/a
- **Depends on:** none

### `README.md, docs/ARCHITECTURE.md`

README: pitch, install and run commands (Node 24), controls for both players, a keyboard ghosting tip and the Key Test, scripts, the debug URL flags (?debug=1, ?seed=) and perf notes.

ARCHITECTURE.md: the layer matrix, the ownership map per wave, the contract-change protocol, the event flow (sim, then EventChannels, then the frame drain), and the rules for adding a theme.

- **Exports:** n/a
- **Depends on:** none

### `index.html, src/main.ts, src/vite-env.d.ts`

index.html: div#stage (canvas host), div#ui overlay, noscript, meta viewport, color-scheme dark, an inline SVG data-URI favicon, and the module script /src/main.ts.

main.ts: imports the ui/styles/*.css files, calls installErrorOverlay, then createGame({ stage, uiRoot }).start().

vite-env.d.ts: vite/client types plus the __DEV__ declaration.

- **Exports:** none (entry)
- **Depends on:** app/Game, app/errorOverlay, ui/styles/*.css

### `src/contracts/ids.ts, src/contracts/states.ts, src/contracts/input.ts`

Type-only contracts plus as-const id arrays, written first in Wave 0 and frozen.

ids.ts: PlayerIndex, VehicleId, EnemyKind, BossId, ThemeId, StatRowId, CardId, TeamItemId, MetaUpgradeId, SfxId-independent ids.

states.ts: StateId, StatePayloads, Edge, StackOp, GameState, StateMachineApi, RunOutcome.

input.ts: KeyCode, Action, PlayerBindings, Bindings, PlayerIntent, MenuIntent, KeyEventLike, KeyEventTargetLike, FocusTargetLike, InputPort.

- **Exports:** types plus PLAYER_INDICES, VEHICLE_IDS, ENEMY_KINDS, BOSS_IDS, THEME_IDS, STATE_IDS, ACTIONS
- **Depends on:** none

### `src/contracts/sim.ts, src/contracts/simEvents.ts, src/contracts/run.ts`

sim.ts
- Kinematic, LifeState, the entity record shapes, LinkState, BossEntity, DerivedStats and PlayerRunState.
- WorldState: the mutable superset, including pools, grid, rng, events, deathQueue, run counters and viewRect.
- WorldView: the read-only view renderers use.
- SimSystem signature.

simEvents.ts: SimEvents, the fixed-capacity EventChannel map with struct shapes.

run.ts: RunConfig, LoadoutPick, RunFlags, RunSummary, RunSessionApi, ShopApi, ShopVisitSnapshot.

- **Exports:** WorldState, WorldView, SimSystem, SimEvents, RunConfig, RunSessionApi, ShopApi
- **Depends on:** contracts/ids, contracts/input, contracts/upgrades

### `src/contracts/upgrades.ts, src/contracts/save.ts`

upgrades.ts: NumericStat, StatModifier, StatRowDef, CardDef, TeamItemDef, MetaUpgradeDef, ShopTx, PurchaseFailure, PurchaseResult, TxLogEntry.

save.ts: Settings, SaveDataV1, SaveEnvelope, SaveDelta, Migration, KeyValueStorage, SaveStorePort, CURRENT_SAVE_VERSION (a const).

- **Exports:** PurchaseResult, ShopTx, SaveStorePort, SaveDataV1, CURRENT_SAVE_VERSION
- **Depends on:** contracts/ids, contracts/input

### `src/contracts/audio.ts, src/contracts/render.ts, src/contracts/ui.ts, src/contracts/theme.ts, src/contracts/services.ts`

audio.ts: SfxId, SfxCategory, MusicMood, AudioPort.

render.ts: RenderPort, CameraMode, MaterialKey, GeometryKey, AssetLibraryApi, INSTANCE_LAYOUT (the per-instance attribute offsets aT/aS), PostParams, RenderStats. It carries no three types; three-typed internals stay in render/.

ui.ts: ScreenId, the ScreenVMs map (Boot, MainMenu, CharacterSelect, Hud, Shop, Hangar, Pause, GameOver), UiPort.

theme.ts: ThemeDef (palette, display names, geometry recipe params, shader mode defines, fog, audio params).

services.ts: Services (fsm, input, audio, render, ui, save, assets, session, createRun, loop, perf, clock, log, newSeed) plus LoopControl and SessionStore.

- **Exports:** AudioPort, RenderPort, UiPort, ThemeDef, Services, INSTANCE_LAYOUT
- **Depends on:** other contracts

### `src/core/math.ts, rng.ts, hash.ts, assert.ts, result.ts, logger.ts`

math.ts: allocation-free math with out-params: clamp, lerp, smoothDamp, lerpAngle, segment-circle hit, point-segment distance, arc test for Warden shields, and normalize2.

rng.ts: seeded sfc32 Rng with fork(label, ...salts), int, range, chance, pick, weightedPick and shuffleInPlace.

hash.ts: crc32, fnv1a and stableStringify.

assert.ts: invariant, assertNever, and DEV-only asserts.

result.ts: ok/err helpers.

logger.ts: the Logger implementations: console, null and memory.

- **Exports:** smoothDamp, segCircleHit, inArc, Rng, createRng, crc32, fnv1a, stableStringify, invariant, assertNever, ok, err, createConsoleLogger, NullLogger
- **Depends on:** contracts

### `src/core/EntityPool.ts, EventChannel.ts, SpatialGrid.ts`

EntityPool<T>: preallocated monomorphic records in a dense active array with swap-remove, generational handles (slot*256 + gen), and spawn() that returns null when exhausted.

EventChannel<T>: a fixed-capacity ring of reusable mutable structs. push() returns a slot to fill; overflow is dropped and counted.

SpatialGrid: a uniform 16x16 grid of 4 u cells, rebuilt each tick by counting sort into Int32Arrays. queryCircle writes into a caller-owned scratch Int32Array.

- **Exports:** EntityPool, EntityHandle, EventChannel, SpatialGrid
- **Depends on:** contracts, core/assert

### `src/config/tuning.ts, src/config/quality.ts`

Pure `as const satisfies` data.

tuning.ts:
- SIM { HZ 120, DT, MAX_STEPS 8, MAX_FRAME_DT 0.1 }
- ARENA { RADIUS 32, PORTALS 8 }
- CAPACITY { enemies 180, playerShots 1536, enemyShots 1024, pickups 512, particles 8192, digits 256, shockwaves 32, decals 64 }
- CAMERA, COOP (revive, bleed-out, link numbers), COMBO
- STAT_CAPS
- ECONOMY (wallet cap, catch-up, inflation)

quality.ts: QUALITY_PRESETS for low, medium, high and ultra: dprCap, msaa, bloomRes, particle cap.

- **Exports:** SIM, ARENA, CAPACITY, CAMERA, COOP, COMBO, STAT_CAPS, ECONOMY, QUALITY_PRESETS
- **Depends on:** contracts, core

### `src/config/vehicles.ts, enemies.ts, bosses.ts, waves.ts`

Theme-neutral mechanics data.
- vehicles.ts: 4 VehicleDefs (stats, weapon, special, unlock cost).
- enemies.ts: 6 EnemyDefs (hp, speed, radius, cost, unlock wave, drops, behaviour params, shield arc) plus the corrupted modifier.
- bosses.ts: 3 BossDefs, each with phases made of attack-primitive steps.
- waves.ts: sector table, duration, budget formula coefficients, pulse intervals, formations, 2P multipliers and the OVERFLOW rules.

- **Exports:** VEHICLES, ENEMY_DEFS, CORRUPTED, BOSS_DEFS, WAVES
- **Depends on:** contracts, core

### `src/config/runCatalog.ts, cards.ts, metaCatalog.ts`

runCatalog.ts: STAT_ROWS (8 leveled rows), REPAIR, TEAM_ITEMS and the utility pricing (reroll, gift).

cards.ts: 16 CardDefs with rarity, stackMax, unique flag, requiresMeta and StatModifiers or an effect flag, plus RARITY_WEIGHTS by sector.

metaCatalog.ts: META_UPGRADES with explicit per-level prices, plus VEHICLE_UNLOCKS.

- **Exports:** STAT_ROWS, REPAIR, TEAM_ITEMS, UTILITY_PRICES, CARDS, RARITY_WEIGHTS, META_UPGRADES, VEHICLE_UNLOCKS
- **Depends on:** contracts, core

### `src/themes/registry.ts, kernelPanic.ts, abyssalLight.ts, emberfall.ts`

Each theme file exports one ThemeDef, as pure data:
- palette (per sector, players, colourblind)
- display names (game title, currencies, vehicles, enemies, bosses, specials, UI terms)
- geometry recipe params (hull profiles, enemy shape family 'platonic' | 'organic' | 'mineral', emissive mask style)
- shader defines (FLOOR_MODE, SKY_MODE, fog density, heat shimmer)
- audio params (bpm, root, mode, progression, timbre presets, drum kit)

registry.ts: THEMES, DEFAULT_THEME_ID ('kernelPanic') and getTheme(id) with a fallback.

- **Exports:** THEMES, getTheme, DEFAULT_THEME_ID, KERNEL_PANIC, ABYSSAL_LIGHT, EMBERFALL
- **Depends on:** contracts, core

### `src/engine/transitions.ts, src/engine/StateMachine.ts`

transitions.ts: the frozen table of 16 edges with guards (`as const satisfies readonly Edge[]`), plus the layer and worldBelow per state.

StateMachine.ts:
- A pushdown FSM (depth <= 3) with request queue, apply-time re-validation and at most 4 applies per frame.
- Lifecycle ordering (exit/enter/onCovered/onUncovered).
- fixedUpdate, update and render dispatch.
- Calls the input clearEdges/suppress hooks after each transition.
- Throws InvalidTransitionError in strict mode.

- **Exports:** EDGES, STATE_LAYERS, StateMachine, InvalidTransitionError
- **Depends on:** contracts, core

### `src/engine/GameLoop.ts, src/engine/FramePacer.ts`

GameLoop:
- Driven by the rAF timestamp through an injected scheduler.
- Fixed 120 Hz accumulator; frame delta clamped to 0.1 s; at most 8 steps, with the backlog dropped and counted.
- timeScale multiplies the accumulator input, never dt.
- Frame order: fsm.applyPending, then fixedUpdate xN, then update, then render(alpha), then perf.record.
- resetAccumulator() is provided for resume.

FramePacer:
- Frame caps: auto, 60, 120, or uncapped.
- Estimates the display refresh from the median rAF delta.
- The 60 cap uses target-time scheduling, giving a clean 2-vsync cadence at 120 Hz.
- 'auto' drops to a 60 cap when missed vsyncs exceed 5% over 2 s while Playing.

- **Exports:** GameLoop, FramePacer, LoopHooks
- **Depends on:** contracts, core, config/tuning

### `src/engine/PerfMonitor.ts, src/engine/ResolutionGovernor.ts`

PerfMonitor: 600-frame ring buffers of frame interval, sim ms and CPU ms; p50/p95/p99, long frames (over 33 ms), missed-vsync ratio, dropped sim steps, and a program-count growth alarm (DEV error).

ResolutionGovernor, a pure policy:
- Step down: renderScale 1 -> 0.85 -> 0.72 -> 0.6, then MSAA 4 -> 2, then frame cap 60, when p95 > 16.0 ms for 1 s.
- Step up after 10 s clean.
- At most one step per 2 s, and it evaluates only while Playing.

- **Exports:** PerfMonitor, PerfSample, ResolutionGovernor, GovernorAction
- **Depends on:** contracts, core, config/quality

### `src/engine/lifecycle.ts`

installLifecycle(target: WindowLike, deps) wires blur, visibilitychange, pagehide, fullscreenchange and webglcontextlost/restored.
- Every event calls input.releaseAll().
- Pause is requested only when the top state is Playing.
- Hidden calls audio.suspend() and visible calls audio.resume().
- pagehide calls save.flush().

It is pure-typed against injected interfaces.

- **Exports:** installLifecycle, WindowLike
- **Depends on:** contracts, core

### `src/input/keyCodes.ts, defaultBindings.ts, bindingValidation.ts`

keyCodes.ts: KNOWN_CODES, FORBIDDEN_CODES (Control, Meta and Alt on both sides), RESERVED_CODES (Escape, KeyP), PREVENT_DEFAULT_EXTRA, and keycap labels.

defaultBindings.ts: DEFAULT_BINDINGS for P1 and P2, NumPad-free primaries with numpad alternates, plus the menu key sets.

bindingValidation.ts: validateBindings returns BindingError[] (forbidden, reserved, duplicate, empty, unknown). Also proposeSwap and resetInvalidActions.

- **Exports:** KNOWN_CODES, FORBIDDEN_CODES, DEFAULT_BINDINGS, MENU_KEYS, validateBindings, proposeSwap
- **Depends on:** contracts, core

### `src/input/KeyboardDevice.ts, IntentSampler.ts, MenuNavigator.ts, InputService.ts`

KeyboardDevice: capture-phase listeners on the injected target writing typed arrays (down, pressCount, lastPressSeq); the preventDefault policy; the metaKey/ctrlKey passthrough; the Meta workaround; releaseAll, suppressHeldUntilRelease, and repeat self-heal.

IntentSampler: once per sim tick fills a reusable PlayerIntent per player: SOCD last-wins, diagonal normalisation, latched edges, autofire and focus-toggle handling, and the solo merge.

MenuNavigator: global and per-player MenuIntents with 350/90 ms software repeat.

InputService: the InputPort facade (sample, pollMenu, setContext, setBindings, clearEdges, releaseAll, heldCodes, captureNextKey).

- **Exports:** KeyboardDevice, IntentSampler, MenuNavigator, createInputService
- **Depends on:** contracts, core, config, input/keyCodes, input/defaultBindings, input/bindingValidation

### `src/entities/players.ts, weapons.ts, specials.ts, projectiles.ts`

Allocation-free SimSystem functions.

players.ts: movement with accel and decel, focus slow, facing and aim-assist cone, dash with i-frames, charges and ram, arena clamp, ghost view clamp, prev-transform copy, and soft push-apart.

weapons.ts: a cadence accumulator that can fire several shots per tick; twin, spread, needle and arc weapons; split, pierce, ricochet and homing flags; card hooks.

specials.ts: Overdrive meter; Railburst, Firewall, Blink Swarm and Patch Drone with Special Tuning tiers.

projectiles.ts: linear and homing integration, lifetime, wall bounce and pool exhaustion policy. Player shots recycle the oldest; enemy shots skip spawning.

- **Exports:** stepPlayers, stepWeapons, stepSpecials, stepProjectiles, spawnProjectile
- **Depends on:** contracts, core, config

### `src/entities/pickups.ts, damage.ts, cardEffects.ts`

pickups.ts: Shard denominations, magnet pull, blink and despawn, catch-up bonus, ghost collection at 50%, and the wave-end vacuum.

damage.ts: applyDamage covers Warden arc shields, crits, Mark (+20%), armour and hit flash. Kills produce score, combo input, drops (via pickups), a kill event and a push onto world.deathQueue. Player damage covers i-frames, Nanoshield and the move to downed.

cardEffects.ts: per-tick card behaviours: Orbitals, Micro-Missiles, Afterimage trail, Chain Arc, Vampire Code, Overheat and Glass Lens, all bitmask-gated.

- **Exports:** stepPickups, spawnPickup, vacuumPickups, applyDamage, damagePlayer, stepCardEffects
- **Depends on:** contracts, core, config, entities/projectiles

### `src/entities/linkBeam.ts, revive.ts, combo.ts`

linkBeam.ts: activation band 4-14 u (range upgrades extend it), the solo Echo Drone orbit, segment damage ticks via applyDamage, and Leech latch and cut.

revive.ts: Downed crawl, bleed-out shrink per repeated down, revive progress with decay, automatic Spare Kernel use, the Offline ghost with Mark on touch, the 'no living player' kernel rule, and the wave-end reboot.

combo.ts: chain window, tiers, halving on hit, sync kills and score multiplier.

- **Exports:** stepLinkBeam, stepRevive, rebootAtWaveEnd, stepCombo
- **Depends on:** contracts, core, config, entities/damage

### `src/entities/enemies.ts, enemyBehaviors.ts, bosses.ts, bossPatterns.ts`

enemies.ts: spawnEnemy (applies wave HP scaling and the elite roll); resolveEnemyDeaths drains deathQueue for Fork splits; separation over grid neighbours (at most 6); target re-evaluation staggered by slot % 30.

enemyBehaviors.ts: a per-kind behaviour state machine: seek (Shard), telegraph-lunge (Dart), split (Fork), ring-burst (Spiker), shielded volley (Warden), latch (Leech).

bosses.ts: boss lifecycle (intro, phases at 66% and 33%, enrage, defeat); Race Condition twin-sync window; Fork Bomb splitting; Kernel phases.

bossPatterns.ts: data-driven attack primitives (ring, spiral, aimed volley, sweep beam, charge, summon) that write into enemy-shot pools and decals.

- **Exports:** spawnEnemy, stepEnemies, resolveEnemyDeaths, stepBoss, spawnBoss, runPattern
- **Depends on:** contracts, core, config, entities/projectiles, entities/damage

### `src/sim/createWorld.ts, src/sim/stepWorld.ts, src/sim/stateHash.ts`

createWorld(config, deps) allocates every pool at CAPACITY once, plus the 2 players, SpatialGrid, rng forks (sim, fx, shop), SimEvents channels, deathQueue and run counters. resetWorld reuses the same allocations. This is written in Wave 0, so tests and fixtures exist early.

stepWorld(world, intents, dt) runs the fixed system order:
1. players
2. weapons
3. specials
4. card effects
5. enemies and boss AI
6. projectiles
7. grid rebuild and collision
8. resolve deaths
9. link beam
10. pickups
11. revive
12. combo
13. WaveDirector
14. rules

stateHash: an fnv1a hash over positions, hp, wallets and the rng state, used by the determinism tests.

- **Exports:** createWorld, resetWorld, stepWorld, stateHash
- **Depends on:** contracts, core, config, entities/*, sim/collision, sim/rules, sim/WaveDirector

### `src/sim/collision.ts, src/sim/rules.ts, src/sim/WaveDirector.ts`

collision.ts: swept segment-circle tests of player shots against enemies (3x3 cell query); enemy shots against the 2 players directly; enemy contact; pickups against players; Firewall bullet deletion. Calls applyDamage.

rules.ts: wave timer and purge; the wave-clear outro (bullet wipe, invulnerability, slow-mo flag, vacuum, reboot, clear bonus); victory, extract and OVERFLOW flags; the defeat grace. Wave clear is always checked before wipe.

WaveDirector.ts: the budget formula, pulse scheduler, formation selection, farthest-portal choice, telegraphs, the 180 live cap with deferral, unlock schedule, 2P multipliers, boss wave spawning and OVERFLOW generation.

- **Exports:** stepCollision, stepRules, WaveDirector, generateWavePlan
- **Depends on:** contracts, core, config, entities/*

### `src/sim/RunSession.ts`

createRunSession(config, deps) implements RunSessionApi:
- Owns the World and per-player economy (PlayerRunState), and applies the meta snapshot and vehicle base through computeStats.
- tick(intents) calls stepWorld.
- Exposes flags, openShop() (returns a ShopModel-backed ShopApi), applyShopResults() (recomputes stats, heals by the delta) and beginNextWave().
- Exposes events plus clearEvents(), summary(outcome) and dispose().

It is the only sim module that knows about upgrades.

- **Exports:** createRunSession
- **Depends on:** contracts, core, config, sim/createWorld, sim/stepWorld, upgrades/stats, upgrades/ShopModel, upgrades/rewards

### `src/upgrades/pricing.ts, stats.ts, offers.ts`

pricing.ts: pure integer price functions: statRowPrice, cardPrice, repairPrice, kernelPrice, teamPrice, rerollPrice, metaPrice, round5 and waveInflation.

stats.ts: computeStats(vehicle, metaLevels, rowLevels, cardStacks, teamLevels, dynamicFlags) returns DerivedStats. The flat/add%/mul order and hard caps are applied, and fire-rate overflow is converted to damage. Also exports capsReached.

offers.ts: seeded card offers drawn without replacement, with rarity-by-sector weights, uniqueness and stack exclusion, fallback down to the Shard Cache, and lock carry-over.

- **Exports:** statRowPrice, cardPrice, repairPrice, kernelPrice, rerollPrice, metaPrice, computeStats, capsReached, drawOffers
- **Depends on:** contracts, core, config

### `src/upgrades/ShopModel.ts, MetaShop.ts, rewards.ts`

ShopModel: a mid-run visit. apply(tx) handles buy, undo, reroll, lock, gift and ready, with per-player LIFO logs holding snapshots, a team log that enforces teamDependency, P1-then-P2 frame processing, the open guard, snapshot() for view models, and commit().

MetaShop: pure operations on SaveDataV1: buy, respec (refunds recorded spend), unlock, and produce SaveDelta.

rewards.ts: computeRunRewards(summary) implements the Cores formula with the victory bonus and the 400 cap.

- **Exports:** ShopModel, createShopModel, MetaShop, computeRunRewards
- **Depends on:** contracts, core, config, upgrades/pricing, upgrades/stats, upgrades/offers

### `src/save/defaults.ts, migrations.ts, sanitize.ts, storage.ts, SaveStore.ts`

defaults.ts: DEFAULT_SAVE and DEFAULT_SETTINGS.

migrations.ts: MIGRATIONS, a registry mapping v to a pure v -> v+1 function, and migrate(). A test can inject its own registry.

sanitize.ts: type guards and clamping; unknown ids dropped with refunds; binding re-validation; prototype-key stripping.

storage.ts: a KeyValueStorage over localStorage, falling back to MemoryStorage, with try/catch everywhere.

SaveStore.ts implements SaveStorePort:
- load chain (main, then .bak, then defaults with the corrupt blob quarantined)
- crc check and newer-version read-only mode
- delta commit (re-read, apply, validate, write .bak then main)
- commitRun idempotency
- debounce driven by tick(nowMs)
- flush, and storage-event sync

- **Exports:** createSaveStore, DEFAULT_SAVE, migrate, sanitizeSave, createKeyValueStorage
- **Depends on:** contracts, core, config

### `src/states/BootState.ts, MainMenuState.ts, CharacterSelectState.ts`

Glue only, through Services ports; testable with fakes.

BootState: the async boot pipeline with progress (save, theme, assets.build, assets.warmup), the press-any-key gate and audio.unlock, and the fatal path.

MainMenuState: menu VM (Play, Hangar, Settings, Controls, Credits sub-panels) and the attract camera.

CharacterSelectState: drop-in join, per-player cursors, lock prices, Ready and countdown, prefill, and RunConfig creation.

- **Exports:** createBootState, createMainMenuState, createCharacterSelectState
- **Depends on:** contracts, core, config, themes, upgrades/MetaShop, states/viewModels

### `src/states/PlayingState.ts, UpgradesShopState.ts, PausedState.ts, GameOverState.ts, viewModels.ts`

PlayingState: run creation, the per-tick intents-to-tick-to-flags flow, the frame drain of SimEvents to the render, audio and HUD ports, covered/uncovered handling, and the nextWave logic.

UpgradesShopState: in midrun mode, a ShopApi driven by per-player MenuIntents plus Ready, EXTRACT or PUSH DEEPER. In meta mode, MetaShop with immediate save commits.

PausedState: menu, hold-to-confirm Abandon, settings sub-panels.

GameOverState: summary, rewards, commitRun, records, and Retry/Menu.

viewModels.ts: pure builders for HudVM, ShopVM, HangarVM, CharacterSelectVM and GameOverVM from WorldView and snapshots. HUD text is throttled to 10 Hz.

- **Exports:** createPlayingState, createUpgradesShopState, createPausedState, createGameOverState, buildHudVM, buildShopVM
- **Depends on:** contracts, core, config, themes, upgrades/MetaShop, upgrades/rewards

### `src/shaders/chunks/common.ts, noise.ts, lighting.ts, instancing.ts`

GLSL ES 3.0 snippets exported as TS strings.
- common.ts: precision, hash functions and time wrapping.
- noise.ts: value, simplex and FBM noise, Voronoi, and a noise-texture sampler.
- lighting.ts: fixed key light, fresnel, fog uniforms and the emissive floor.
- instancing.ts: attribute declarations and decode for aT (x, z, yaw, scale) and aS (flash, spawnT, tint, seed), matching INSTANCE_LAYOUT, plus linear-bullet extrapolation. Written in Wave 0.

Chunks are composed by template literals, never by mutating THREE.ShaderChunk.

- **Exports:** GLSL_COMMON, GLSL_NOISE, GLSL_LIGHTING, GLSL_INSTANCING
- **Depends on:** contracts/render

### `src/shaders/neonSurface.ts, floor.ts, sky.ts, projectile.ts, particle.ts, beam.ts, decal.ts, marker.ts, digits.ts, shockwave.ts, trail.ts`

Each module exports a ShaderSource { vertex, fragment, defines, createUniforms() } with typed uniform interfaces. Theme modes are compile-time defines fixed at Boot (FLOOR_MODE_GRID, FLOOR_MODE_CAUSTICS, FLOOR_MODE_LAVA; SKY_MODE_*), so there is never a runtime recompile.

- neonSurface: barycentric edges, fresnel, dissolve, hit flash, corrupted glitch.
- floor: grid, caustics or lava, plus 8 ripples and player pools.
- sky: nebula FBM and stars, with glyph rain, god rays or corona per theme.
- projectile: capsule SDF with velocity stretch.
- particle: analytic GPU motion (p0 + v*t + 0.5*g*t^2) with drag.
- beam: animated link, chain lightning and boss lasers.
- decal: telegraph fill progress.
- marker: constant-screen-size player marker.
- digits: 7-segment SDF damage numbers.
- shockwave: expanding rings.
- trail: ribbon fade.

- **Exports:** NEON_SURFACE, FLOOR, SKY, PROJECTILE, PARTICLE, BEAM, DECAL, MARKER, DIGITS, SHOCKWAVE, TRAIL
- **Depends on:** shaders/chunks/*

### `src/shaders/post/bloom.ts, src/shaders/post/composite.ts`

bloom.ts: a full-screen triangle vertex shader, a soft-knee bright-pass prefilter, and dual-Kawase downsample and upsample.

composite.ts: ACES tonemapping, sRGB, vignette, chromatic aberration, grain, scanlines, theme heat shimmer, dim and freeze-blur mix, hurt vignette, and a FXAA path for the low preset.

Owned by the render agent.

- **Exports:** BLOOM_PREFILTER, KAWASE_DOWN, KAWASE_UP, COMPOSITE, FULLSCREEN_VERT
- **Depends on:** shaders/chunks/common

### `src/assets/noise.ts, textures.ts, materials.ts, AssetLibrary.ts`

noise.ts: seeded CPU value, simplex and FBM noise in 2D and 3D.

textures.ts: DataTextures: 256^2 RGBA tiling noise, 64^2 hex mask, 1x256 palette ramp from the theme. Sets colorSpace, wrap and mipmaps.

materials.ts: creates every ShaderMaterial once (GLSL3), taking theme defines and a shared uniforms object (uTime, uBeat, uPalette, uRipples[8], uPlayerPos[2], uFog). The registry is frozen after Boot, and creation after Boot throws in DEV.

AssetLibrary.ts implements AssetLibraryApi:
- incremental build(onProgress) across frames
- getMaterial(key) and getGeometry(key)
- createBatches(), which allocates the InstanceBatches and GpuRingBuffers at CAPACITY
- a warm scene for ShaderWarmup
- dispose()

- **Exports:** createAssetLibrary, SharedUniforms, fbm2, simplex3
- **Depends on:** three, contracts, core, config, themes, shaders/*, render/InstanceBatch, render/GpuRingBuffer

### `src/assets/geometry/MeshBuilder.ts, vehicles.ts, enemies.ts, bosses.ts, arena.ts, fxShapes.ts, voxelFont.ts`

All generation runs only at Boot.

MeshBuilder: composes primitives, extrusions, lathes, tubes and custom BufferGeometry parts with transforms, vertex colours, emissive mask and barycentric attributes. Outputs one merged non-indexed BufferGeometry.

vehicles.ts: parametric mirrored hull profiles per vehicle, from the theme's recipe params.

enemies.ts: shape families: platonic, organic (lathe bells and tubes) and mineral (noise-displaced icospheres with seams).

bosses.ts: composite boss meshes.

arena.ts: floor plane, force-field wall band, pylons.

fxShapes.ts: quads, rings and capsules.

voxelFont.ts: a 5x7 bitmap font turned into a voxel title mesh.

- **Exports:** MeshBuilder, buildVehicleGeometry, buildEnemyGeometry, buildBossGeometry, buildArena, buildFxShapes, buildVoxelText
- **Depends on:** three, contracts, core, config, themes, assets/noise

### `src/render/Renderer.ts, PostFX.ts, ShaderWarmup.ts`

Renderer.ts:
- WebGL2 renderer: high-performance power preference, antialias false, stencil false, NoToneMapping (the composite owns tonemapping).
- Canvas sized to CSS size x min(DPR, preset cap) via a ResizeObserver with 150 ms debounce.
- Internal HalfFloat HDR target at backing size x renderScale with preset MSAA, and an RGBA8 fallback.
- Context lost/restored handling and stats().

PostFX.ts:
- Custom pipeline: MSAA resolve blit, prefilter at 1/2, 4 Kawase downsamples and 4 upsamples, then one composite.
- renderFrozen() and setPost(params).

ShaderWarmup.ts: compileAsync over the warm scene, 2 offscreen frames through PostFX, initTexture for every DataTexture, then records the program baseline.

- **Exports:** RenderSystem, createRenderSystem, PostFX, warmupShaders
- **Depends on:** three, contracts, core, config/quality, shaders/post/*

### `src/render/CameraRig.ts, cameraMath.ts, ScreenShake.ts`

cameraMath.ts, pure:
- solveMaxDistance: arena fit by 16-iteration binary search.
- solveFraming: padded point set, safe NDC box, 12-iteration binary search.
- projectToNdc and viewRectOnGround, which the sim uses to clamp the ghost.

CameraRig.ts: modes (attract, select, follow, gameover), smoothDamp with asymmetric zoom and hysteresis, the boss intro, the countdown swoop, and snapping on an aspect jump.

ScreenShake.ts: trauma model plus value noise, settings scaling and reduce-motion.

- **Exports:** CameraRig, solveFraming, solveMaxDistance, viewRectOnGround, ScreenShake
- **Depends on:** three, contracts, core, config/tuning

### `src/render/InstanceBatch.ts, src/render/GpuRingBuffer.ts`

Both written in Wave 0.

InstanceBatch:
- An InstancedBufferGeometry with an interleaved per-instance Float32Array (aT and aS, 8 floats per instance) in DynamicDrawUsage.
- instanceCount equals the active count.
- One clearUpdateRanges() plus addUpdateRange(0, count*8) per frame.
- frustumCulled false.

GpuRingBuffer:
- Write-once spawn records (particles, digits, shockwaves, decals).
- At most 2 update ranges per frame.
- Lifetime is evaluated on the GPU, and expired instances collapse to a degenerate position.

- **Exports:** InstanceBatch, GpuRingBuffer
- **Depends on:** three, contracts/render, core

### `src/render/RenderBridge.ts, scenes/ArenaScene.ts, scenes/MenuBackdrop.ts, scenes/SelectStage.ts`

RenderBridge implements RenderPort:
- attachWorld and detachWorld
- setCameraMode
- showVehiclePreviews
- consumeEvents(SimEvents), forwarded to FxDirector
- frame(alpha, frameDt): update shared uniforms, sync views, camera, render scene and post
- renderFrozen, and publishes viewRect back to the world
- applies ResolutionGovernor actions

ArenaScene: floor, sky, wall and pylons with matrixAutoUpdate off.

MenuBackdrop: attract scene with idle drones and the voxel title.

SelectStage: two turntable pedestals.

- **Exports:** createRenderBridge, ArenaScene, MenuBackdrop, SelectStage
- **Depends on:** three, contracts, core, config, themes, render/Renderer, render/PostFX, render/CameraRig, render/views/*, render/fx/*

### `src/render/views/PlayerView.ts, EnemyView.ts, BossView.ts, ProjectileView.ts, PickupView.ts, BeamView.ts, DecalView.ts, MarkerView.ts`

Each view copies read-only WorldView pools into batches with prev/current interpolation (alpha), with no allocation.

- PlayerView: 2 hull meshes, thrusters, downed core, ghost wisp, dash and special rings, shield bubble.
- EnemyView: one InstanceBatch per enemy kind (6).
- BossView: up to 3 meshes plus phase visuals.
- ProjectileView: player shots, enemy shots and missiles; linear bullets are written only on spawn and despawn, and extrapolated in the vertex shader via uAlphaDt.
- PickupView: one batch; spin and bob in the shader.
- BeamView: link beam, chain arcs and boss lasers in one batch.
- DecalView: telegraphs and contact-glow blobs.
- MarkerView: constant-size player markers plus bleed-out and revive arcs.

- **Exports:** PlayerView, EnemyView, BossView, ProjectileView, PickupView, BeamView, DecalView, MarkerView
- **Depends on:** three, contracts, core, config, render/InstanceBatch, render/GpuRingBuffer

### `src/render/fx/FxDirector.ts, ParticleSystem.ts, ShockwaveSystem.ts, TrailRenderer.ts, DamageNumbers.ts`

FxDirector maps SimEvents to particles, shockwaves, floor ripples, camera trauma, hit flashes and damage digits. It uses a separate fx rng, so visual randomness never touches the sim, and honours reduceFlashes.

ParticleSystem: an 8192-slot GpuRingBuffer with presets.

ShockwaveSystem: ring instances plus the floor ripple uniform ring.

TrailRenderer: 64-segment ribbons behind the players.

DamageNumbers: a 256-slot digit ring.

- **Exports:** FxDirector, ParticleSystem, ShockwaveSystem, TrailRenderer, DamageNumbers
- **Depends on:** three, contracts, core, config, render/GpuRingBuffer, render/CameraRig, render/ScreenShake

### `src/audio/AudioEngine.ts, VoicePool.ts, AudioEventRouter.ts`

AudioEngine implements AudioPort:
- One AudioContext with latencyHint 'interactive'. unlock() on the first gesture is idempotent and survives Safari's 'interrupted' state.
- Graph: master -> DynamicsCompressor limiter (threshold -6 dB, ratio 12) -> destination; music, sfx and ui buses; a reverb send.
- setMood, setIntensity, setVolumes, duck, suspend and resume.
- beatPhase is derived from ctx.currentTime and drives the shaders.
- play() is a no-op before unlock.

VoicePool: 32 permanent channel strips (Gain -> StereoPanner). Category limits: weapon 8, impact 6, explosion 6, pickup 4, player 4, ui 2, stinger 2. Steals the oldest voice in the category, coalesces the same id within 25 ms, and reclaims voices lazily by endTime. Pure scheduling logic with an injected clock.

AudioEventRouter: maps SimEvents to play() with pan from the screen x position and a pickup pitch ladder by combo.

- **Exports:** createAudioEngine, VoicePool, AudioEventRouter
- **Depends on:** contracts, core, config, themes, audio/SfxBank, audio/Sequencer, audio/Composer, audio/reverb

### `src/audio/SfxBank.ts, sfxRecipes.ts, synth.ts, reverb.ts`

synth.ts: primitives: ADSR on AudioParam, oscillator and FM voices, noise buffers (white, pink, brown), filter sweeps, a WaveShaper curve.

sfxRecipes.ts: about 30 recipes, each x3 variants, parameterised by theme timbre: lasers per weapon, enemy shot, hit, crit, small/large/boss explosions, shard, repair, power-up, dash, each special, hurt, downed, revive, wave start and clear, boss roar, portal, UI move/confirm/back/buy/deny.

SfxBank: pre-renders every recipe through OfflineAudioContext in parallel at unlock, into AudioBuffers. Each play() then creates exactly one AudioBufferSourceNode.

reverb.ts: procedural impulse response (decaying filtered noise) for a ConvolverNode.

- **Exports:** SfxBank, SFX_RECIPES, envelope, fmVoice, makeNoiseBuffer, makeImpulseResponse
- **Depends on:** contracts, core, themes

### `src/audio/theory.ts, Composer.ts, Sequencer.ts, instruments.ts`

theory.ts (pure): midi to frequency, scales and modes, chord progressions, sector key shifts.

Composer.ts (pure, seeded): per-bar patterns for pad, bass, arpeggio, drums and lead, with intensity-layer gating and mood variants (menu, combat, boss, shop, gameover, victory, silent).

Sequencer.ts: lookahead scheduler (setInterval 25 ms plus a rAF tick, 0.2 s horizon) on the AudioContext clock. Creates short-lived oscillator, filter and gain nodes per note, with at most about 40 live and an explicit stop() on each. Handles the sidechain duck automation.

instruments.ts: saw pad, sub bass, FM arpeggio, 808 kick, noise hat and snare, square lead, all configured by theme timbre presets.

- **Exports:** midiToHz, SCALES, progression, Composer, Sequencer, INSTRUMENTS
- **Depends on:** contracts, core, themes, audio/synth

### `src/ui/UIRoot.ts, dom.ts, format.ts, Toasts.ts, styles/base.css, styles/hud.css, styles/screens.css`

UIRoot implements UiPort (show, update, hide, toast, flush). Screens are built once and toggled; update diffs view models; flush applies writes once per frame. Mouse clicks become MenuIntents through a callback.

dom.ts: an h() builder and a TextSlot with diffed textContent. No innerHTML anywhere.

format.ts: pure number, time and price formatters.

Toasts: a queue of 3.

CSS: palette variables fed from the theme at Boot, a system monospace stack, transform/opacity-only animation, prefers-reduced-motion, and `contain: strict` on the HUD root.

- **Exports:** createUiRoot, h, TextSlot, formatShards, formatTime, Toasts
- **Depends on:** contracts, core

### `src/ui/widgets/Meter.ts, KeyCap.ts, MenuList.ts, ShopPanel.ts, src/ui/hud/Hud.ts, PlayerPanel.ts, BossBar.ts, WaveBanner.ts`

Widgets:
- Meter: a transform:scaleX bar.
- KeyCap: a live keycap for the Key Test and control hints.
- MenuList: a cursor list with per-player cursors.
- ShopPanel: one player's column: stat rows, cards with Buy/Lock columns, team row, reroll, gift, ready. Shows price colouring and MAX, CAPPED and SOLD OUT states, with a deny shake and a buy flash.

HUD (text at most 10 Hz, only on change; bars every frame via transforms; no layout reads):
- Hud: the root.
- PlayerPanel: HP, dash pips, Overdrive ring, wallet, combo tier, kernels.
- BossBar.
- WaveBanner: countdown, sector and wave, CLEAR, SYNC popups.

- **Exports:** Meter, KeyCap, MenuList, ShopPanel, Hud, PlayerPanel, BossBar, WaveBanner
- **Depends on:** contracts, core, ui/dom, ui/format

### `src/ui/screens/BootScreen.ts, MainMenuScreen.ts, SettingsPanel.ts, ControlsPanel.ts, CharacterSelectScreen.ts, ShopScreen.ts, HangarScreen.ts, PauseScreen.ts, GameOverScreen.ts`

Dumb views over ScreenVMs.
- BootScreen: progress, fatal error, 'Press any key'.
- MainMenuScreen.
- SettingsPanel: volumes, quality, frame cap, shake, reduce flashes and motion, colourblind, autofire and focus mode per player, theme (which applies on reload), FPS.
- ControlsPanel: the rebinding list, the capture-next-key flow with swap offer, and the Key Test rollover diagram.
- CharacterSelectScreen: two slots with stat bars, lock prices and join/ready.
- ShopScreen: two ShopPanels, a shared team strip and the EXTRACT/PUSH DEEPER banner.
- HangarScreen: Firmware, unlocks, respec.
- PauseScreen: hold-to-confirm Abandon.
- GameOverScreen: per-player table, MVP, Cores breakdown, new best, Retry/Menu.

- **Exports:** BootScreen, MainMenuScreen, SettingsPanel, ControlsPanel, CharacterSelectScreen, ShopScreen, HangarScreen, PauseScreen, GameOverScreen
- **Depends on:** contracts, core, ui/dom, ui/format, ui/widgets/*

### `src/app/Game.ts, src/app/createServices.ts, src/app/errorOverlay.ts`

createServices: the only module touching browser globals. It builds the Renderer/RenderBridge, AssetLibrary, UIRoot, InputService(window), AudioEngine, SaveStore(localStorage with fallback), clock, logger and seed source. createRun is bound to createRunSession.

Game.ts, the composition root:
- builds the 7 states and the StateMachine with EDGES
- GameLoop plus FramePacer, installLifecycle and PerfMonitor/Governor wiring
- installs devApi when DEV or ?debug=1
- start() and dispose()

errorOverlay.ts: window.onerror and unhandledrejection fatal overlay with a Reload button.

- **Exports:** createGame, GameHandle, createServices, installErrorOverlay
- **Depends on:** all layers

### `src/debug/devApi.ts, DebugOverlay.ts, Autopilot.ts`

Active only in DEV or with ?debug=1; tree-shaken otherwise.

devApi.ts: window.__game exposes:
- state() and goto(stateId)
- perf.sample(ms) returning {avgFps, p50, p95, p99, longFrames, cpuP95, drawCalls, programs}
- stress({enemies, shots, particles}), autopilot(on), cycleRuns(n)
- inputProbe() returning keydown-to-sim-reaction ms
- giveShards(p, n), setWave(w), godMode(on), setSeed(n)
- rendererInfo(), audioStats(), shaderErrors()

DebugOverlay: FPS, p99, draw calls, triangles, programs, voices and governor step.

Autopilot: scripted PlayerIntents that kite and shoot for the soak and stress tests.

- **Exports:** installDevApi, DebugTargets, DebugOverlay, Autopilot
- **Depends on:** contracts, core, engine/PerfMonitor

### `tests/helpers/fakeClock.ts, fakeKeyboard.ts, memoryStorage.ts, fakePorts.ts, scriptedIntents.ts, worldFixture.ts; tests/fixtures/saves/v1-valid.json, v1-overleveled.json, future-v99.json, corrupt.txt`

Helpers, all conforming to the contracts:
- FakeClock and FakeScheduler.
- FakeKeyTarget with dispatch({code, repeat, metaKey, ctrlKey, isComposing}).
- MemoryStorage, which can be set to throw QuotaExceeded or SecurityError.
- Fake ports that record calls: FakeRenderPort, FakeUiPort, NullAudio, FakeAssets, a SpyState that records lifecycle calls, and FakeRunSession.
- Seeded scripted intent sequences.
- createTestWorld(seed) via createWorld.

Save fixtures cover migration, sanitisation and fallback.

- **Exports:** as named
- **Depends on:** contracts, core, sim/createWorld

### `tests/**/*.test.ts (core, engine, input, entities, sim, upgrades, save, audio, assets, render, ui, states)`

Vitest suites in the node environment. Each wave-owner writes the tests for its own area; the testingPlan lists what each covers. Procgen geometry tests run three's math and geometry in node without WebGL.

- **Exports:** n/a
- **Depends on:** the modules under test, plus tests/helpers

## 9. Key interfaces

```ts
// ===== contracts/ids.ts =====
export const PLAYER_INDICES = [0, 1] as const; export type PlayerIndex = (typeof PLAYER_INDICES)[number];
export const VEHICLE_IDS = ['lancer','bulwark','specter','tinker'] as const; export type VehicleId = (typeof VEHICLE_IDS)[number];
export const ENEMY_KINDS = ['shard','dart','fork','spiker','warden','leech'] as const; export type EnemyKind = (typeof ENEMY_KINDS)[number];
export const BOSS_IDS = ['forkBomb','raceCondition','kernel'] as const; export type BossId = (typeof BOSS_IDS)[number];
export const THEME_IDS = ['kernelPanic','abyssalLight','emberfall'] as const; export type ThemeId = (typeof THEME_IDS)[number];
export type StatRowId = 'thrusters'|'plating'|'overclock'|'payload'|'magnet'|'coolant'|'capacitor'|'specialTuning';
export type CardId = 'splitShot'|'overdriveBattery'|'bounty'|'pierce'|'afterimage'|'doubleBuffer'|'vampireCode'|'overheat'|'ricochet'|'chainArc'|'microMissiles'|'nanoshield'|'orbitals'|'glassLens'|'forkCall'|'sudo'|'rootAccess'|'shardCache';
export type TeamItemId = 'spareKernel'|'linkAmp'|'linkRange'|'reviveProtocol';
export type MetaUpgradeId = 'hullFw'|'bootCache'|'rerollCache'|'magnetFw'|'overclockFw'|'fieldMedic'|'preCharge'|'secondBoot'|'legendaryPool';
export type EntityHandle = number; // slot*256 + generation

// ===== contracts/states.ts =====
export const STATE_IDS = ['Boot','MainMenu','CharacterSelect','Playing','UpgradesShop','Paused','GameOver'] as const;
export type StateId = (typeof STATE_IDS)[number];
export type RunOutcome = 'defeat' | 'victory' | 'abandoned';
export interface LoadoutPick { readonly player: PlayerIndex; readonly vehicle: VehicleId }
export interface StatePayloads {
  Boot: undefined; MainMenu: undefined;
  CharacterSelect: { readonly prefill: readonly LoadoutPick[] | null };
  Playing: { readonly config: RunConfig };
  UpgradesShop: { readonly mode: 'midrun' } | { readonly mode: 'meta' };
  Paused: { readonly reason: 'user' | 'blur' | 'hidden' | 'fullscreen' | 'contextlost' };
  GameOver: { readonly outcome: RunOutcome };
}
export type PayloadArg<S extends StateId> = StatePayloads[S] extends undefined ? [] : [StatePayloads[S]];
export type StackOp = 'replace' | 'push' | 'pop';
export interface Edge { readonly from: StateId; readonly to: StateId; readonly op: StackOp; readonly guard?: (payload: unknown, stack: readonly StateId[]) => boolean }
export interface GameState<S extends StateId = StateId> {
  readonly id: S; readonly layer: 'base' | 'overlay'; readonly worldBelow: 'frozen' | 'none';
  enter(payload: StatePayloads[S], from: StateId | null): void; // sync; async work polled in update()
  exit(to: StateId): void;
  onCovered?(by: StateId): void; onUncovered?(from: StateId): void;
  fixedUpdate?(dt: number): void;              // top of stack only, 1/120 s
  update(frameDt: number): void;               // top of stack only
  render?(alpha: number, frameDt: number): void; // topmost live state only
}
export interface StateMachineApi { request<S extends StateId>(to: S, ...payload: PayloadArg<S>): boolean; readonly top: StateId; readonly stack: readonly StateId[] }

// ===== contracts/input.ts =====
export type KeyCode = string; // validated against KNOWN_CODES
export const ACTIONS = ['up','down','left','right','fire','dash','special'] as const; export type Action = (typeof ACTIONS)[number];
export type PlayerBindings = Readonly<Record<Action, readonly KeyCode[]>>;
export interface Bindings { readonly players: readonly [PlayerBindings, PlayerBindings]; readonly pause: readonly KeyCode[] }
export interface PlayerIntent { moveX: number; moveZ: number; fireHeld: boolean; focusHeld: boolean; dashPressed: boolean; specialPressed: boolean } // mutable, reused
export type MenuIntentKind = 'up'|'down'|'left'|'right'|'confirm'|'back'|'ready'|'pause';
export interface MenuIntent { readonly player: PlayerIndex | 'any'; readonly kind: MenuIntentKind }
export interface KeyEventLike { readonly code: string; readonly repeat: boolean; readonly metaKey: boolean; readonly ctrlKey: boolean; readonly isComposing: boolean; preventDefault(): void }
export interface KeyEventTargetLike { addEventListener(t: 'keydown'|'keyup', f: (e: KeyEventLike) => void, o: { capture: true }): void; removeEventListener(t: 'keydown'|'keyup', f: (e: KeyEventLike) => void, o: { capture: true }): void }
export interface InputPort {
  sample(p: PlayerIndex, out: PlayerIntent): void;          // once per sim tick; consumes edges
  pollMenu(frameDtMs: number, out: MenuIntent[]): number;   // once per frame; returns count
  setContext(c: 'menu' | 'gameplay' | 'rebind'): void; setSolo(solo: boolean): void;
  setBindings(b: Bindings): void; setFireModes(autofire: readonly [boolean, boolean], focusToggle: readonly [boolean, boolean]): void;
  clearEdges(): void; releaseAll(): void; suppressHeldUntilRelease(): void;
  readonly heldCodes: ReadonlySet<KeyCode>; captureNextKey(cb: (code: KeyCode | null) => void): void;
}

// ===== contracts/sim.ts (no three) =====
export interface Kinematic { x: number; z: number; prevX: number; prevZ: number; yaw: number; prevYaw: number; vx: number; vz: number }
export type LifeState = 'alive' | 'downed' | 'offline' | 'absent';
export type NumericStat = 'maxHp'|'moveSpeed'|'fireRate'|'damageMul'|'projectiles'|'spreadDeg'|'pierce'|'bounces'|'projectileSpeed'|'critChance'|'magnetRadius'|'dashCooldown'|'dashCharges'|'specialChargeMul'|'specialTier'|'shardGain'|'linkDps'|'linkRange'|'reviveTime'|'reviveHpFrac'|'armor';
export type DerivedStats = Record<NumericStat, number>;
export interface PlayerEntity extends Kinematic { readonly index: PlayerIndex; vehicle: VehicleId; life: LifeState; hp: number; stats: DerivedStats;
  cardStacks: Uint8Array; cardMask: number; invulnUntil: number; dashTimer: number; dashCooldown: number; dashCharges: number; fireAcc: number;
  overdrive: number; bleedLeft: number; downsThisWave: number; reviveProgress: number; aimX: number; aimZ: number; markTimer: number;
  score: number; kills: number; damageDealt: number; revives: number; combo: number; comboTimer: number }
export interface EnemyEntity extends Kinematic { slot: number; gen: number; kind: EnemyKind; elite: boolean; hp: number; maxHp: number; radius: number;
  ai: number; aiTimer: number; target: PlayerIndex; flash: number; spawnT: number; seed: number; latched: number; markedUntil: number }
export interface ProjectileEntity { slot: number; gen: number; x: number; z: number; prevX: number; prevZ: number; vx: number; vz: number; spawnTick: number;
  damage: number; radius: number; pierce: number; bounces: number; life: number; owner: PlayerIndex | -1; kind: number; homing: EntityHandle; crit: boolean }
export interface PickupEntity { slot: number; gen: number; x: number; z: number; prevX: number; prevZ: number; value: number; age: number; magnetTo: PlayerIndex | -1 }
export interface BossEntity extends Kinematic { id: BossId; part: number; hp: number; maxHp: number; phase: 0 | 1 | 2; patternStep: number; patternTimer: number; alive: boolean; syncDeathTick: number }
export interface LinkState { active: boolean; ax: number; az: number; bx: number; bz: number; cut: boolean; droneX: number; droneZ: number }
export interface RunCounters { wave: number; sector: 1|2|3; overflow: boolean; phase: 'countdown'|'combat'|'boss'|'purge'|'clearOutro'|'done';
  waveTimer: number; wallets: [number, number]; shardsEarned: [number, number]; spareKernels: number; bossesKilled: number; wavesCleared: number; victoryAchieved: boolean; timeScaleRequest: number }
export interface PoolView<T> { readonly active: readonly T[]; readonly count: number }
export interface WorldView { readonly tick: number; readonly time: number; readonly players: readonly [Readonly<PlayerEntity>, Readonly<PlayerEntity>];
  readonly enemies: PoolView<Readonly<EnemyEntity>>; readonly playerShots: PoolView<Readonly<ProjectileEntity>>; readonly enemyShots: PoolView<Readonly<ProjectileEntity>>;
  readonly pickups: PoolView<Readonly<PickupEntity>>; readonly bosses: readonly Readonly<BossEntity>[]; readonly link: Readonly<LinkState>; readonly run: Readonly<RunCounters>; readonly events: SimEvents }
export interface WorldState extends WorldView { /* mutable: pools as EntityPool<T>, grid: SpatialGrid, rng: {sim, shop}, deathQueue: Int32Array ring, viewRect: {minX,maxX,minZ,maxZ} (written by RenderBridge each frame) */ }
export type SimSystem = (w: WorldState, intents: readonly [PlayerIntent, PlayerIntent], dt: number) => void;

// ===== contracts/simEvents.ts (preallocated structs, drained once per frame) =====
export interface SimEvents {
  shot: EventChannel<{ owner: PlayerIndex; x: number; z: number; vehicle: VehicleId }>;
  enemyShot: EventChannel<{ x: number; z: number; boss: boolean }>;
  hit: EventChannel<{ x: number; z: number; amount: number; crit: boolean; target: 0 | 1 | 2 /* enemy|player|shield */ }>;
  kill: EventChannel<{ kind: EnemyKind; x: number; z: number; by: PlayerIndex | -1 | 2 /* link */; elite: boolean; combo: number }>;
  explosion: EventChannel<{ x: number; z: number; radius: number; power: number }>;
  pickup: EventChannel<{ player: PlayerIndex; value: number; x: number; z: number; combo: number }>;
  player: EventChannel<{ player: PlayerIndex; what: 'hurt'|'downed'|'revived'|'offline'|'kernel'|'dash'|'special'|'reboot'; amount: number }>;
  wave: EventChannel<{ what: 'countdown'|'start'|'purge'|'cleared'|'bossSpawn'|'bossPhase'|'bossDead'|'sync'|'comboTier'; wave: number; value: number }>;
  telegraph: EventChannel<{ shape: 0 | 1 /* ring|line */; x: number; z: number; dirX: number; dirZ: number; size: number; duration: number }>;
}

// ===== contracts/run.ts =====
export interface RunConfig { readonly runId: string; readonly seed: number; readonly players: readonly LoadoutPick[] /* 1|2 */; readonly meta: Readonly<Partial<Record<MetaUpgradeId, number>>>;
  readonly autofire: readonly [boolean, boolean]; readonly focusToggle: readonly [boolean, boolean]; readonly themeId: ThemeId }
export interface RunFlags { readonly pauseRequested: boolean; readonly waveClearReady: boolean; readonly defeat: boolean; readonly extractReady: boolean }
export interface PlayerRunSummary { readonly player: PlayerIndex; readonly vehicle: VehicleId; readonly score: number; readonly kills: number; readonly damage: number; readonly shards: number; readonly revives: number }
export interface RunSummary { readonly runId: string; readonly outcome: RunOutcome; readonly waveReached: number; readonly wavesCleared: number; readonly bossesKilled: number;
  readonly victoryAchieved: boolean; readonly shardsEarnedTotal: number; readonly durationS: number; readonly totalScore: number; readonly players: readonly PlayerRunSummary[]; readonly mvp: PlayerIndex | null }
export interface ShopApi { apply(tx: ShopTx): PurchaseResult; snapshot(): ShopVisitSnapshot; readonly allReady: boolean; readonly finalVisit: boolean; choose(c: 'extract' | 'pushDeeper'): void; commit(): void }
export interface RunSessionApi { readonly world: WorldView; readonly flags: RunFlags; tick(intents: readonly [PlayerIntent, PlayerIntent]): void;
  openShop(): ShopApi; applyShopResults(): void; beginNextWave(): void; clearEvents(): void; setViewRect(minX: number, maxX: number, minZ: number, maxZ: number): void;
  summary(outcome: RunOutcome): RunSummary; dispose(): void }

// ===== contracts/upgrades.ts =====
export interface StatModifier { readonly stat: NumericStat; readonly op: 'flat' | 'add' | 'mul'; readonly value: number }
export interface StatRowDef { readonly id: StatRowId; readonly maxLevel: number; readonly base: number; readonly growth: number; readonly perLevel: readonly StatModifier[] }
export type Rarity = 'C' | 'U' | 'R' | 'L';
export interface CardDef { readonly id: CardId; readonly bit: number; readonly rarity: Rarity; readonly stackMax: number; readonly unique: boolean; readonly requiresMeta?: MetaUpgradeId; readonly modifiers: readonly StatModifier[]; readonly effectFlag: number }
export interface TeamItemDef { readonly id: TeamItemId; readonly prices: readonly number[] | 'kernel'; readonly perVisit: number; readonly holdCap?: number; readonly modifiers: readonly StatModifier[] }
export interface MetaUpgradeDef { readonly id: MetaUpgradeId; readonly prices: readonly number[]; readonly modifiers: readonly StatModifier[] }
export interface PlayerRunState { wallet: number; hp: number; maxHp: number; rows: Record<StatRowId, number>; cards: Uint8Array; repairsThisVisit: number }
export type ShopTx =
  | { kind: 'buyRow'; player: PlayerIndex; id: StatRowId } | { kind: 'buyCard'; player: PlayerIndex; slot: 0 | 1 | 2 }
  | { kind: 'buyTeam'; player: PlayerIndex; id: TeamItemId } | { kind: 'repair'; player: PlayerIndex }
  | { kind: 'reroll' | 'undo' | 'toggleReady'; player: PlayerIndex } | { kind: 'lock'; player: PlayerIndex; slot: 0 | 1 | 2 } | { kind: 'gift'; from: PlayerIndex };
export type PurchaseFailure = 'funds'|'maxLevel'|'capped'|'soldOut'|'unavailable'|'absent'|'fullHp'|'visitLimit'|'heldCap'|'alreadyOwned'|'nothingToUndo'|'teamDependency'|'guard'|'invalid';
export type PurchaseResult = { readonly ok: true; readonly price: number; readonly balance: number; readonly txId: number } | { readonly ok: false; readonly reason: PurchaseFailure };
export interface TxLogEntry { readonly id: number; readonly actor: PlayerIndex; readonly tx: ShopTx; readonly pricePaid: number; readonly snapshot: PlayerRunState; readonly partnerSnapshot?: PlayerRunState; readonly teamSnapshot?: { kernels: number; team: Record<TeamItemId, number> }; readonly refundable: boolean }

// ===== contracts/save.ts =====
export interface Settings { readonly master: number; readonly music: number; readonly sfx: number; readonly quality: 'low'|'medium'|'high'|'ultra'; readonly frameCap: 'auto'|60|120|'uncapped';
  readonly screenShake: number; readonly reduceFlashes: boolean; readonly reduceMotion: boolean; readonly colorblind: boolean; readonly autofire: readonly [boolean, boolean]; readonly focusToggle: readonly [boolean, boolean]; readonly showFps: boolean; readonly themeId: ThemeId }
export interface SaveDataV1 { readonly cores: number; readonly lifetimeCores: number; readonly meta: Readonly<Partial<Record<MetaUpgradeId, number>>>; readonly firmwareSpent: Readonly<Partial<Record<MetaUpgradeId, number>>>;
  readonly unlocks: readonly VehicleId[]; readonly settings: Settings; readonly bindings: Bindings; readonly lastLoadout: readonly LoadoutPick[];
  readonly records: { readonly runs: number; readonly victories: number; readonly bestWave: number; readonly bestScore: number; readonly leaderboard: readonly { score: number; wave: number; date: number; players: 1 | 2; vehicles: readonly VehicleId[] }[] };
  readonly lastCommittedRunId: string | null }
export const CURRENT_SAVE_VERSION = 1;
export interface SaveEnvelope { readonly v: number; readonly ts: number; readonly rev: number; readonly crc: number; readonly data: unknown }
export type Migration = (data: unknown) => unknown; // MIGRATIONS: Readonly<Record<number, Migration>> (v -> v+1)
export interface SaveDelta { readonly coresDelta?: number; readonly meta?: Partial<Record<MetaUpgradeId, number>>; readonly spentDelta?: Partial<Record<MetaUpgradeId, number>>; readonly unlock?: VehicleId;
  readonly settings?: Partial<Settings>; readonly bindings?: Bindings; readonly lastLoadout?: readonly LoadoutPick[]; readonly run?: RunSummary }
export type SaveStatus = 'ok' | 'restoredBackup' | 'reset' | 'readOnlyFuture' | 'memoryOnly';
export interface KeyValueStorage { get(k: string): string | null; set(k: string, v: string): void; remove(k: string): void }
export interface SaveStorePort { load(): { data: SaveDataV1; status: SaveStatus }; readonly data: SaveDataV1;
  commit(d: SaveDelta): Result<SaveDataV1, 'quota' | 'unavailable' | 'readOnly'>; commitRun(runId: string, d: SaveDelta): Result<SaveDataV1, 'quota' | 'unavailable' | 'readOnly' | 'duplicate'>;
  commitDebounced(d: SaveDelta): void; tick(nowMs: number): void; flush(): void; onExternalChange(cb: (d: SaveDataV1) => void): () => void }

// ===== contracts/audio.ts =====
export type SfxId = 'laser'|'laserHeavy'|'needle'|'arc'|'enemyShot'|'hit'|'crit'|'shieldBlock'|'explodeS'|'explodeL'|'explodeBoss'|'shard'|'repair'|'powerUp'|'dash'|'railburst'|'firewall'|'blink'|'patchDrone'|'hurt'|'downed'|'revive'|'kernel'|'waveStart'|'waveClear'|'bossRoar'|'portal'|'sync'|'uiMove'|'uiConfirm'|'uiBack'|'uiBuy'|'uiDeny';
export type SfxCategory = 'weapon'|'impact'|'explosion'|'pickup'|'player'|'ui'|'stinger';
export type MusicMood = 'silent'|'menu'|'select'|'combat'|'boss'|'shop'|'paused'|'gameover'|'victory';
export interface AudioPort { unlock(): Promise<void>; readonly unlocked: boolean; play(id: SfxId, pan?: number, gain?: number, detuneCents?: number): void;
  consumeEvents(e: SimEvents): void; setMood(m: MusicMood): void; setIntensity(x: number): void; setSector(s: 1 | 2 | 3): void; duck(on: boolean): void;
  setVolumes(master: number, music: number, sfx: number): void; readonly beatPhase: number; suspend(): Promise<void>; resume(): Promise<void>;
  stats(): { voices: number; stolen: number; coalesced: number; ctxState: string } }

// ===== contracts/render.ts (three-free) =====
export type CameraMode = 'attract' | 'select' | 'follow' | 'gameover';
export const INSTANCE_LAYOUT = { stride: 8, aT: 0 /* x,z,yaw,scale */, aS: 4 /* flash,spawnT,tint,seed */ } as const;
export type MaterialKey = 'neonSurface'|'neonSurfaceInstanced'|'floor'|'sky'|'wall'|'projectile'|'particle'|'beam'|'decal'|'marker'|'digits'|'shockwave'|'trail';
export type GeometryKey = `vehicle:${VehicleId}` | `enemy:${EnemyKind}` | `boss:${BossId}:${number}` | 'arena:floor' | 'arena:wall' | 'arena:pylon' | 'fx:quad' | 'fx:ring' | 'fx:capsule' | 'title';
export interface RenderStats { calls: number; triangles: number; programs: number; geometries: number; textures: number; renderScale: number; msaa: number }
export interface AssetLoaderPort { build(onProgress: (p: number) => void): Promise<void>; warmup(): Promise<void> }
export interface RenderPort { attachWorld(w: WorldView, setViewRect: RunSessionApi['setViewRect']): void; detachWorld(): void; setCameraMode(m: CameraMode): void;
  showVehiclePreviews(sel: readonly [VehicleId | null, VehicleId | null]): void; consumeEvents(e: SimEvents): void; setSector(s: 1 | 2 | 3): void; setBeat(phase: number): void;
  frame(alpha: number, frameDt: number): void; renderFrozen(dim: number): void; setQuality(q: Settings['quality']): void; stats(): RenderStats }

// ===== contracts/ui.ts =====
export type ScreenId = 'boot'|'mainMenu'|'characterSelect'|'hud'|'shop'|'hangar'|'pause'|'gameOver';
export interface ShopRowVM { readonly id: string; readonly label: string; readonly blurb: string; readonly level: number; readonly maxLevel: number; readonly price: number | null; readonly status: 'available'|'unaffordable'|'maxed'|'capped'|'soldOut'|'locked'|'owned' }
export interface ShopPanelVM { readonly player: PlayerIndex; readonly wallet: number; readonly rows: readonly ShopRowVM[]; readonly cards: readonly (ShopRowVM & { locked: boolean })[]; readonly team: readonly ShopRowVM[];
  readonly cursor: { row: number; col: 0 | 1 }; readonly ready: boolean; readonly canUndo: boolean; readonly lastResult: PurchaseResult | null }
export interface ScreenVMs { boot: BootVM; mainMenu: MainMenuVM; characterSelect: CharacterSelectVM; hud: HudVM; shop: ShopVM; hangar: HangarVM; pause: PauseVM; gameOver: GameOverVM }
export interface UiPort { show<S extends ScreenId>(s: S, vm: ScreenVMs[S]): void; update<S extends ScreenId>(s: S, vm: ScreenVMs[S]): void; hide(s: ScreenId): void;
  toast(msg: string, kind: 'info' | 'warn' | 'error'): void; onPointerIntent(cb: (i: MenuIntent & { screen: ScreenId; itemId?: string }) => void): () => void; flush(): void }

// ===== contracts/theme.ts =====
export interface ThemeDef { readonly id: ThemeId; readonly title: string;
  readonly names: { readonly runCurrency: string; readonly metaCurrency: string; readonly shop: string; readonly meta: string; readonly lives: string;
    readonly vehicles: Readonly<Record<VehicleId, string>>; readonly enemies: Readonly<Record<EnemyKind, string>>; readonly bosses: Readonly<Record<BossId, string>> };
  readonly palette: { readonly p1: number; readonly p2: number; readonly p2Colorblind: number; readonly enemyShot: number; readonly sectors: readonly [SectorPalette, SectorPalette, SectorPalette] };
  readonly geometry: { readonly enemyFamily: 'platonic' | 'organic' | 'mineral'; readonly hullStyle: 'sled' | 'sub' | 'tug'; readonly emissiveMask: 'edges' | 'spots' | 'seams' };
  readonly shading: { readonly floorMode: 'GRID' | 'CAUSTICS' | 'LAVA'; readonly skyMode: 'NEBULA_GLYPHS' | 'ABYSS_RAYS' | 'CORONA'; readonly fogDensity: number; readonly heatShimmer: number; readonly minEmissive: number };
  readonly audio: { readonly bpm: number; readonly rootMidi: number; readonly mode: 'aeolian' | 'dorian' | 'phrygian'; readonly progression: readonly number[]; readonly sectorKeyShift: readonly [number, number, number]; readonly timbre: 'synthwave' | 'abyssal' | 'industrial' } }

// ===== contracts/services.ts =====
export interface LoopControl { resetAccumulator(): void; setTimeScale(s: number): void; readonly simTick: number }
export interface SessionStore { current: RunSessionApi | null; lastPicks: readonly LoadoutPick[] | null }
export interface Services { readonly fsm: StateMachineApi; readonly input: InputPort; readonly audio: AudioPort; readonly render: RenderPort; readonly ui: UiPort;
  readonly save: SaveStorePort; readonly assets: AssetLoaderPort; readonly session: SessionStore; readonly createRun: (c: RunConfig) => RunSessionApi;
  readonly loop: LoopControl; readonly theme: () => ThemeDef; readonly clock: { now(): number }; readonly log: Logger; readonly newSeed: () => number; readonly newRunId: () => string }
```

## 10. Performance plan

TARGETS (M3 Pro; 3024x1964; DPR 2; ProMotion 120 Hz)
- 60 FPS is a hard floor (p99 frame interval <= 20 ms, 0 long frames over 33 ms after the first 2 s of a wave), with 120 FPS as the norm in Auto mode.
- Stress load: 180 enemies, 2,048 projectiles, 8,192 particles, both players, a boss and link beams.
- CPU per 120 Hz frame: <= 3 ms (sim step <= 0.8 ms, view sync <= 0.8 ms, GL submit <= 1 ms). At a 60 Hz cap, 2 sim steps give <= 4 ms.
- GPU <= 7 ms at the High preset.
- Draw calls <= 60 (expected about 38 scene + 11 post). Triangles <= 300k. Shader programs <= 24, all compiled at Boot.
- Zero new programs, geometries or textures after Boot, and zero steady-state GC.

1. TIMESTEP
- Fixed SIM_DT = 1/120 with an accumulator fed by the rAF timestamp delta, clamped to 0.1 s.
- At most 8 steps per frame; the rest of the backlog is dropped and counted, which gives momentary slow-motion instead of a spiral of death.
- Rendering interpolates prev and current state with alpha.
- Why 120 Hz: it matches ProMotion 1:1 (no zero-step frames), halves input sampling latency to 8.3 ms, and reduces tunnelling.
- The sim budget allows 2 steps per frame at a 60 Hz cap.
- FramePacer 'auto' renders at the display rate and falls back to a 60 cap (target-time scheduling for a clean 2-vsync cadence) when missed vsyncs exceed 5% over 2 s.
- timeScale (slow-motion) multiplies the accumulator input, never dt, so the sim stays deterministic.

2. ZERO ALLOCATION IN HOT PATHS
- Preallocated monomorphic EntityPools with dense swap-remove arrays.
- SimEvents are EventChannels of preallocated structs, drained once per frame.
- The SpatialGrid uses counting sort into Int32Arrays, and queries write into scratch arrays.
- Math uses out-params; scratch Vector3/Matrix4 live at module scope.
- Hot paths use indexed loops only: no map, filter, forEach, spread, closures or template strings. A lint rule plus the critic checklist enforce this.
- Card ownership is a bitmask.
- audio.play takes positional args.
- HUD strings are rebuilt only when a value changes.
- Verification: the smoke test samples performance.memory (Chromium) and requires heap sawtooth under 2 MB over 60 s of stress, plus a 10-minute soak with no heap growth.

3. DRAW-CALL BUDGET
- Enemy InstanceBatches, one per kind: 6.
- Player shots, enemy shots and missiles: 3.
- Pickups: 1. Decals and telegraphs: 1. Beams (link, arcs, boss lasers, drone): 1.
- GPU ring buffers: particles 1, shockwaves 1, digits 1.
- Markers: 1. Players: 2. Shields: 1. Trails: 2. Boss: up to 3. Arena (floor, sky, wall, pylons): 4.
- Instances carry 2 x vec4 (32 B) instead of a mat4 (64 B), with a single addUpdateRange per batch per frame.
- Linear bullets are written only on spawn and despawn and extrapolated in the vertex shader.
- Pickups and props spin in the shader.
- frustumCulled = false on batches (the arena is always in view). matrixAutoUpdate = false on static props.
- No shadow maps (contact-glow decals instead). No dynamic lights: lighting is a fixed key light plus fresnel inside the shaders, so the light count never triggers a recompile.

4. RESOLUTION AND DPR
- Canvas backing store = CSS size x min(DPR, preset cap). The scene renders into an internal HDR target at backing size x renderScale, and the composite upsamples.
- Governor changes therefore reallocate only offscreen targets, in discrete steps, at most once per 2 s.

| Preset | DPR cap | MSAA | Bloom | Notes |
|---|---|---|---|---|
| Ultra | 2.0 | 4 | 1/2 res | |
| High (default) | 1.5 | 4 | 1/2 res | about 3.3 MP; about 190 MB of targets |
| Medium | 1.25 | 2 | 1/2 res | |
| Low | 1.0 | none | 1/4 res | FXAA in the composite; particle cap halved |

- Governor order: renderScale 1 -> 0.85 -> 0.72 -> 0.6, then MSAA 4 -> 2, then a 60 cap. It steps back up after 10 s clean.

5. POST-PROCESSING
- A custom pipeline replaces EffectComposer and UnrealBloomPass.
- Passes: scene into an MSAA HalfFloat target, resolve blit, soft-knee prefilter at 1/2, 4 dual-Kawase downsamples, 4 upsamples, then one composite (ACES, sRGB, vignette, chromatic aberration, grain, scanlines, heat shimmer, dim, freeze blur, hurt).
- Estimated GPU cost 1.5-2.5 ms at 3.3 MP.
- If EXT_color_buffer_float is missing, fall back to an RGBA8 target with a lower threshold.
- Pause and shop render one frozen frame, then leave the GPU idle.

6. SHADER AND ASSET WARM-UP
- Every material is created in assets/materials.ts at Boot and the registry is frozen afterwards.
- Program-affecting state never changes at runtime: theme modes are defines fixed at Boot, fog uses custom uniforms rather than scene.fog, side and instancing attributes are fixed, and needsUpdate is never toggled.
- ShaderWarmup: compileAsync over a warm scene with every material x geometry x instancing variant set to count 1, then 2 offscreen frames through PostFX, then initTexture on every DataTexture.
- The SFX bank is pre-rendered at unlock.
- PerfMonitor raises a DEV error if the program count grows after Boot.
- Theme changes apply on reload.

7. GPU MEMORY
- Assets and batches are allocated once at Boot (about 60 MB excluding render targets). States toggle visibility and counts only.
- The smoke test runs cycleRuns(3) and requires renderer.info.memory to equal the Boot baseline.
- On webglcontextlost: preventDefault, pause and show an overlay. On restore: rebuild programs, flag DataTextures for upload, reallocate targets and re-run warm-up.

8. SIM COST
- The grid is rebuilt per step in O(n).
- Player shots use a swept segment-circle test against a 3x3 cell query; enemy shots are tested against at most 2 players directly.
- Separation examines at most 6 neighbours, and target re-evaluation is staggered by slot % 30.
- Pool exhaustion is deterministic: player shots recycle the oldest, enemy shots skip spawning, and particles overwrite the ring.
- WaveDirector enforces the 180-enemy cap.
- Boss patterns have per-pattern bullet budgets.

9. DOM/HUD
- The HUD root uses contain: strict. Bars use transform: scaleX; text updates at most 10 Hz and only on change; nothing reads layout during a frame.
- World-space rings show dash and special charge.
- Screens are built once and toggled.

10. WEB AUDIO
- One AudioContext with latencyHint 'interactive'.
- 32 permanent channel strips with category limits, voice stealing (10 ms fade), 25 ms coalescing and lazy reclamation. No onended closures.
- Music uses a lookahead scheduler with a 0.2 s horizon; fewer than 40 nodes are live at once, each stopped explicitly.
- Pause ducks the music; hidden suspends the context.
- beatPhase is computed from ctx.currentTime, with no AnalyserNode.

11. INPUT
- O(1) handlers write typed arrays immediately.
- The sim samples at every 120 Hz tick.
- Measured keydown-to-sim reaction (__game.inputProbe) must be <= 1 tick + 1 frame, which is <= 17 ms at 120 Hz and <= 25 ms at a 60 Hz cap.

## 11. Testing plan

GATES
- `npm run verify` before every hand-off and at every wave boundary: format:check, typecheck (all 3 tsconfigs; tsconfig.pure proves the pure layers use no DOM or three), check:arch, lint with --max-warnings=0, vitest, and vite build (from Wave 3 on).
- Parallel agents gate on typecheck-scope plus eslint over their own paths plus their own vitest folder.
- Coverage (v8) on the pure layers: lines >= 85%, branches >= 80%.

UNIT TESTS (vitest, node environment, no DOM or WebGL)

core
- rng: fixed-seed golden sequence; fork independence.
- EntityPool: capacity, null on exhaustion, generational handles go stale after despawn, dense swap-remove.
- EventChannel: overflow is counted.
- SpatialGrid: equals brute force on 1,000 random layouts.
- hash: crc32 and fnv1a golden values; stableStringify ignores key order.

engine/StateMachine
- All 49 ordered (from, to) pairs: the 16 EDGES are accepted with the right op, every other pair throws.
- Guards: pop to the wrong base is rejected; Paused pops back to UpgradesShop when pushed over the shop.
- Queued requests are re-validated at apply time (a Pause during Boot is dropped; a Pause after GameOver is dropped).
- At most 4 applies per frame. Requests from inside enter/exit are deferred.
- Lifecycle order is recorded by SpyState: replace exits top to bottom; push is onCovered then enter; pop is exit then onUncovered.
- fixedUpdate runs only on the top state; depth never exceeds 3.
- clearEdges and suppress are called after every transition.

engine/GameLoop (FakeClock)
- 120 Hz ticks give exactly 120 steps per simulated second.
- 60 Hz ticks give 2 steps per frame.
- A 250 ms hitch is clamped to 0.1 s: at most 8 steps, with the backlog drop counted.
- alpha stays in [0, 1).
- timeScale 0.25 gives 30 steps/s.
- resetAccumulator prevents a catch-up burst.

engine/FramePacer: a 60 cap on 120 and 144 Hz series averages 60 +/- 1 frames/s.

engine/ResolutionGovernor: step down on 5% misses, step up after 10 s clean, no oscillation under alternating load.

engine/lifecycle: blur, hidden and Meta call releaseAll; Pause is requested only when Playing is on top.

input (FakeKeyTarget)
- A tap within one tick latches exactly one dash, or one tick of fire.
- e.repeat creates no edge. isComposing is ignored. metaKey and ctrlKey events are neither recorded nor prevented.
- Meta held, key released, Meta released: everything is released and a re-press is required.
- blur and visibility release everything.
- A repeat keydown re-asserts a held key without an edge.
- SOCD last-wins; diagonals have length 1.
- Solo merges both binding sets; P1 and P2 are isolated in co-op.
- preventDefault is called for bound codes and Slash.
- bindingValidation rejects forbidden, reserved, duplicate, empty and unknown codes, and swap works.
- MenuNavigator repeats after 350 ms then every 90 ms, per player independently.

entities
- weapons: cadence at fireRate 20/s gives 20 shots/s; overflow becomes damage; split and pierce flags work.
- revive: 2.0 s cumulative with decay; bleed-out shrinks per repeated down (floor 6 s); automatic kernel use; Offline ghost at 50% collection; wave-end reboot.
- linkBeam: activation band; Leech cut; solo drone at 60%.
- combo: window, tiers, halving, sync kill.
- damage: the Warden arc shield blocks front shots and not flanks; Mark adds +20%; drops.
- enemyBehaviors: each state machine's timings.
- bosses: phase thresholds; the Race Condition sync window (3 s co-op, 6 s solo) revives the partner at 50%.

sim
- collision: no tunnelling at 3x the maximum projectile speed.
- rules: wave clear beats wipe on the same tick; the outro purges bullets, vacuums every pickup and reboots before waveClearReady.
- WaveDirector: tabled budgets at w1, w5, w10 and w15 with the 2P multiplier; unlock schedule; never more than 180 alive; farthest-portal choice; same seed gives the same plan.
- determinism: same seed plus 7,200 scripted steps gives an identical stateHash; a different seed gives a different hash.
- soak: 72,000 ticks (10 simulated minutes) with Autopilot-like scripted intents. No NaN, pools within capacity, the waves progress, plus a golden hash per seed.
- economy: a Monte Carlo of 2,000 seeded runs using a greedy/random buyer. Asserts median purchases per visit in [1.5, 4], nobody reaches every cap before sector 3, and solo versus 2P per-player purchase power within +/-25%.
- RunSession: applyShopResults heals by the delta; the flags drive transitions correctly.

upgrades
- pricing: golden table for every item at every level for w = 1, 5, 10, 15; integer outputs; round5; minimum 5.
- stats: order-independent (shuffled purchase orders give equal results), every hard cap, fire-rate overflow, Glass Lens clamps HP to at least 1.
- offers: drawn without replacement; uniques and stack caps excluded; rarity weights per sector; fallback down to the Shard Cache; lock carry-over.
- ShopModel: every PurchaseFailure is reachable. Also: an exact-funds buy, a double buy in one frame, P1-then-P2 ordering, soldOut on team stock, undo refunding the price actually paid and restoring the snapshot (hp, maxHp), teamDependency, gift undo, reroll escalation with free rerolls consumed first, the open guard rejecting a held press, solo P2 rejected as absent, and commit clearing the logs.
- ShopModel.fuzz: 10k seeded operations. Invariants: integers only, no negatives, sum(spent) - sum(refunded) = start - end.
- MetaShop: buy, respec refunds the recorded spend, unlocks cannot be refunded.
- rewards: the formula, the victory bonus, the 400 cap, and abandoned pays progress.

save
- SaveStore:
  - round trip
  - crc mismatch falls back to .bak, then to defaults with the corrupt blob quarantined
  - future-v99 fixture: read-only, never written
  - MemoryStorage set to throw: memory-only mode
  - QuotaExceeded: evict and retry once, then error
  - delta commit preserves a simulated second tab's write
  - commitRun twice with the same runId: duplicate, granted once
  - debounce is flushed by tick() and flush()
- migrations: an injected v1 -> v2 -> v3 registry is applied; idempotent.
- sanitize: garbage input (null, arrays, NaN, Infinity, negatives, 1e20, __proto__ keys); the overleveled fixture is clamped with a refund; unknown ids are dropped; invalid bindings are reset.

audio
- VoicePool category limits, steal order and 25 ms coalescing with a fake time.
- theory: midi to Hz with A4 = 440; scales.
- Composer is deterministic per seed, and its layers respect intensity.
- Sequencer schedules only inside the lookahead window, with a fake audio clock.

assets: every generated BufferGeometry has matching attribute counts, finite positions, unit normals, barycentrics present and bounds within the expected size. Checked for all 3 themes' families.

render/cameraMath
- Two players at opposite edges give maxDist, with all points inside the safe box.
- A Downed player is framed; an Offline player is excluded.
- maxDist fits the arena at aspects 0.5, 1.0, 1.6 and 2.4.
- The zoom-in hysteresis holds.
- viewRectOnGround contains the framed points.

ui/format: formatters.

states (fake ports)
- flow: Boot, MainMenu, CharacterSelect (P2 joins), Playing, Shop, Playing, Paused, Resume, Paused, Abandon, GameOver, Retry keeps the picks, MainMenu.
- shopFlow: EXTRACT goes to victory; PUSH DEEPER goes to overflow.
- gameOverCommit: commitRun runs exactly once, even if GameOver is entered twice.

BROWSER SMOKE AND PERF (Chromium pane)
1. Start `npm run dev` through preview_start (a .claude/launch.json entry), then open /?debug=1&seed=42.
2. Run these checks via javascript_exec against window.__game:
   (a) Boot reaches the menu in under 3 s, with no console errors and an empty shaderErrors(); the program count after Boot equals the count after 60 s of play.
   (b) Walk every state through synthetic KeyboardEvents and assert the FSM stack at each step. Take screenshots of every screen at 1512x982 and 1280x720, plus a portrait check.
   (c) Stress: autopilot(true), stress({enemies:180, shots:2048, particles:8192}), then perf.sample(15000). Requires avgFps >= 59 at the 60 cap, p99 <= 20 ms, longFrames = 0, drawCalls <= 60 and cpuP95 <= 4 ms. Repeat on Auto at 120 Hz and report.
   (d) cycleRuns(3) leaves renderer.info.memory equal to the baseline.
   (e) inputProbe() <= 17 ms at 120 Hz.
   (f) audioStats(): ctxState 'running' after the first key press, voices <= 32 under stress.
   (g) A synthetic blur or Meta keydown auto-pauses with no stuck keys.
   (h) Buy Firmware, reload, confirm it persisted; corrupt localStorage by hand, reload, confirm the toast and the backup restore.
3. Repeat (a)-(c) on `npm run build && npm run preview`.

MANUAL CHECKLIST FOR THE USER (MacBook)
- Key Test with both players holding their busiest combos.
- Cmd-Tab mid-dash: no stuck keys, auto-pause.
- Game speed is the same on ProMotion and on a 60 Hz external display.
- Safari: Space does not scroll. Firefox: '/' does not open quick-find.

## 12. Parallel build plan (Phases 2–4)

PREREQUISITE (orchestrator, needs user approval)
- Install Node 24.21.0 LTS user-locally with no sudo: the official darwin-arm64 tarball into ~/.local/node, added to PATH for the session.
- Work on branch feat/game. Nothing is pushed until Wave 5 and explicit user approval.

LAYER MATRIX (enforced by check-arch.mjs; imports only point downward)
- L0 contracts: imports nothing.
- L1 core: contracts.
- L2 config, themes: L0-L1.
- L3 engine, input, upgrades, save, entities: L0-L2 (siblings do not import each other).
- L4 sim: L0-L3 entities and upgrades.
- L4 states: L0-L2 and upgrades. Never sim, engine, render, audio or ui concretely; they go through the Services ports.
- L5 shaders: contracts/render only.
- L5 assets: shaders, render/InstanceBatch, render/GpuRingBuffer, L0-L2, three.
- L5 render: shaders, L0-L2, three; the AssetLibrary is consumed through AssetLibraryApi.
- L5 audio: L0-L2.
- L5 ui: L0-L1.
- L6 debug: L0-L1 and engine/PerfMonitor.
- L6 app: everything.
- main.ts: app.
- 'three' is allowed only in assets, render, app and debug. There are no barrel index files and no cycles.

GLOBAL AGENT RULES
- Write only your owned paths plus your tests.
- After Wave 0, contracts/**, core/**, config/**, themes/**, all root configs and tests/helpers/** are FROZEN. A needed change is reported as a CONTRACT CHANGE REQUEST; the orchestrator applies such requests serially between waves and re-runs the gate.
- Named exports only. No any, @ts-ignore, TODO, placeholders, enums or namespaces. Files <= 400 lines.
- Verify with `node scripts/typecheck-scope.mjs <paths>`, `npx eslint <paths>` and `npx vitest run tests/<area>`.
- Iterate on your module in a develop-test-fix loop until green. The /loop discipline is bounded by the guardrail below.

WAVE 0: FOUNDATION (1 agent, sequential)
Owns:
- all root files: package.json, tsconfigs, vite and vitest configs, eslint and prettier configs, .editorconfig, .nvmrc, .gitignore, ci.yml, index.html, docs/ARCHITECTURE.md
- scripts/*
- src/vite-env.d.ts
- src/contracts/**, src/core/**, src/config/**, src/themes/**
- src/engine/transitions.ts, src/sim/createWorld.ts
- src/render/InstanceBatch.ts, src/render/GpuRingBuffer.ts, src/shaders/chunks/instancing.ts
- tests/helpers/**, tests/core/**
Steps:
- npm install and commit the lockfile.
- Verify the pinned versions against the registry and adjust within the stated ranges.
- Check the three 0.186 APIs used by the contracts (addUpdateRange/clearUpdateRanges, compileAsync, InstancedBufferGeometry.instanceCount, GLSL3) against @types/three.
Gate: typecheck (3 configs), check:arch, lint and the core tests are green. Commit 'contracts v1'.

WAVE 1: MODULES (9 parallel agents; disjoint ownership; each imports only L0-L2 plus the Wave 0 files)
- W1-ENGINE: engine/{StateMachine, GameLoop, FramePacer, PerfMonitor, ResolutionGovernor, lifecycle}.ts; tests/engine/**.
- W1-INPUT: input/**; tests/input/**.
- W1-COMBAT: entities/{players, weapons, specials, projectiles, pickups, damage, cardEffects, linkBeam, revive, combo}.ts and sim/collision.ts; tests/entities/{weapons, revive, linkBeam, combo, damage}, tests/sim/collision.
- W1-CONTENT: entities/{enemies, enemyBehaviors, bosses, bossPatterns}.ts and sim/{WaveDirector, rules}.ts; tests/entities/{enemyBehaviors, bosses}, tests/sim/{WaveDirector, rules}.
  - It may import entities/projectiles and entities/damage only after W1-COMBAT publishes their exported signatures, which are frozen in ARCHITECTURE.md by Wave 0. Kill side effects cross the boundary only through world.deathQueue.
- W1-ECON: upgrades/**, save/**; tests/upgrades/**, tests/save/**, tests/fixtures/**.
- W1-AUDIO: audio/**; tests/audio/**.
- W1-ART: shaders/** (except chunks/instancing.ts and post/**), assets/**; tests/assets/**.
- W1-RENDER: render/** (except InstanceBatch and GpuRingBuffer), shaders/post/**; tests/render/**. It consumes materials and geometries only through AssetLibraryApi and MaterialKey/GeometryKey from the contracts, so it never waits on W1-ART.
- W1-UI: ui/** including the styles; tests/ui/**.
Gate: verify without vite build (there is no entry point yet).

WAVE 2: INTEGRATION (2 parallel agents)
- W2-SIM: sim/{stepWorld, stateHash, RunSession}.ts; tests/sim/{determinism, soak, economy, RunSession}. Bugs found in Wave 1 files go back to their owning agent as tickets; this agent does not patch them in place.
- W2-STATES: states/**; tests/states/**. It depends only on contracts, Services ports, upgrades/MetaShop and upgrades/rewards, so it does not wait for W2-SIM.
Gate: verify without vite build.

WAVE 3: COMPOSITION (1 agent)
- Owns app/**, src/main.ts, debug/**, README.md. Ownership of index.html transfers to this agent.
- Full `npm run verify` including vite build, then the browser smoke checklist on dev and on preview.
- Commit in logical commits (toolchain, contracts, one per module area, integration) with the Co-Authored-By trailer.

WAVE 4: CRITIC LOOP
- A read-only critic agent reviews:
  - performance: hot-path allocations, program growth, draw calls and uploads, and smoke numbers from __game.perf.sample
  - input: latency probe, Meta and blur behaviour, SOCD, edges leaking across states, ghosting UX
  - upgrade and save edge cases: the fuzz invariants, migrations, idempotent commits
  - visual polish: screenshots of every state and theme
- A finding is accepted only with a failing test, a measured number or a screenshot, tagged with the owning path.
- The orchestrator groups findings by disjoint owner areas and dispatches fixer agents in parallel under the same ownership map. They re-run the gate and the smoke test.
- Repeat until there are zero high or medium findings and the perf acceptance targets pass.
- Run as a self-paced /loop, one iteration per batch of findings.

WAVE 5: RELEASE
- `npm ci && npm run verify`, then the production smoke test on vite preview.
- Merge feat/game into main, with ci.yml as the last commit.
- git push origin main only after the user explicitly approves. Never force-push.

GUARDRAIL
- Each agent keeps an attempt counter per (file, error signature).
- On the 5th unresolved attempt it stops and returns the exact compiler or test output, the file, and what it tried.
- The orchestrator then pauses all autonomous work and asks the user to intervene.

## 13. Risks

1. TOOLCHAIN
- typescript-eslint 8.70.1 declares peer typescript >=4.8.4 <6.1.0, and TS 7.0.2 is the Go-native compiler.
- Mitigation: pin typescript ~6.0.3 for tsc, ESLint and the editor, and keep tsconfig TS7-clean (no baseUrl, explicit types and strict flags).
- A non-gating typecheck:ts7 script tracks readiness.
- If type-aware lint ever blocks progress, fall back to the untyped strict preset; tsc and check-arch stay the hard gates.

2. VITE 8 (ROLLDOWN)
- Some Rollup options have moved.
- Mitigation: no plugins, no manualChunks, GLSL as TS strings (no ?raw), and vite build is verified from Wave 3 on.

3. THREE 0.186 API DRIFT
- Affects addUpdateRange/clearUpdateRanges, compileAsync, InstancedBufferGeometry, GLSL3 ShaderMaterial and the deprecated THREE.Clock.
- Mitigation: Wave 0 verifies these against the installed @types/three, and agents trust tsc over memory.

4. GLSL ERRORS APPEAR ONLY AT RUNTIME
- Mitigation: checkShaderErrors in DEV, Boot-time compileAsync over every variant, __game.shaderErrors(), and smoke tests on both the dev and preview builds.

5. LAPTOP KEYBOARD GHOSTING AND CRAMPED HANDS
- These cannot be fully solved in software.
- Mitigation: autofire by default (at most 3 held keys per player); Shift and Space on ghost-safe lines; the Key Test; full rebinding; numpad alternates; and a README recommendation to use an external keyboard for long sessions.

6. MACOS AND BROWSER TRAPS
- Ctrl, Cmd and Option are forbidden in bindings.
- The Meta keyup workaround releases everything on Meta.
- Escape exits fullscreen, which auto-pauses.
- The Firefox '/' quick-find is prevented.
- Pressing Shift 5 times opens the Sticky Keys prompt on Windows; this causes a blur and auto-pause, and alternates exist.

7. PROMOTION VARIABILITY
- rAF can fire at 60-120 Hz.
- The fixed 120 Hz sim plus interpolation, FramePacer and the governor keep the 60 FPS floor. Thermal throttling in long sessions is handled by governor step-downs.

8. AUTOPLAY POLICY
- The Boot 'press any key' gate unlocks audio, and play() is a no-op before unlock.
- Safari's 'interrupted' state is resumed on the next gesture.

9. LOCALSTORAGE
- It is synchronous, may be unavailable, full or corrupt, and Safari ITP can evict it.
- Mitigation: no writes while Playing, a memory fallback with a toast, .bak and quarantine, delta commits, and idempotent run commits.

10. SCOPE
- 4 vehicles, 6 enemies, 3 bosses, 16 cards, 3 themes, 15 waves plus OVERFLOW.
- Every number lives in config/*.ts, and bosses are data compositions of shared primitives.
- Cut order if the budget runs tight, applied only with user sign-off: the 2 non-default themes (skins), then Tinker, then OVERFLOW, then boss 3 reusing boss 2's primitives with new phases.

11. PARALLEL CONTRACT DRIFT
- Mitigation: frozen contracts, one owner per path, check-arch, typecheck-scope, contract change requests only between waves, and whole-repo gates at each wave boundary.
- W1-CONTENT's dependency on two W1-COMBAT exports is the one intra-wave coupling. It is resolved by freezing those signatures in Wave 0 docs; if COMBAT lags, CONTENT tests against local test doubles in tests/.

12. DETERMINISM
- Floating point is deterministic within one browser but not across machines. That is acceptable, since there is no netcode.
- The fx rng is separate from the sim rng.

13. ENVIRONMENT AND REMOTE
- Node is not installed yet (a user-local install needs approval).
- Pushing .github/workflows/ci.yml needs a credential with the GitHub 'workflow' scope. It is committed last so it can be dropped without rewriting history.
- The push is an explicit user checkpoint.

14. CREDIT BUDGET
- The 5-attempt guardrail per (file, error signature) applies.
- Critic findings must be measurable.
- Content breadth beyond the cut line waits until the critic loop is green.

## 14. Spec coverage

| Requirement | Covered by | Gap |
|---|---|---|
| Vite + Three.js + strict TypeScript | package.json with vite ^8.3.1, three 0.186.1 and typescript ~6.0.3. tsconfig has strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes and erasableSyntaxOnly. tsconfig.pure keeps the pure layers free of DOM and three. The typecheck gate runs in npm run verify. | TS 7.0.2 is not the gating compiler because typescript-eslint 8.70.1 requires TS <6.1. A non-gating typecheck:ts7 script tracks readiness. |
| Visually striking 3D action/arcade game | A co-op arena shooter with a tilted-perspective 3D camera. HDR custom dual-Kawase bloom, emissive neonSurface shaders with dissolve, hit flash and glitch, floor ripples and shockwaves, GPU particles, trails and damage digits, per-sector palettes and 3 themes. | Visual quality is judged by screenshots in the critic loop, not by an automated metric. |
| 2-player local multiplayer on one keyboard; P1 WASD + action keys | input/defaultBindings.ts: P1 moves with WASD; Fire/Focus Space [KeyF], Dash ShiftLeft [KeyQ], Special KeyE [KeyR]. Drop-in P2 join in CharacterSelect. IntentSampler builds a per-player PlayerIntent. | — |
| P2 on Arrow keys + NumPad/specific action keys, working without a NumPad (MacBook) | P2 moves with the arrows. Fire Period, Dash Slash (alt ShiftRight), Special Comma. Numpad8/4/5/2/6, Numpad0, NumpadDecimal and NumpadEnter are always-active alternates. Everything is rebindable, with forbidden-modifier validation. | — |
| Camera handles both players dynamically (split-screen or adaptive bounding-box zoom) | render/CameraRig.ts with the pure cameraMath.solveFraming (binary-search padded framing into a safe NDC box). maxDist is solved so the whole arena fits at any aspect. Asymmetric smoothDamp zoom with hysteresis. Edge cases covered: far apart, downed, offline, solo, wipe, teleport, boss, resize. Unit-tested in tests/render/cameraMath.test.ts. | — |
| Currency/points earned during gameplay | Per-player Shard pickups from kills (combo and catch-up bonuses), wave-clear bonus, purge payout. Cores computed at GameOver by upgrades/rewards.ts. | — |
| Persistent upgrades | Firmware meta catalog in config/metaCatalog.ts, the pure upgrades/MetaShop.ts and the Hangar (UpgradesShop{meta}). Persisted by save/SaveStore.ts with delta commits, crc and backup, and migrations. Snapshotted into each run. | — |
| Mid-run upgrades | UpgradesShop{midrun} is pushed after every wave. It has 8 stat rows, Repair, 3 seeded patch cards per player, the team row, and reroll, lock, gift and undo, all through upgrades/ShopModel.ts. | — |
| Upgrade categories: speed, health, weapon fire rate, special abilities | Thrusters (speed), Plating and Repair (health), Overclock (fire rate), Capacitor and Special Tuning plus the SUDO and Overdrive Battery cards (specials), plus damage, pierce, split, dash, magnet and link upgrades. | — |
| Dedicated shop UI | ui/screens/ShopScreen.ts with two ui/widgets/ShopPanel.ts columns, each driven by its own player at the same time, plus ui/screens/HangarScreen.ts for meta. Built from pure view models in states/viewModels.ts. | — |
| All 3D models from Three.js primitives and custom BufferGeometries | assets/geometry/MeshBuilder.ts merges primitives, extrusions, lathes, tubes and custom BufferGeometry parts, adding barycentric and emissive attributes. Generators cover vehicles, enemies, bosses, arena, fx shapes and the voxel title font. Validated by tests/assets/geometry.test.ts. | — |
| Procedural noise | assets/noise.ts (seeded CPU simplex and FBM) feeds DataTextures in assets/textures.ts and mineral mesh displacement. shaders/chunks/noise.ts provides GPU value, simplex, FBM and Voronoi for the floor, sky, dissolve and caustics or lava. | — |
| Custom fragment shaders | src/shaders/*.ts contains 11 material shaders (neonSurface, floor, sky, projectile, particle, beam, decal, marker, digits, shockwave, trail) plus custom post shaders (bloom prefilter, Kawase down and up, composite). All are GLSL3 ShaderMaterial or full-screen passes. | — |
| No external model/texture/media files | Every asset is generated at Boot. The favicon is an inline SVG data URI. There is no public/ asset directory, and fonts are system stacks. | check-arch does not scan for binary imports; a grep for asset extensions is added to the critic checklist. |
| Audio manager synthesizing all SFX (explosions, laser fire, power-ups) | audio/AudioEngine.ts implements AudioPort. sfxRecipes.ts and synth.ts define about 30 recipes, pre-rendered through OfflineAudioContext in SfxBank.ts. VoicePool.ts caps voices at 32 with stealing and coalescing. AudioEventRouter.ts maps SimEvents to sounds. | — |
| Procedural ambient background track via Web Audio | audio/theory.ts, Composer.ts (seeded, intensity layers, per-state moods), Sequencer.ts (lookahead scheduling) and instruments.ts, with theme audio params (BPM, key, mode, timbre). | — |
| Strict global state machine | engine/StateMachine.ts plus engine/transitions.ts: a pushdown FSM with exactly 16 whitelisted edges, guards, a queued FIFO applied at frame start with re-validation, and a lifecycle ordering. It throws on invalid transitions in DEV. All 49 ordered state pairs are tested. | — |
| State: Boot | states/BootState.ts: WebGL2 check, save load and migrate, theme, incremental AssetLibrary build, ShaderWarmup, press-any-key gate that unlocks audio, fatal path. | — |
| State: MainMenu | states/MainMenuState.ts plus ui/screens/MainMenuScreen.ts. MenuBackdrop attract camera. Settings and Controls sub-panels. | — |
| State: CharacterSelect (character/vehicle selection) | states/CharacterSelectState.ts, ui/screens/CharacterSelectScreen.ts and render/scenes/SelectStage.ts. 4 vehicles (2 unlockable), drop-in P2, Ready and countdown, Retry prefill. | — |
| State: Playing | states/PlayingState.ts driving RunSessionApi (sim/RunSession.ts). Fixed 120 Hz ticks, flags leading to transitions, a once-per-frame event drain, covered/uncovered handling. | — |
| State: UpgradesShop | states/UpgradesShopState.ts. The midrun mode is pushed over Playing; the meta Hangar replaces MainMenu. The final visit offers EXTRACT or PUSH DEEPER. | — |
| State: Paused | states/PausedState.ts, an overlay over Playing or the midrun shop. Frozen frame with GPU idle, music duck, hold-to-confirm Abandon. engine/lifecycle.ts auto-pauses on blur, hidden, fullscreen exit and context loss. | — |
| State: GameOver | states/GameOverState.ts: summary, Cores via rewards.ts, idempotent commitRun, records and MVP, Retry or Menu, run disposal back to the memory baseline. | — |
| Modular multi-file code with /src/engine, /entities, /input, /ui, /shaders, /audio | About 190 files, and every requested directory exists. Also contracts, core, config, themes, sim, upgrades, save, states, assets, render, app and debug. The layer matrix is enforced by scripts/check-arch.mjs, with a 400-line limit per file. | — |
| Proper TS interfaces and imports; no placeholders | Frozen src/contracts/** defining the ports and domain types. check-arch bans TODO, placeholder, 'not implemented', as any, @ts-ignore, enums and default exports. ESLint strictTypeChecked with --max-warnings=0. | — |
| Stable 60 FPS | Performance plan: fixed-step sim with interpolation, zero-allocation hot paths, <= 60 draw calls through 2-vec4 instancing and GPU ring buffers, custom bloom, DPR cap and ResolutionGovernor, full shader warm-up, frozen overlays. Browser stress gate: avgFps >= 59, p99 <= 20 ms, 0 long frames at 180 enemies, 2,048 shots and 8,192 particles. | Performance is gated only in Chromium on this M3 Pro. Safari and Firefox are smoke-checked manually, not perf-gated. |
| No input lag on shared keyboard | Typed-array KeyboardDevice written directly in handlers, 120 Hz per-tick sampling, tap latching, SOCD, Meta/blur releaseAll, clearEdges and suppress after each transition, autofire default to reduce held keys, Key Test and rebinding. inputProbe gate <= 17 ms. | Hardware ghosting on specific key combinations of the user's MacBook cannot be fixed in software. It is mitigated by the Key Test, autofire and rebinding. |
| Upgrade logic robust to edge cases | A single re-validating ShopModel.apply with 14 failure reasons, snapshot LIFO undo refunding the exact price, team dependency rule, deterministic P1-then-P2 contention, hard caps with fire-rate overflow, integer-safe wallets, open guard, and runId-idempotent Core awards. Covered by the 10k-operation fuzz test, the economy Monte Carlo test, and save sanitisation with migrations. | — |
| Parallel sub-agent implementation in one working tree | Wave 0 frozen contracts. Wave 1 has 9 agents with disjoint path ownership, Wave 2 has 2 integration agents, Wave 3 does composition. typecheck-scope.mjs gives per-agent diagnostics; there are no barrels; contract change requests are applied only between waves. | W1-CONTENT depends on 2 exports from W1-COMBAT. Their signatures are frozen in the Wave 0 docs, but a delay could serialise part of that pair. |
| Critic loop reviewing perf, input and upgrade edge cases | Wave 4: a read-only critic with measurable findings only (failing test, perf number or screenshot). Fixers are dispatched under the ownership map, and it repeats until clean. Run as a self-paced /loop. | /loop is a recurring-prompt scheduler rather than a build tool; the workflow orchestrator drives the actual iterations. |
| Vite build passes; commit and push to GitHub | npm run verify includes vite build. A production preview smoke test. Logical commits with the Co-Authored-By trailer on feat/game, merged to main, pushed only after user approval. | Pushing ci.yml needs a credential with the 'workflow' scope. It is committed last so it can be dropped if the push is rejected. |
| Credit guardrail: stop after 5 failed attempts on the same bug/file | Each agent keeps an attempt counter per (file, error signature). On the 5th attempt it stops with the exact diagnostics, and the orchestrator pauses and prompts the user. | — |
| Pitch 2-3 themes fitting the mechanics | KERNEL PANIC (default), ABYSSAL LIGHT and EMBERFALL. Each is a ThemeDef data file in src/themes/ that drives names, palettes, geometry families, shader defines and audio params. The mechanics and code paths are shared. | The two non-default themes need extra geometry families (organic, mineral) and more shader mode work. They are first on the cut list if the budget runs short. |
| Environment: ProMotion 120 Hz, no numpad, Node not installed | Fixed 120 Hz sim decoupled from rAF, plus FramePacer. NumPad-free defaults. A user-local Node 24.21.0 install as a Wave 0 prerequisite (needs approval). | — |

## 15. How the three proposals scored

| Lens | Score | Strengths | Weaknesses |
|---|---|---|---|
| engine-perf | 8.7 | The strongest technical spine of the three. - State machine: strict stack FSM with an explicit edge table, per-edge guards, a FIFO request queue applied at frame start and re-validated when applied (so a blur-Pause arriving during Boot is dropped), onCovered/onUncovered hooks, and frozen-frame overlays so the GPU idles in Pause and the shop. - Hot paths never allocate: EventChannel of preallocated structs, generational EntityPool, and an InstanceBatch that sends 2 x vec4 per instance instead of a mat4. - GPU-side work: ring buffers for particles, damage digits and shockwaves; bullets extrapolated in the vertex shader; a custom dual-Kawase bloom with a single composite pass. - Hitch control: shader warm-up with compileAsync plus an alarm if the program count grows after Boot, and a ResolutionGovernor that only adjusts offscreen targets. - Controls: the best treatment of macOS traps (Ctrl+Arrow, Cmd keyup, Option+Space launchers), forbidden-modifier validation, a rollover tester, and auto-fire by default to cut held keys. - Camera: a numeric solver that always fits the whole arena at maxDist, with zoom-in hysteresis. - Save and tests: very robust save handling (crc, .bak, corrupt quarantine, read-only mode for newer versions) and measurable smoke tests through window.__prism. | - The 60 Hz sim runs zero steps on every other frame at 120 Hz and samples input only every 16.7 ms. - Contracts are spread across about 10 per-directory types.ts files, and states import concrete subsystems, so states cannot be unit-tested with fakes. - It registers GLSL into the global THREE.ShaderChunk and relies on .glsl ?raw imports, which is global mutation plus a RawShaderMaterial include risk. - Beyond the tether, the gameplay is competent but generic. - Render agent G is blocked on F for materials. - There is no architecture-lint script and no per-agent scoped typecheck. - The tree is large (about 210 files) with some cosmetic sprawl (separate trail, decal and digits shader files). |
| gameplay-systems | 7.6 | The best game design. - Co-op mechanics: combo tiers; a Link Beam whose solo Echo Drone keeps link upgrades relevant; an Offline ghost mode so a dead player still plays; sync kills; and a catch-up bonus plus gifting so split wallets do not turn toxic. - Shop: patch cards with rarity curves by sector, and a shared team row (Spare Kernel, Link upgrades). - Bosses that teach co-op (Race Condition requires synchronised kills; Fork Bomb splits). - Shop logic: undo restores a full snapshot, including HP after Plating or Repair. - An economy Monte Carlo test that asserts the purchase-per-visit targets. - Clear rules for which check wins when a wave clears and the team wipes on the same tick. - The most diegetic theme (KERNEL PANIC), where primitive geometry is the correct art rather than a budget compromise. - Solo mode where both binding sets drive P1. | - Scope is too big for a first version: 20 waves, 5 bosses, 7 enemies, 4 vehicles and 25+ cards. - Layer violation: core/events imports game/types. - Sim-to-audio/VFX decoupling is weakened by a synchronous EventBus emitting object payloads from inside the sim, which allocates and risks re-entrancy. - It uses TS enums, which conflict with erasableSyntaxOnly. - Bosses use class inheritance. - Rendering cost: EffectComposer plus UnrealBloomPass plus EdgesGeometry overlays mean more passes and draw calls, and the whole stack renders every frame even while paused. - Shop contention uses alternating priority, which adds complexity for little gain. - P2 shop keys (KeyL, Semicolon) sprawl across the keyboard. - It relies on manualChunks, which is risky under Rolldown. - The 120 Hz sim is fine, but the plan does not budget its extra CPU cost against the stress targets. |
| ts-modularity | 8.2 | The best buildability for parallel agents. - Centralised, frozen type-only contracts plus a ports/DI Services object, so states and run flow can be tested in node with fakes. - tsconfig.pure proves the pure layers never touch the DOM. - check-arch.mjs enforces the layer matrix, bans placeholders and `as any`, and caps file length. - typecheck-scope.mjs lets each agent see only its own diagnostics while siblings are mid-edit. - Explicit ownership transfers between waves. - GLSL written as type-checked TS string modules, with no global chunk mutation. - Upgrade rules: immutable tryPurchase and undo, a 10k-operation fuzz test with currency conservation, and every failure reason reachable. - Save: delta commits keep multi-tab writes safe, and commitRun is idempotent via runId. - The 120 Hz sim with press counters. - Warns that three 0.186 has changed APIs (Clock, addUpdateRange). | - The soft tether restricts movement, which is unnecessary when maxDist already fits the arena. - Hold-to-fire is the default, so up to 4 keys are held per player, which is the worst choice for laptop ghosting. - SimEvents are fresh object literals, so there is steady GC churn. - A depth-2 stack forbids Pause over the shop (Abandon cannot be reached from the shop). - GameOver as an overlay complicates reset semantics. - Per-directory index.ts barrels create ownership hot spots and cycle risk. - EffectComposer is used. - Some pinned versions (prettier, @types/node) are unverified. - The gameplay layer is middling (fixed catalog with no build variety beyond the aux slot). |

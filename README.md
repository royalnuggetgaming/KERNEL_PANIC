# KERNEL PANIC

A neon 3D arena shooter for one or two players on one keyboard. You and a friend are two daemons
inside a failing kernel. Corrupted processes pour out of the portals, and you purge them wave after wave. Between
waves you spend Shards on upgrades. Every run pays out Cores, which buy permanent Firmware in the Hangar. You can
play solo or **co-op**, where a Link Beam between the players deals damage and downed partners can be revived.
You can also play **versus**, a best-of-five duel with arena hazards.

Everything is procedural. There are no image, model or audio files: geometry, shaders, music and sound effects are
all generated in code. The game is built with Vite, Three.js 0.186 and strict TypeScript.

## Requirements

- Node.js **>= 22.13** (**24 LTS recommended**; `.nvmrc` pins 24.21.0)
- A browser with WebGL2 (recent Chrome, Edge, Firefox or Safari)

## Getting started

```sh
npm ci
npm run dev        # http://localhost:5173
```

On the boot screen, press any key to start the audio and open the main menu.

## Controls

The default keys work on a MacBook keyboard, which has no numpad. The numpad keys are also always active, for
external keyboards. Bindings use physical key positions, so they work on any layout. You can rebind keys in
**Controls**.

| Action       | Player 1 (left hand)  | Player 2 (right hand)                      |
| ------------ | --------------------- | ------------------------------------------ |
| Move         | `W` `A` `S` `D`       | Arrow keys (or numpad `8` `4` `5`/`2` `6`) |
| Fire / Focus | `Space` (or `F`)      | `.` (or numpad `0`)                        |
| Dash         | `Left Shift` (or `Q`) | `/` (or `Right Shift`, numpad `.`)         |
| Special      | `E` (or `R`)          | `,` (or numpad `Enter`)                    |
| Pause        | `Esc` or `P`          | `Esc` or `P`                               |

- **Autofire is on by default**, so you only need to steer and dash. Hold Fire/Focus to lock your facing,
  tighten your spread and deal extra damage while moving more slowly. You can turn autofire off, or make Focus a
  toggle, separately for each player in **Settings**.
- **Solo:** both key sets control Player 1.
- **Menus:** move with `WASD` or the arrow keys. Confirm with `Enter`, `Space` or `.`. Go back with `Esc` or
  `Backspace`.
- **Character select and the upgrade shop:** each player moves their own cursor with their own keys. Fire buys
  or confirms, Dash undoes or goes back, and Special toggles Ready. Player 2 joins by pressing Fire (`.`).
- `Ctrl`, `Cmd` and `Option` are never used, so system shortcuts keep working and cannot leave keys stuck.

### Key Test (ghosting)

Many laptop keyboards cannot register certain combinations of keys held at the same time ("ghosting"). Open
**Controls > KEY TEST** and have both players hold their busiest combination: `W`+`D`+`Space` together with
`↑`+`→`+`.`. If a key drops out, rebind it, or leave autofire on so that each player holds at most two movement
keys.

## Modes

- **Solo / Co-op:** 15 waves in 3 sectors, with a boss at the end of each sector. After every wave the shop
  opens. After the final boss you choose **EXTRACT** (bank a victory) or **PUSH DEEPER** (endless OVERFLOW
  waves).
- **Versus:** once Player 2 has joined, set the **MODE** row in character select to VERSUS. The first player to
  win 3 rounds wins the match. A round lasts up to 90 s, and if time runs out the player with the higher HP
  fraction wins it. Shots hit your opponent for reduced damage, and weaker enemy waves roam the arena as hazards.
  The shop opens between rounds, without the team items.

## Scripts

| Script                   | What it does                                                                   |
| ------------------------ | ------------------------------------------------------------------------------ |
| `npm run dev`            | Vite dev server on port 5173                                                   |
| `npm run build`          | Type-checks all three tsconfigs, then runs a production build into `dist/`     |
| `npm run preview`        | Serves `dist/` on port 4173                                                    |
| `npm run verify`         | The full gate: format check, typecheck, architecture check, lint, tests, build |
| `npm run verify:nobuild` | Same as `verify` without the vite build                                        |
| `npm test`               | Vitest unit and integration tests (`npm run test:coverage` for coverage)       |
| `npm run lint`           | ESLint with zero warnings allowed                                              |
| `npm run check:arch`     | Checks layer imports, file size limits and banned patterns                     |
| `npm run typecheck:ts7`  | Optional check with TypeScript 7 (does not gate)                               |
| `npm run format`         | Prettier                                                                       |

## Debug flags

- `?debug=1` installs `window.__game`, the dev API. It is always installed by `npm run dev`. Useful calls include
  `state()`, `goto('Playing', { mode: 'coop' })`, `perf.sample(ms)`,
  `stress({ enemies, shots, particles })`, `autopilot(true)`, `godMode(true)`, `clearWave()`, `setWave(n)`,
  `giveShards(p, n)`, `cycleRuns(n)`, `inputProbe()`, `rendererInfo()`, `audioStats()` and `shaderErrors()`.
  Press `` ` `` (Backquote) to toggle the debug overlay. It shows FPS, frame p99, CPU p95, draw calls, triangles,
  shader programs, audio voices, the resolution-governor step and the state stack.
- `?seed=N` fixes the run seed, so runs with the same inputs are reproducible.

## Performance notes

- The simulation runs at a fixed 120 Hz, separately from rendering. Game speed is the same at 60 Hz, 120 Hz
  (ProMotion) and 144 Hz.
- **Settings > Frame cap:** Auto (the display rate, which drops to 60 while playing if frames are missed), 60, 120
  or uncapped.
- **Quality presets:** Low, Medium, High (the default) and Ultra. A resolution governor lowers the render scale,
  then MSAA, then caps the frame rate at 60 whenever frame p95 goes over budget, and it steps back up after 10 s
  of clean frames.
- Every shader is compiled while the boot screen is showing. The number of shader programs stays fixed at 20
  after boot, and the per-frame hot paths do not allocate. The game draws with about 20 to 60 draw calls a frame,
  using instanced batches.
- The frame-rate targets (60/120 FPS) are for real GPUs. In a software-rendered browser, such as a headless CI
  container, only the CPU-side budgets are meaningful.

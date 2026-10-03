# KERNEL PANIC — Architecture

Codename LINKLINE. This document is the Wave 0 contract for every later wave. `docs/PHASE1-PLAN.md` is the design
source; where this file differs (see [Deviations and errata](#deviations-and-errata)), **this file wins** for
implementation.

- [Layer matrix](#layer-matrix)
- [Ownership map per wave](#ownership-map-per-wave)
- [Contract-change protocol](#contract-change-protocol)
- [Global coding rules](#global-coding-rules)
- [Test helpers](#test-helpers)
- [Event flow](#event-flow)
- [State machine notes](#state-machine-notes)
- [Versus addendum](#versus-addendum)
- [Adding a theme](#adding-a-theme)
- [three 0.186 API findings](#three-0186-api-findings)
- [Module API manifest](#module-api-manifest)
- [Deviations and errata](#deviations-and-errata)
- [Toolchain](#toolchain)

## Layer matrix

Imports only point downward. Enforced by `scripts/check-arch.mjs` (and `no-restricted-imports` for `three` in
ESLint). A directory may always import itself.

| Layer | Directory     | May import                                                                                               |
| ----- | ------------- | -------------------------------------------------------------------------------------------------------- |
| L0    | `contracts/`  | nothing (type-only files plus `as const` id arrays)                                                      |
| L1    | `core/`       | contracts                                                                                                |
| L2    | `config/`     | contracts, core                                                                                          |
| L2    | `themes/`     | contracts, core, config                                                                                  |
| L3    | `engine/`     | L0-L2                                                                                                    |
| L3    | `input/`      | L0-L2                                                                                                    |
| L3    | `entities/`   | L0-L2                                                                                                    |
| L3    | `upgrades/`   | L0-L2                                                                                                    |
| L3    | `save/`       | L0-L2                                                                                                    |
| L4    | `sim/`        | L0-L2, entities, upgrades                                                                                |
| L4    | `states/`     | L0-L2, upgrades (never sim/engine/render/audio/ui concretely: only the `Services` ports)                 |
| L5    | `shaders/`    | contracts                                                                                                |
| L5    | `assets/`     | L0-L2, shaders, `render/InstanceBatch.ts`, `render/GpuRingBuffer.ts`, `render/assetTypes.ts`, **three**  |
| L5    | `render/`     | L0-L2, shaders, **three** (consumes assets only through `ThreeAssetLibrary` from `render/assetTypes.ts`) |
| L5    | `audio/`      | L0-L2                                                                                                    |
| L5    | `ui/`         | contracts, core                                                                                          |
| L6    | `debug/`      | contracts, core, `engine/PerfMonitor.ts`, **three**                                                      |
| L6    | `app/`        | everything, **three**                                                                                    |
| —     | `src/main.ts` | app, ui (CSS imports)                                                                                    |

- L3 siblings never import each other. `save/` and `input/` share key tables and binding validation through
  `config/keys.ts` and `config/bindings.ts` (Wave 0) instead.
- `tsconfig.pure.json` (lib ES2023, `types: []`) type-checks contracts, core, config, themes, engine, input,
  entities, sim, upgrades, save and states: those layers can never touch the DOM, node or three. Consequences:
  no `console`, `setTimeout`, `performance`, `crypto`, `structuredClone`, `TextEncoder` in those layers — inject
  them (`ClockPort`, `Logger`, `FrameScheduler`, `newSeed`).
- `three` is allowed only in assets/, render/, app/, debug/. No barrel `index.ts` files. No cycles between
  top-level directories.

## Ownership map per wave

After Wave 0, everything Wave 0 owns is **FROZEN** (contracts/**, core/**, config/**, themes/**, root configs,
scripts/**, tests/helpers/**, and the Wave 0 files listed below). Each agent writes only its own paths plus its
tests.

| Wave | Agent       | Owns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | FOUNDATION  | root files (package.json, lockfile, tsconfigs, vite/vitest/eslint/prettier configs, .editorconfig, .nvmrc, .gitignore, index.html), docs/ARCHITECTURE.md, scripts/\*, src/vite-env.d.ts, src/globals.d.ts, src/contracts/\*\*, src/core/\*\*, src/config/\*\* (incl. `versus.ts`, `keys.ts`, `bindings.ts`, `specials.ts`), src/themes/\*\*, src/engine/transitions.ts, src/sim/{createWorld,worldRecords,simEventChannels}.ts, src/render/{InstanceBatch,GpuRingBuffer,assetTypes}.ts, src/shaders/chunks/instancing.ts, src/shaders/shaderSource.ts, tests/helpers/\*\*, tests/core/\*\*, tests/config/\*\*, tests/engine/{transitions,helpers}.test.ts, tests/sim/createWorld.test.ts, tests/render/InstanceBatch.test.ts |
| 1    | W1-ENGINE   | engine/{StateMachine,GameLoop,FramePacer,PerfMonitor,ResolutionGovernor,lifecycle}.ts; tests/engine/\*\* (except Wave 0 files)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 1    | W1-INPUT    | input/{KeyboardDevice,IntentSampler,MenuNavigator,InputService}.ts; tests/input/\*\* (bindingValidation tests target `config/bindings.ts`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 1    | W1-COMBAT   | entities/{players,weapons,specials,projectiles,pickups,damage,cardEffects,linkBeam,revive,combo}.ts, sim/collision.ts; tests/entities/{weapons,revive,linkBeam,combo,damage}.test.ts, tests/sim/collision.test.ts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 1    | W1-CONTENT  | entities/{enemies,enemyBehaviors,bosses,bossPatterns}.ts, sim/{WaveDirector,rules,versusRules}.ts; tests/entities/{enemyBehaviors,bosses}.test.ts, tests/sim/{WaveDirector,rules,versusRules}.test.ts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 1    | W1-ECON     | upgrades/\*\*, save/\*\*; tests/upgrades/\*\*, tests/save/\*\*, tests/fixtures/\*\*                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 1    | W1-AUDIO    | audio/\*\*; tests/audio/\*\*                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 1    | W1-ART      | shaders/\*\* except `chunks/instancing.ts`, `shaderSource.ts` and `post/**`; assets/\*\*; tests/assets/\*\*                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 1    | W1-RENDER   | render/\*\* except `InstanceBatch.ts`, `GpuRingBuffer.ts`, `assetTypes.ts`; shaders/post/\*\*; tests/render/\*\* (except `InstanceBatch.test.ts`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 1    | W1-UI       | ui/\*\* including styles; tests/ui/\*\*                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2    | W2-SIM      | sim/{stepWorld,stateHash,RunSession}.ts; tests/sim/{determinism,soak,economy,RunSession}.test.ts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2    | W2-STATES   | states/\*\*; tests/states/\*\* (flow, shopFlow, gameOverCommit, versusFlow)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 3    | COMPOSITION | app/\*\*, src/main.ts, debug/\*\*, README.md; index.html transfers here                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

W1-CONTENT consumes these W1-COMBAT exports, frozen in the manifest below: `spawnProjectile`, `applyDamage`,
`applyBossDamage`, `damagePlayer`, `dropShards`, `grantShards`, `vacuumPickups`, `rebootAtWaveEnd`,
`livingPlayerCount`, `resetPlayersForRound`. If COMBAT lags, CONTENT tests against local doubles in its tests.
Kill side effects cross the boundary only through `world.deathQueue` (drained by `resolveEnemyDeaths`).

## Contract-change protocol

1. Frozen files are never edited by Wave 1+ agents. A needed change is written as a **CONTRACT CHANGE REQUEST**
   in the agent's final report: file, exact old and new TypeScript, reason, and every module affected.
2. The orchestrator batches requests between waves, applies them serially, updates this document (manifest and
   errata), and re-runs the full gate (`npm run verify:nobuild`, `npm run verify` from Wave 3).
3. Additive changes (a new optional helper, a new event kind) are preferred over breaking ones. Removing or
   renaming a contract member requires every consumer's owner to acknowledge.
4. Until a request is applied, agents work around it locally (adapter inside their own files, local test double)
   and never with `any`, casts through `unknown` of foreign types, or edits to frozen files.

## Global coding rules

- Strict TS (see tsconfig). No `any`, `@ts-ignore`, TODO/FIXME, placeholders or "not implemented" stubs, `enum`,
  `namespace`, default exports in src, or barrels. Named exports only. Files <= 400 lines (split early).
- `erasableSyntaxOnly` also bans **constructor parameter properties** (`constructor(private x: T)`): declare
  fields explicitly.
- All content is procedural: no binary assets, no `?raw` GLSL (GLSL lives in TS template strings).
- Hot paths (anything per tick or per frame) are allocation-free: indexed `for` loops only; no
  `map/filter/forEach`, spread, closures, template strings or object literals; module-scope scratch objects;
  out-params (`core/math.ts`). Event producers fill `channel.push()` structs in place (write every field).
- Randomness in the sim only through `world.rng.sim` (shop offers through `world.rng.shop` forks). Visual
  randomness uses a separate fx rng in render/.
- Scoped verification for parallel agents:
  `node scripts/typecheck-scope.mjs <paths>`, `npx eslint <paths> --max-warnings=0`,
  `npx vitest run tests/<area>`, `node scripts/check-arch.mjs`.

## Test helpers

All in `tests/helpers/` (frozen, node-only, conforming to the contracts):

| File                 | Provides                                                                                                                                                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fakeClock.ts`       | `FakeClock` (ClockPort: `now`, `advance`, `set`), `FakeScheduler` (FrameScheduler: `runFrame(ts)`, `runFrames(n, dtMs)`, `runDeltas([...])`; callbacks run on the next frame)                                                |
| `fakeKeyboard.ts`    | `FakeKeyTarget` (KeyEventTargetLike: `down/up/tap/repeat/dispatch` returning `prevented`, `listenerCount`, `log`)                                                                                                            |
| `fakeWindow.ts`      | `FakeEventTarget`, `FakeDocument` (`hidden`, `fullscreenElement`, `setHidden`), `FakeWindow` for `installLifecycle`                                                                                                          |
| `memoryStorage.ts`   | `MemoryStorage` (StorageLike with `failMode` 'quota'/'security', `failNextWrites`, `quotaChars`, `rawSet/rawGet`), `keyValueOf(storage)`                                                                                     |
| `scriptedIntents.ts` | `createIntent(s)`, `resetIntent`, `setIntent`, `ScriptedIntents('idle' \| 'fire' \| 'kite' \| 'random', seed).at(tick)`, `StepScript([{ticks, p0, p1}]).at(tick)`                                                            |
| `worldFixture.ts`    | `testWorldConfig`, `createTestWorld({seed, mode, vehicles, startShards, startKernels})`, `addTestEnemy/PlayerShot/EnemyShot/Pickup`, `placePlayer`, `stepSystem(w, sys, n)`                                                  |
| `fakePorts.ts`       | `FakeRenderPort`, `FakeUiPort` (`vm(screen)`, `click`), `NullAudio`, `FakeAssets` (instant or manual `finishBuild/finishWarmup`), `FakeInputPort` (`queueMenu`, `next[p]`, `pressAnyKey`, `capture`), `FakeLoop`, `FakePerf` |
| `fakeStates.ts`      | `SpyState` / `createSpyStates(log)` (lifecycle log lines like `Playing.onCovered(Paused)`), `FakeFsm` (records requests, validates against EDGES)                                                                            |
| `fakeSave.ts`        | `TEST_SETTINGS`, `createTestSaveData(patch)`, `FakeSaveStore` (in-memory deltas, `commitRun` idempotency, `emitExternal`), `applyDelta`                                                                                      |
| `fakeRun.ts`         | `FakeRunSession` (real test world, `setFlags`, `shops`, `winner`), `FakeShop`, `createFakeRunFactory`, `testRunConfig(patch)`                                                                                                |
| `fakeServices.ts`    | `createFakeServices({save, fsm, seed})` returning `services` plus every fake                                                                                                                                                 |
| `callRecorder.ts`    | `CallRecorder` (`record`, `count`, `last`, `methods`) used by the fakes                                                                                                                                                      |

## Event flow

```text
PlayingState.fixedUpdate (x N per frame, 1/120 s)
  input.sample(p, intent) -> run.tick(intents) -> stepWorld systems push structs into world.events.*
  -> PlayingState reads run.flags and requests transitions (queued, applied at the start of the next frame)
PlayingState.update (once per frame)
  render.consumeEvents(world.events)   // FxDirector: particles, shockwaves, shake, digits, ripples
  audio.consumeEvents(world.events)    // AudioEventRouter: sfx, pitch ladder
  hud VM from world + events (10 Hz text throttle)
  run.clearEvents()                    // every channel cleared exactly once per frame
PlayingState.render(alpha, frameDt)
  render.frame(alpha, frameDt) -> RenderBridge publishes the ground view rect via run.setViewRect
```

Consumers never clear channels; only `RunSession.clearEvents()` does. Channels overflow by dropping (counted in
`dropped`). The death queue is separate from SimEvents: `applyDamage` pushes `DeathRecord`s, and
`resolveEnemyDeaths` (system 8) drains and clears it within the same tick.

System order inside `stepWorld` (fixed): 1 players, 2 weapons, 3 specials, 4 cardEffects, 5 enemies + boss AI
(+ pending spawns), 6 projectiles, 7 grid rebuild + collision, 8 resolveEnemyDeaths, 9 linkBeam, 10 pickups,
11 revive, 12 combo, 13 WaveDirector, 14 rules (`stepRules` for solo/coop, `stepVersusRules` for versus). Then
`tick++`, `time = tick * SIM.DT`, `run.elapsed += dt`. Systems 9, 11 and the kernel/ghost parts of 13-14 are
no-ops in versus (each system checks `w.mode`).

## State machine notes

- `engine/transitions.ts` holds the frozen table: 16 numbered edges, 17 entries (edge 13 is Paused -> Playing |
  UpgradesShop). Every other (from, to) pair is invalid.
- Replace/push requests: `fsm.request(to, payload)`. **Pops use `fsm.requestPop()`** (no payload; the state
  below receives `onUncovered(from)`).
- Edge 9 (Playing -> GameOver) accepts `outcome: 'defeat' | 'victory'` — victory from Playing is the versus match
  end. Edge 12 (UpgradesShop -> GameOver) accepts only victory (EXTRACT). Edge 14 only `abandoned`.
- Strict mode (`Services.env.strict`, DEV and tests): an invalid request throws `InvalidTransitionError`; PROD
  logs and returns false. States never rely on `false` for control flow.
- The frozen frame: on `onCovered`, the base state calls `render.renderFrozen(dim)` once. The FSM then renders
  nothing while an overlay is on top. `RenderBridge` re-renders its own frozen frame on resize while frozen.

## Versus addendum

VERSUS is the competitive mode for 2 joined players. `RunMode = 'solo' | 'coop' | 'versus'` is part of
`RunConfig.mode`, `RunSummary.mode`, `RunCounters.mode`, `WorldView.mode`, `ShopVisitSnapshot.mode` and every
VM that differs. Numbers live in `src/config/versus.ts`.

**Mode picker.** CharacterSelect shows a MODE row once P2 joins: CO-OP / VERSUS (either player toggles it with
left/right while their cursor is on the row). With P2 absent the mode is solo and the row is hidden. The last
mode is saved in `SaveDataV1.lastMode` and prefilled on Retry (`StatePayloads.CharacterSelect.mode`).

**Match.** Best of 5 ROUNDS: first to 3 round wins (`ROUNDS_TO_WIN`). If draws leave the score level after round
5, up to 2 tiebreak rounds follow (`TIEBREAK_ROUNDS`); if it is still level the match is a draw
(`summary.winner = null`). Same arena. Players spawn mirrored at x = +-10 facing up, full HP, overdrive 0, dash
charges full, specials reset; enemies, bullets, lasers and pending spawns are cleared between rounds and
remaining pickups are vacuumed to the nearest player.

**Hazards.** PvE enemies still spawn at `THREAT_MUL` 0.6 x the normal wave budget, using the wave table row
`versusWaveForRound(r) = min(3r - 2, 13)` stepped down by one when it lands on a boss wave (rounds 1-5 use waves
1, 4, 7, 9, 13). Never bosses. HP scaling is that wave's, with the 2P multiplier. Enemies target the nearest
living player.

**PvP damage.** Player shots hit the opponent at `PVP_DAMAGE_MUL` 45% of their enemy damage; specials that deal
damage (Railburst, Blink Swarm mines) at `PVP_SPECIAL_DAMAGE_MUL` 25%. Firewall deletes the opponent's bullets
(and enemy bullets). Patch Drone heals only its owner (its turret targets enemies only). Dash i-frames apply to
PvP. Bulwark's ram dash does not damage the opponent. Chain Arc, Orbitals, Afterimage and Micro-Missiles target
enemies only. Craft-to-craft contact is a soft push only. `damagePlayer(w, p, amount, source, ...)` applies the
PvP multiplier itself when `source` is a player index; callers pass unscaled damage and `kind: 'pvp'` or
`'pvpSpecial'`.

**Round end.** A round ends when a player is Downed: no revive, no bleed-out, no kernel; Downed = eliminated for
the round (life stays `'downed'`, a `player` event `'eliminated'` fires). Both downed on the same tick = draw.
Round timer 90 s (`ROUND_TIME`, in `run.waveTimer`); at timeout the higher HP fraction (hp / maxHp) wins; an exact
tie starts SUDDEN DEATH (`run.suddenDeath = true`, both players' hp set to `min(hp, 1)`) for up to 20 s, then
the round is a draw (no point). After the round: 2 s `roundOutro` (players invulnerable, bullets wiped), then
`flags.roundOver` (match continues) or `flags.matchOver` (match decided).

**Disabled in versus.** Link Beam, Echo Drone, revive, Spare Kernels (`run.spareKernels = 0`), Offline ghost,
team row, Gift, sync kills, clear bonus, purge, EXTRACT/PUSH DEEPER. Combo stays per player.

**Shards.** Per-player wallets as in co-op, from kills and pickups (catch-up bonus still applies). Round end:
winner +40 (`ROUND_WIN_SHARDS`), loser +60 (`ROUND_LOSS_SHARDS`, catch-up), draw +40 each
(`ROUND_DRAW_SHARDS`). Granted by `stepVersusRules` when the round result is decided.

**Shop.** `UpgradesShop{midrun}` opens between rounds (after `roundOver`). Team row and Gift are hidden
(`teamVisible = false`, `giftVisible = false`); team/gift transactions fail with `'unavailable'`. Stat rows,
repair, cards, reroll, lock, undo and ready behave as co-op. No final visit. After the match-deciding round,
PlayingState replaces to `GameOver{outcome: 'victory'}` (edge 9); `summary.winner` is set (null on a draw).

**Cores.** 5 per round won (`CORES_PER_ROUND_WIN`, both players' wins count: one shared profile) + 10 if the match
has a winner (`CORES_MATCH_WIN`), total capped at 60 per match (`CORES_CAP`). Abandoned matches pay the round part
only. Committed once via `save.commitRun(runId, delta)` exactly like co-op. Versus results update
`records.versusMatches` and never `victories`/`bestWave`.

**Camera.** Same adaptive framing of both players. There are no downed/offline cases: an eliminated player is
still framed (downed padding) until the round ends.

**Contracts.** `RunCounters` gets `round`, `roundWins: [number, number]`, `suddenDeath`, `roundWinner`,
`matchWinner` (and `mode`). `RunFlags`/`MutableRunFlags` get `roundOver` and `matchOver`. **Decision:**
`RunSessionApi.beginNextWave()` handles both modes — in versus it starts the next round (there is no separate
`beginNextRound`). PlayingState.enter calls it once to start wave/round 1.

**Files.** `src/config/versus.ts` (Wave 0), `src/sim/versusRules.ts` (W1-CONTENT, next to rules.ts),
`tests/sim/versusRules.test.ts` (W1-CONTENT). Also: versus cases in `tests/upgrades/ShopModel.test.ts` (team
row and gift -> `'unavailable'`), `tests/upgrades/rewards.test.ts` (versus Cores formula and cap) and
`tests/states/versusFlow.test.ts` (CharacterSelect mode row -> Playing -> roundOver -> shop -> Playing ->
matchOver -> GameOver victory with winner).

## Adding a theme

1. Add the id to `THEME_IDS` in `contracts/ids.ts` (contract change).
2. Write `src/themes/<id>.ts` exporting one `ThemeDef` (pure data: names, palette, geometry recipe params,
   shading modes, audio params) and register it in `themes/registry.ts` `THEMES`.
3. Every floor mode (`GRID`, `CAUSTICS`, `LAVA`) and sky mode (`NEBULA_GLYPHS`, `ABYSS_RAYS`, `CORONA`) is
   implemented behind compile-time defines (`assets/materials.ts` floorDefines/skyDefines). The enemy families
   `organic`/`mineral` and hull styles `sub`/`tug` are still reserved (the geometry builders throw): all three
   shipped themes use `platonic`/`sled`/`edges`, recoloured by their palettes. Music style follows
   `audio.timbre` (`audio/timbre.ts` presets + `audio/composerStyles.ts` arrangements).
4. Theme changes apply on reload: `app/createServices` peeks the saved theme (`SaveStore.peekThemeId`) before
   building assets, so defines are fixed at Boot and nothing recompiles at runtime; Settings shows RESTART TO
   APPLY, which calls `services.reloadApp()`. Mechanics never read the theme: only render/audio/ui/viewModels do.
   Run `tests/render/sectorPalette.test.ts` (colour distances) and `tests/config/themes.test.ts` (completeness).

## three 0.186 API findings

Verified against `node_modules/@types/three` 0.186.0 and `three` 0.186.1 sources:

- `BufferAttribute.addUpdateRange(start, count)` / `clearUpdateRanges()` and
  `InterleavedBuffer.addUpdateRange` / `clearUpdateRanges` exist; `updateRanges: {start, count}[]` is public.
  `addUpdateRange` **allocates** a `{start, count}` object per call, and `WebGLAttributes.updateBuffer` sorts and
  merges the ranges, uploads, then calls `clearUpdateRanges()` itself. `InstanceBatch`/`GpuRingBuffer` therefore
  keep persistent range objects and push them into `updateRanges` directly (zero allocation), then set
  `needsUpdate = true`. Units are array elements (floats), not instances. An empty `updateRanges` with
  `needsUpdate` uploads the whole buffer.
- `InstancedBufferGeometry.instanceCount: number` exists. The renderer draws
  `min(instanceCount, _maxInstanceCount)` instances and skips the draw when it is 0. Batches also toggle
  `mesh.visible` to skip state setup.
- `InstancedInterleavedBuffer(array, stride, meshPerAttribute)` + `InterleavedBufferAttribute(buffer, itemSize,
offset)` give the 2 x vec4 per-instance layout.
- `WebGLRenderer.compileAsync(scene, camera, targetScene?) => Promise<Object3D>` exists (use for ShaderWarmup).
  `renderer.initTexture(texture)` exists. `renderer.debug.checkShaderErrors` is available.
- `ShaderMaterial.glslVersion: GLSLVersion | null` with `GLSL3 = "300 es"`. Use `glslVersion: GLSL3` on plain
  `ShaderMaterial` (three injects `#version 300 es` and the built-in attributes/uniforms); write `in`/`out`
  and a declared `out vec4` fragment output.
- `THREE.Clock` is deprecated ("use THREE.Timer"); the engine uses its own clock anyway (`ClockPort`).

## Module API manifest

Exact exported signatures for every Wave 1 and Wave 2 module. Implementations may add **non-exported** helpers
freely and may add exports, but must not change these. Types come from `src/contracts/*` unless noted.
`SimSystem = (w: WorldState, intents: Intents, dt: number) => void`.

### engine/ (W1-ENGINE)

```ts
// engine/StateMachine.ts
export class InvalidTransitionError extends Error {
  readonly from: StateId;
  readonly to: StateId | 'pop';
  constructor(from: StateId, to: StateId | 'pop', reason: string);
}
export type StateRegistry = { readonly [S in StateId]: GameState<S> };
export interface InputEdgeHooks {
  clearEdges(): void;
  suppressHeldUntilRelease(): void;
}
export interface StateMachineDeps {
  readonly states: StateRegistry;
  readonly input: InputEdgeHooks;
  readonly log: Logger;
  /** Throw InvalidTransitionError instead of log-and-drop. */
  readonly strict: boolean;
  /** Defaults to EDGES from engine/transitions.ts. */
  readonly edges?: readonly Edge[];
}
export interface StateMachine extends StateMachineApi {
  /** Enters Boot (from = null). Call once. */
  start(): void;
  /** Applies up to MAX_APPLIES_PER_FRAME queued requests, re-validated against the live stack; returns count. */
  applyPending(): number;
  fixedUpdate(dt: number): void; // top state only
  update(frameDt: number): void; // top state only
  render(alpha: number, frameDt: number): void; // top state if it is not an overlay with worldBelow 'frozen'
  readonly pendingCount: number;
}
export function createStateMachine(deps: StateMachineDeps): StateMachine;

// engine/GameLoop.ts
export interface FrameSample {
  frameMs: number;
  simMs: number;
  cpuMs: number;
  steps: number;
  dropped: number;
}
export interface LoopHooks {
  applyPending(): void;
  fixedUpdate(dt: number): void;
  update(frameDt: number): void;
  render(alpha: number, frameDt: number): void;
  /** Reused sample object: copy what you need. */
  recordPerf(sample: Readonly<FrameSample>): void;
}
export interface GameLoopDeps {
  readonly scheduler: FrameScheduler;
  readonly clock: ClockPort; // CPU timing only; sim time comes from rAF timestamps
  readonly hooks: LoopHooks;
  readonly pacer: FramePacer | null;
}
export interface GameLoop extends LoopControl {
  start(): void;
  stop(): void;
  readonly running: boolean;
  /** Total fixed steps dropped by the MAX_STEPS clamp. */
  readonly droppedSteps: number;
  readonly alpha: number;
}
export function createGameLoop(deps: GameLoopDeps): GameLoop;

// engine/FramePacer.ts
export interface FramePacer {
  setCap(cap: FrameCap): void;
  /** 'auto' only degrades to a 60 cap while playing. */
  setPlaying(on: boolean): void;
  /** Called with every rAF timestamp; true when this callback should run a frame. */
  shouldRun(timestampMs: number): boolean;
  readonly refreshHz: number;
  readonly effectiveCap: 60 | 120 | null;
}
export function createFramePacer(): FramePacer;

// engine/PerfMonitor.ts
export interface PerfMonitor extends PerfPort {
  record(s: Readonly<FrameSample>): void;
  /** First call records the Boot baseline; growth afterwards logs a DEV error. */
  setProgramCount(programs: number): void;
  percentile(series: 'frame' | 'sim' | 'cpu', p: number): number;
  missedVsyncRatio(refreshHz: number): number;
  readonly frames: number;
}
export function createPerfMonitor(deps: { readonly log: Logger }): PerfMonitor;

// engine/ResolutionGovernor.ts
export type GovernorAction =
  | { readonly kind: 'renderScale'; readonly value: number }
  | { readonly kind: 'msaa'; readonly value: 0 | 2 | 4 }
  | { readonly kind: 'frameCap'; readonly value: 60 | null };
export interface ResolutionGovernor {
  /** At most one action per GOVERNOR.MIN_STEP_INTERVAL_S; evaluates only while playing. */
  evaluate(nowS: number, p95Ms: number, playing: boolean): GovernorAction | null;
  readonly step: number;
  reset(preset: QualityPreset): void;
}
export function createResolutionGovernor(preset: QualityPreset): ResolutionGovernor;

// engine/lifecycle.ts (pure-typed; no DOM lib)
export interface ListenerTarget {
  addEventListener(type: string, fn: (e: { preventDefault(): void }) => void): void;
  removeEventListener(type: string, fn: (e: { preventDefault(): void }) => void): void;
}
export interface WindowLike extends ListenerTarget {
  readonly document: ListenerTarget & { readonly hidden: boolean; readonly fullscreenElement: unknown };
}
export interface LifecycleDeps {
  readonly input: Pick<InputPort, 'releaseAll'>;
  readonly fsm: StateMachineApi;
  readonly audio: Pick<AudioPort, 'suspend' | 'resume'>;
  readonly save: Pick<SaveStorePort, 'flush'>;
  /** Canvas for webglcontextlost/restored (null in tests). */
  readonly canvas: ListenerTarget | null;
  readonly log: Logger;
}
/** Returns an uninstall function. */
export function installLifecycle(target: WindowLike, deps: LifecycleDeps): () => void;
```

### input/ (W1-INPUT)

Key tables and binding validation are Wave 0 files: `config/keys.ts` (`KNOWN_CODES`, `FORBIDDEN_CODES`,
`RESERVED_CODES`, `PREVENT_DEFAULT_EXTRA`, `DEFAULT_BINDINGS`, `MENU_KEYS`, `MENU_REPEAT`, `keyLabel`) and
`config/bindings.ts` (`validateBindings`, `proposeSwap`, `resetInvalidActions`, `findBinding`). Do not create
input/keyCodes.ts, defaultBindings.ts or bindingValidation.ts.

```ts
// input/KeyboardDevice.ts
export interface KeyboardDevice {
  /** -1 for unknown codes (ignored without allocating). */
  slotOf(code: KeyCode): number;
  isDown(slot: number): boolean;
  /** Monotonic press counter per slot (tap latching: pressCount > lastSeen). */
  pressCount(slot: number): number;
  /** Global sequence number of the slot's last press (SOCD last-wins). */
  lastPressSeq(slot: number): number;
  releaseAll(): void;
  /** Keys still physically held must be released and pressed again before they count. */
  suppressHeldUntilRelease(): void;
  /** Codes that get preventDefault (bound codes; PREVENT_DEFAULT_EXTRA always). */
  setBoundCodes(codes: ReadonlySet<KeyCode>): void;
  /** Fresh non-modifier keydown notifications (captureNextKey, consumeAnyKey). Returns unsubscribe. */
  onKeyDown(cb: (code: KeyCode) => void): () => void;
  readonly heldCodes: ReadonlySet<KeyCode>;
  readonly metaHeld: boolean;
  dispose(): void;
}
export function createKeyboardDevice(target: KeyEventTargetLike): KeyboardDevice;

// input/IntentSampler.ts
export interface IntentSampler {
  setBindings(b: Bindings): void;
  setSolo(solo: boolean): void;
  setFireModes(autofire: readonly [boolean, boolean], focusToggle: readonly [boolean, boolean]): void;
  sample(p: PlayerIndex, out: PlayerIntent): void;
  clearEdges(): void;
}
export function createIntentSampler(device: KeyboardDevice, bindings: Bindings): IntentSampler;

// input/MenuNavigator.ts
export interface MenuNavigator {
  setBindings(b: Bindings): void;
  setContext(c: InputContext): void;
  poll(frameDtMs: number, out: MenuIntent[]): number;
  clearEdges(): void;
}
export function createMenuNavigator(device: KeyboardDevice, bindings: Bindings): MenuNavigator;

// input/InputService.ts
export interface InputService extends InputPort {
  readonly device: KeyboardDevice;
  dispose(): void;
}
export function createInputService(deps: {
  readonly target: KeyEventTargetLike;
  readonly bindings: Bindings;
}): InputService;
```

### entities/ and sim/collision.ts (W1-COMBAT)

```ts
// entities/players.ts
export const stepPlayers: SimSystem; // movement, focus, facing + aim assist, dash (i-frames, charges, ram), arena clamp, ghost view clamp, prev copy, soft push
/** Sets stats; max-HP increases heal by the delta, decreases clamp hp to >= 1. Also clamps dash charges. */
export function applyPlayerStats(p: PlayerEntity, stats: DerivedStats): void;
/** Versus round start / respawn helper: position at spawnPosition(), full hp, reset dash/special/overdrive/flags. */
export function resetPlayersForRound(w: WorldState): void;

// entities/weapons.ts
export const stepWeapons: SimSystem; // cadence accumulator (multi-shot per tick), twin/spread/needle/arc, split/pierce/ricochet/homing, FORK(), Overheat (+40% fire rate at runtime, overflow -> damage)

// entities/specials.ts
export const stepSpecials: SimSystem; // Railburst, Firewall, Blink Swarm, Patch Drone, tiers, SUDO
/** Adds meter (scaled by stats.specialChargeMul), clamped to OVERDRIVE.MAX. */
export function addOverdrive(w: WorldState, p: PlayerIndex, amount: number): void;

// entities/projectiles.ts
export const stepProjectiles: SimSystem; // linear + homing integration, lifetime, wall bounce
/** Player side recycles the oldest shot when full (never null); enemy side returns null when full. */
export function spawnProjectile(w: WorldState, spec: Readonly<ProjectileSpec>): ProjectileEntity | null;

// entities/pickups.ts
export const stepPickups: SimSystem; // magnet, blink/despawn, collection (catch-up, combo bonus, shardGain, ghost 50%)
export function spawnPickup(w: WorldState, x: number, z: number, value: number): PickupEntity | null;
/** Splits `total` into 25/5/1 denominations with seeded scatter. */
export function dropShards(w: WorldState, x: number, z: number, total: number): void;
/** Raw wallet credit (clamped to ECONOMY.WALLET_MAX, adds to shardsEarned); returns credited amount. */
export function grantShards(w: WorldState, p: PlayerIndex, amount: number): number;
/** Credits every live pickup to the nearest living (else any present) player immediately, with pickup events. */
export function vacuumPickups(w: WorldState): void;

// entities/damage.ts
export type PlayerDamageKind = 'contact' | 'projectile' | 'laser' | 'pvp' | 'pvpSpecial';
/**
 * Damage to an enemy: Warden front arc (from fromX/fromZ) blocks, crit already rolled by the caller, Mark +20%,
 * hit flash, damageDealt/overdrive credit. On kill: dying = true, score/combo (registerKill), drops (dropShards),
 * kill event, DeathRecord pushed to w.deathQueue. Returns damage dealt (0 when blocked or already dying).
 */
export function applyDamage(
  w: WorldState,
  e: EnemyEntity,
  amount: number,
  source: DamageSource,
  fromX: number,
  fromZ: number,
  crit: boolean,
): number;
/** Boss part damage (hp clamped at 0, flash, lastHitBy, hit event). Phases/death are handled by stepBoss. */
export function applyBossDamage(
  w: WorldState,
  b: BossEntity,
  amount: number,
  source: DamageSource,
  crit: boolean,
): number;
/**
 * Damage to a player: i-frames/invulnUntil, Nanoshield, armor (contact only), PvP multipliers when source is a
 * player (VERSUS.PVP_DAMAGE_MUL / PVP_SPECIAL_DAMAGE_MUL), combo halving, hurt event; hp <= 0 -> 'downed'
 * (co-op/solo bleed-out starts; versus: eliminated, 'eliminated' event). Returns damage taken.
 */
export function damagePlayer(
  w: WorldState,
  p: PlayerEntity,
  amount: number,
  source: DamageSource,
  fromX: number,
  fromZ: number,
  kind: PlayerDamageKind,
): number;
/** Offline ghost touch: +20% damage taken for COOP.MARK_DURATION. */
export function markEnemy(w: WorldState, e: EnemyEntity): void;

// entities/cardEffects.ts
export const stepCardEffects: SimSystem; // Orbitals, Micro-Missiles, Afterimage, Chain Arc, Vampire Code, Nanoshield recharge, Overheat flag

// entities/linkBeam.ts
export const stepLinkBeam: SimSystem; // 4..linkRange band, echo drone (solo, 60%), segment damage via applyDamage (SOURCE_LINK), Leech latch/cut; no-op in versus

// entities/revive.ts
export const stepRevive: SimSystem; // crawl, bleed-out (12 s, -2 s per repeat down, min 6), revive progress/decay, auto kernel, Offline ghost + Mark, no-living-player kernel rule; no-op in versus
/** Wave-end reboot: Downed -> 40% hp, Offline -> 30% hp (co-op/solo). */
export function rebootAtWaveEnd(w: WorldState): void;
/** Players with life 'alive' (or 'respawning'). */
export function livingPlayerCount(w: WorldState): number;

// entities/combo.ts
export const stepCombo: SimSystem; // chain timers, tier events
/** Called by applyDamage on every kill; handles chains, tiers, sync kills (co-op only), score. */
export function registerKill(w: WorldState, by: DamageSource, x: number, z: number, baseScore: number): void;
/** Halves the chain on hit (COMBO.HIT_KEEP). */
export function registerPlayerHit(w: WorldState, p: PlayerIndex): void;
/** Current tier multipliers (ROOT ACCESS adds a tier). */
export function comboScoreMul(p: Readonly<PlayerEntity>): number;
export function comboShardBonus(p: Readonly<PlayerEntity>): number;

// sim/collision.ts
export const stepCollision: SimSystem; // grid rebuild (enemy SLOTS + radius) + swept player shots vs enemies (3x3 query), shots vs bosses, enemy shots vs players, PvP shots vs opponent (versus), contact, lasers, Firewall deletion
```

### entities/ and sim/ content (W1-CONTENT)

```ts
// entities/enemies.ts
/** Applies w.run.enemyHpMul (fixed at wave start) and the elite multiplier; returns null when the pool is full. */
export function spawnEnemy(
  w: WorldState,
  kind: EnemyKind,
  x: number,
  z: number,
  elite: boolean,
  splitGen: number,
): EnemyEntity | null;
export const stepEnemies: SimSystem; // behaviours, separation (<= 6 neighbours), staggered retarget (slot % 30), pending spawns
/** Drains and clears w.deathQueue: despawn dying enemies, Fork splits, Leech unlatch. */
export function resolveEnemyDeaths(w: WorldState): void;

// entities/enemyBehaviors.ts
export const AI_STATE: { readonly [name: string]: number }; // behaviour state indices stored in EnemyEntity.ai
export function stepEnemyBehavior(w: WorldState, e: EnemyEntity, dt: number): void;

// entities/bosses.ts
export function spawnBoss(w: WorldState, id: BossId): void; // uses w.bosses records, 2P HP x1.6, intro
export const stepBoss: SimSystem; // phases at 66/33%, enrage at 150 s, Race Condition window (3 s co-op / 6 s solo), Fork Bomb splits, death -> bossesKilled + drops
export function bossAlive(w: WorldView): boolean;

// entities/bossPatterns.ts
/** Advances one attack step for a boss part; returns true when the step finished. Writes enemy shots, lasers, telegraphs. */
export function runPattern(w: WorldState, b: BossEntity, step: AttackStep, dt: number): boolean;

// sim/WaveDirector.ts
export interface WavePlan {
  readonly wave: number;
  readonly budget: number; // after playerCount/mode multipliers
  readonly duration: number;
  readonly pulseInterval: number;
  readonly unlocked: readonly EnemyKind[];
  readonly boss: BossId | null;
  readonly hpMul: number;
  readonly threatMul: number;
}
/** Pure. mode 'versus' => THREAT_MUL and never a boss. */
export function generateWavePlan(wave: number, playerCount: 1 | 2, mode: RunMode): WavePlan;
/** Resets w.director for the plan. */
export function startWave(w: WorldState, plan: WavePlan): void;
export const stepWaveDirector: SimSystem; // pulses, formations, farthest 3 of 8 portals, telegraphs, 180 cap + deferral, boss spawn

// sim/rules.ts (co-op/solo)
/** Starts wave `wave`'s countdown: sets wave/sector/overflow, fixes enemyHpMul/threatMul, startWave(generateWavePlan(...)). */
export function beginWave(w: WorldState, wave: number): void;
export const stepRules: SimSystem; // countdown, wave timer + purge, clear outro (bullet wipe, invuln, slow-mo via timeScaleRequest, vacuum, reboot, clear bonus), waveClearReady, finalVisit, victory flags, wipe grace -> defeat; clear beats wipe

// sim/versusRules.ts
/** Starts round `round`: resetPlayersForRound, clear pools, hazards plan (versusWaveForRound), 3 s countdown. */
export function beginVersusRound(w: WorldState, round: number): void;
export const stepVersusRules: SimSystem; // elimination, 90 s timer, HP-fraction timeout, sudden death, draws, round shards, roundOutro -> roundOver | matchOver
/** Pure timeout decision: 0/1 winner by hp fraction, -1 exact tie. */
export function decideTimeout(p0HpFrac: number, p1HpFrac: number): 0 | 1 | -1;
```

### upgrades/ and save/ (W1-ECON)

```ts
// upgrades/pricing.ts (integers only)
export function round5(n: number): number;
export function waveInflation(wave: number): number; // 1 + 0.06 (w - 1)
export function statRowPrice(id: StatRowId, level: number, wave: number): number; // price of level -> level+1
export function cardPrice(id: CardId, wave: number): number; // Shard Cache = 0
export function repairPrice(wave: number, boughtThisVisit: number): number;
export function kernelPrice(boughtThisRun: number): number;
/** null when maxed. Spare Kernel uses kernelPrice. */
export function teamPrice(id: TeamItemId, level: number, kernelsBoughtThisRun: number): number | null; // explicit prices, not wave-inflated
export function rerollPrice(rerollsThisVisit: number, wave: number): number;
export function metaPrice(id: MetaUpgradeId, level: number): number | null;

// upgrades/stats.ts
/** Pure, order-independent stacking + hard caps; fire-rate overflow above 20/s becomes a damage multiplier. */
export function computeStats(
  vehicle: VehicleId,
  meta: MetaLevels,
  rows: Readonly<Record<StatRowId, number>>,
  cards: Uint8Array, // stacks by CardDef.bit
  team: Readonly<Record<TeamItemId, number>>,
): DerivedStats;
export function capsReached(stats: DerivedStats, vehicle: VehicleId): ReadonlySet<NumericStat>;
export function emptyRowLevels(): Record<StatRowId, number>;
export function emptyTeamLevels(): Record<TeamItemId, number>;

// upgrades/offers.ts
export interface LockedCard {
  readonly id: CardId;
  readonly price: number;
}
export interface CardOffer {
  readonly id: CardId;
  readonly price: number;
  readonly locked: boolean;
}
export interface OfferContext {
  readonly sector: 1 | 2 | 3;
  readonly wave: number;
  readonly owned: Uint8Array;
  readonly legendaryPool: boolean;
  readonly locked: LockedCard | null;
}
/** 3 offers without replacement (a locked card keeps slot 0 at its original price), rarity fallback, Shard Cache. */
export function drawOffers(rng: Rng, ctx: OfferContext): readonly [CardOffer, CardOffer, CardOffer];

// upgrades/ShopModel.ts
export interface ShopModelInit {
  readonly mode: RunMode;
  readonly wave: number;
  readonly visit: number;
  readonly round: number;
  readonly finalVisit: boolean;
  readonly joined: readonly [boolean, boolean];
  readonly vehicles: readonly [VehicleId, VehicleId];
  readonly players: readonly [PlayerRunState, PlayerRunState]; // copied on init
  readonly team: TeamState; // copied on init
  readonly meta: MetaLevels;
  readonly locked: readonly [LockedCard | null, LockedCard | null];
  /** world.rng.shop; offers use rng.fork('shop', visit, player). */
  readonly rng: Rng;
}
export interface ShopResults {
  readonly players: readonly [PlayerRunState, PlayerRunState];
  readonly team: TeamState;
  readonly locked: readonly [LockedCard | null, LockedCard | null];
  readonly choice: FinalChoice | null;
}
export interface ShopModel extends ShopApi {
  results(): ShopResults;
}
export function createShopModel(init: ShopModelInit): ShopModel;

// upgrades/MetaShop.ts (pure operations on SaveDataV1)
export type MetaFailure = 'funds' | 'maxLevel' | 'alreadyUnlocked' | 'nothingToRefund' | 'invalid';
export type MetaResult =
  | { readonly ok: true; readonly price: number; readonly delta: SaveDelta }
  | { readonly ok: false; readonly reason: MetaFailure };
export function metaBuy(save: SaveDataV1, id: MetaUpgradeId): MetaResult;
export function metaUnlock(save: SaveDataV1, vehicle: VehicleId): MetaResult;
export function metaRespec(save: SaveDataV1): MetaResult; // refunds firmwareSpent; unlocks stay
export function respecRefund(save: SaveDataV1): number;
export function isVehicleUnlocked(save: SaveDataV1, vehicle: VehicleId): boolean;

// upgrades/rewards.ts
export type RewardLineId = 'shards' | 'waves' | 'bosses' | 'victory' | 'rounds' | 'matchWin';
export interface RewardLine {
  readonly id: RewardLineId;
  readonly amount: number;
}
export interface RewardBreakdown {
  readonly lines: readonly RewardLine[];
  readonly uncapped: number;
  readonly total: number;
  readonly capped: boolean;
}
/** co-op/solo: floor(shards/10) + 3 x waves + 15 x bosses + 40 victory, cap 400 (abandoned pays progress).
 *  versus: 5 x (roundWins[0] + roundWins[1]) + 10 if winner !== null (not when abandoned), cap 60. */
export function computeRunRewards(summary: RunSummary): RewardBreakdown;

// save/defaults.ts
export const DEFAULT_SETTINGS: Settings;
export const DEFAULT_SAVE: SaveDataV1;
export function createDefaultSave(): SaveDataV1;

// save/migrations.ts
export const MIGRATIONS: Readonly<Record<number, Migration>>;
/** Applies registry[v] for v = from .. target-1. Throws on a missing step. */
export function migrate(
  data: unknown,
  fromVersion: number,
  registry?: Readonly<Record<number, Migration>>,
  target?: number,
): unknown;

// save/sanitize.ts
/** JSON.parse with a reviver dropping __proto__/constructor/prototype keys; null on syntax error. */
export function safeJsonParse(text: string): unknown;
export interface SanitizeResult {
  readonly data: SaveDataV1;
  readonly refunded: number;
  readonly changed: boolean;
}
export function sanitizeSave(raw: unknown): SanitizeResult;

// save/storage.ts
/** try/catch wrapper over localStorage (or any StorageLike); falls back to memory when null/throwing. */
export function createKeyValueStorage(storage: StorageLike | null): {
  readonly kv: KeyValueStorage;
  readonly memoryOnly: boolean;
};

// save/SaveStore.ts
export interface SaveStoreDeps {
  readonly storage: KeyValueStorage;
  readonly memoryOnly: boolean;
  readonly clock: ClockPort;
  readonly log: Logger;
  readonly migrations?: Readonly<Record<number, Migration>>;
  /** External (other-tab) changes are applied only while this returns false. */
  readonly inRun: () => boolean;
}
export interface SaveStore extends SaveStorePort {
  /** Wire to window 'storage' events (Wave 3). */
  handleStorageEvent(key: string | null): void;
}
export function createSaveStore(deps: SaveStoreDeps): SaveStore;
```

### audio/ (W1-AUDIO)

```ts
// audio/AudioEngine.ts
export interface AudioEngineDeps {
  readonly theme: ThemeDef;
  readonly createContext: () => AudioContext;
  readonly createOfflineContext: (
    channels: number,
    length: number,
    sampleRate: number,
  ) => OfflineAudioContext;
  readonly log: Logger;
  readonly seed: number;
}
export interface AudioEngine extends AudioPort {
  dispose(): void;
}
export function createAudioEngine(deps: AudioEngineDeps): AudioEngine;

// audio/VoicePool.ts (pure scheduling logic)
export const CATEGORY_LIMITS: Readonly<Record<SfxCategory, number>>; // weapon 8, impact 6, explosion 6, pickup 4, player 4, ui 2, stinger 2
export class VoicePool {
  constructor(size: number, limits: Readonly<Record<SfxCategory, number>>);
  /** Voice index to use (stealing the oldest in the category), or -1 when coalesced (same id within 25 ms). */
  acquire(id: SfxId, category: SfxCategory, nowS: number, durationS: number): number;
  readonly active: number;
  readonly stolen: number;
  readonly coalesced: number;
}

// audio/AudioEventRouter.ts
export interface AudioEventRouter {
  route(e: SimEvents): void;
}
export function createAudioEventRouter(play: AudioPort['play'], arenaHalfWidth: number): AudioEventRouter;

// audio/theory.ts, Composer.ts, Sequencer.ts (pure/testable)
export function midiToHz(midi: number): number;
export const SCALES: Readonly<Record<'aeolian' | 'dorian' | 'phrygian', readonly number[]>>;
export function progression(theme: ThemeDef, sector: 1 | 2 | 3, boss: boolean): readonly number[]; // chord root midi per bar
export interface NoteEvent {
  instrument: string;
  midi: number;
  startBeat: number;
  lengthBeats: number;
  velocity: number;
}
export interface Composer {
  bar(index: number, mood: MusicMood, intensity: number, out: NoteEvent[]): number;
}
export function createComposer(theme: ThemeDef, seed: number): Composer;
export interface Sequencer {
  start(): void;
  stop(): void;
  tick(): void;
  setMood(m: MusicMood): void;
  setIntensity(x: number): void;
  readonly beatPhase: number;
}
export function createSequencer(deps: {
  readonly now: () => number;
  readonly composer: Composer;
  readonly schedule: (e: NoteEvent, whenS: number) => void;
  readonly bpm: number;
}): Sequencer;
```

### shaders/ and assets/ (W1-ART)

```ts
// every material shader module (shaders/neonSurface.ts, floor.ts, sky.ts, projectile.ts, particle.ts, beam.ts,
// decal.ts, marker.ts, digits.ts, shockwave.ts, trail.ts) exports one ShaderSource (shaders/shaderSource.ts):
export const NEON_SURFACE: ShaderSource; // also FLOOR, SKY, PROJECTILE, PARTICLE, BEAM, DECAL, MARKER, DIGITS, SHOCKWAVE, TRAIL
// chunks: GLSL_COMMON (common.ts), GLSL_NOISE (noise.ts), GLSL_LIGHTING (lighting.ts); GLSL_INSTANCING (Wave 0)

// assets/AssetLibrary.ts
export interface AssetLibraryDeps {
  readonly theme: ThemeDef;
  readonly quality: QualityPreset;
  readonly log: Logger;
  readonly seed: number;
}
/** Materials/geometries/textures are created during build(); getMaterial/getGeometry throw before build. */
export function createAssetLibrary(deps: AssetLibraryDeps): ThreeAssetLibrary;

// assets/materials.ts
export function createSharedUniforms(theme: ThemeDef): SharedUniforms;
// assets/noise.ts
export function createNoise(seed: number): {
  value2(x: number, y: number): number;
  simplex3(x: number, y: number, z: number): number;
  fbm2(x: number, y: number, octaves: number): number;
};
// assets/geometry/*
export function buildVehicleGeometry(id: VehicleId, theme: ThemeDef): BufferGeometry;
export function buildEnemyGeometry(kind: EnemyKind, theme: ThemeDef): BufferGeometry;
export function buildBossGeometry(id: BossId, theme: ThemeDef): BufferGeometry;
export function buildArena(theme: ThemeDef): {
  floor: BufferGeometry;
  wall: BufferGeometry;
  pylon: BufferGeometry;
  sky: BufferGeometry;
};
export function buildFxShapes(): {
  quad: BufferGeometry;
  ring: BufferGeometry;
  capsule: BufferGeometry;
  fullscreen: BufferGeometry;
};
export function buildVoxelText(text: string): BufferGeometry;
```

Every generated geometry carries `position`, `normal`, `color`, `aBary` (vec3) and `aEmissive` (float).
Batch materials use GLSL_INSTANCING; post materials (`post:*` keys) are built from `shaders/post/*` sources
owned by W1-RENDER (exports `BLOOM_PREFILTER`, `KAWASE_DOWN`, `KAWASE_UP`, `COMPOSITE`, `BLIT` as
ShaderSource, plus `FULLSCREEN_VERT`).

### render/ (W1-RENDER)

```ts
// render/RenderBridge.ts
export interface RenderBridgeDeps {
  readonly canvasHost: HTMLElement;
  readonly assets: ThreeAssetLibrary;
  readonly theme: ThemeDef;
  readonly settings: Settings;
  readonly log: Logger;
}
export interface RenderBridge extends RenderPort {
  readonly canvas: HTMLCanvasElement;
  /**
   * Call after assets.build(): creates batches (assets.createBatches()), views and PostFX targets, then runs
   * ShaderWarmup. Before warmup, attachWorld/frame/renderFrozen are no-ops. This is Services.assets.warmup.
   */
  warmup(): Promise<void>;
  /** Governor actions from engine/ResolutionGovernor (structurally typed). */
  applyGovernor(a: {
    readonly kind: 'renderScale' | 'msaa' | 'frameCap';
    readonly value: number | null;
  }): void;
  dispose(): void;
}
/** Creates the WebGL2 renderer and canvas immediately (capabilities are known after this call). */
export function createRenderBridge(deps: RenderBridgeDeps): RenderBridge;

// render/cameraMath.ts (pure; tests in tests/render/cameraMath.test.ts)
export interface FramingPoint {
  x: number;
  z: number;
  pad: number;
}
export interface CameraPose {
  targetX: number;
  targetZ: number;
  distance: number;
}
export function solveMaxDistance(aspect: number): number; // CAMERA.FOV_DEG / PITCH_DEG, arena + margin in NDC +-0.95
export function solveFraming(
  points: readonly FramingPoint[],
  count: number,
  aspect: number,
  leadX: number,
  leadZ: number,
  maxDist: number,
  out: CameraPose,
): CameraPose;
export function projectToNdc(
  pose: CameraPose,
  aspect: number,
  x: number,
  z: number,
  out: { x: number; y: number },
): void;
export function viewRectOnGround(pose: CameraPose, aspect: number, out: ViewRect): ViewRect;
/** alive pad 7, downed pad 5 (versus eliminated too), boss pad 4; offline and echo drone excluded. */
export function collectFramingPoints(w: WorldView, out: FramingPoint[]): number;
```

### ui/ (W1-UI)

```ts
// ui/UIRoot.ts
export interface UiRootDeps {
  readonly root: HTMLElement;
  readonly theme: ThemeDef;
  readonly doc: Document;
}
export interface UiRoot extends UiPort {
  /** Palette CSS variables from the theme; reduce-motion class. */
  applySettings(s: Settings): void;
  dispose(): void;
}
export function createUiRoot(deps: UiRootDeps): UiRoot;

// ui/dom.ts
export function h<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  props?: {
    readonly className?: string;
    readonly text?: string;
    readonly attrs?: Readonly<Record<string, string>>;
  },
  ...children: readonly Node[]
): HTMLElementTagNameMap[K];
export class TextSlot {
  constructor(el: HTMLElement);
  set(text: string): void;
} // diffed textContent

// ui/format.ts (pure)
export function formatShards(n: number): string;
export function formatTime(seconds: number): string; // m:ss
export function formatPrice(n: number | null): string;
export function formatPercent(f: number): string;
```

### sim/ integration (W2-SIM)

```ts
// sim/stepWorld.ts
export function stepWorld(w: WorldState, intents: Intents, dt: number): void; // fixed system order (Event flow)

// sim/stateHash.ts
/** fnv1a over tick, positions, hp, wallets, pool counts and rng state (core/hash fnv1aMix*). */
export function stateHash(w: WorldState): number;

// sim/RunSession.ts
export interface RunSessionDeps {
  readonly log: Logger;
}
/** Only sim module that knows upgrades: computeStats at start, ShopModel in openShop, stats on applyShopResults. */
export function createRunSession(config: RunConfig, deps: RunSessionDeps): RunSessionApi;
```

### states/ (W2-STATES)

```ts
export function createBootState(s: Services): GameState<'Boot'>;
export function createMainMenuState(s: Services): GameState<'MainMenu'>;
export function createCharacterSelectState(s: Services): GameState<'CharacterSelect'>;
export function createPlayingState(s: Services): GameState<'Playing'>;
export function createUpgradesShopState(s: Services): GameState<'UpgradesShop'>;
export function createPausedState(s: Services): GameState<'Paused'>;
export function createGameOverState(s: Services): GameState<'GameOver'>;

// states/viewModels.ts (pure)
export function buildHudVM(w: WorldView, theme: ThemeDef, fps: string | null): HudVM;
export function buildShopVM(
  snap: ShopVisitSnapshot,
  cursors: readonly [ShopPanelVM['cursor'], ShopPanelVM['cursor']],
  theme: ThemeDef,
): ShopVM;
export function buildHangarVM(save: SaveDataV1, cursor: number, theme: ThemeDef, message: string): HangarVM;
export function buildCharacterSelectVM(
  input: CharacterSelectModel,
  save: SaveDataV1,
  theme: ThemeDef,
): CharacterSelectVM;
export function buildGameOverVM(
  summary: RunSummary,
  rewards: RewardBreakdown,
  theme: ThemeDef,
  cursor: number,
  newBest: boolean,
): GameOverVM;
// CharacterSelectModel is defined and exported by states/viewModels.ts (joined, picks, ready, cursorRows, mode, countdown).
```

States use only `Services` ports plus `upgrades/MetaShop`, `upgrades/rewards`, config and themes. Tests build
states with `createFakeServices()` from `tests/helpers/fakeServices.ts`.

### app/ (Wave 3, for reference)

`createServices` wires: `createRenderBridge` + `createAssetLibrary` (Services.assets = `{ build: lib.build,
warmup: bridge.warmup }`), `createUiRoot`, `createInputService({ target: window })`, `createAudioEngine`,
`createSaveStore(createKeyValueStorage(localStorage))`, `createConsoleLogger(console)`, clock
(`performance.now`), seeds (`crypto.getRandomValues` or `?seed=`), and `createRun = (c) => createRunSession(c,
{ log })`. `createGame` builds the 7 states, `createStateMachine`, `createGameLoop` + `createFramePacer`,
`installLifecycle`, PerfMonitor/Governor and devApi.

## Deviations and errata

Applied in Wave 0 (user-approved or required for consistency):

1. Theme: KERNEL PANIC only (`THEME_IDS = ['kernelPanic']`); no abyssalLight.ts / emberfall.ts. ThemeDef keeps
   the future union members.
2. No `.github/workflows/ci.yml`; `npm run verify` is the gate. `verify:nobuild` exists until Wave 3 adds
   `src/main.ts`.
3. Versus mode added (see addendum); `RunMode` in contracts. Edge 9 accepts `victory`.
4. `contracts/world.ts` (14th contract file) holds WorldState/WorldView/RunCounters/flags/director types, split
   from sim.ts for the 400-line cap.
5. `config/keys.ts` + `config/bindings.ts` replace input/keyCodes.ts, input/defaultBindings.ts and
   input/bindingValidation.ts (save/sanitize needs them without a sibling import).
6. `config/specials.ts` added (special ability numbers). `config/versus.ts` added.
7. `render/assetTypes.ts` (ThreeAssetLibrary, SharedUniforms) and `shaders/shaderSource.ts` (ShaderSource) are
   Wave 0 so W1-ART and W1-RENDER never import each other. `MaterialKey`/`GeometryKey`/`BatchKey`/`RingKey` in
   contracts/render.ts are the full key sets.
8. `sim/worldRecords.ts` and `sim/simEventChannels.ts` split out of createWorld.ts (400-line cap).
9. `StateMachineApi.requestPop()` added (pops carry no payload). `RenderPort.setQuality` became
   `applySettings(Settings)`; `RenderPort.capabilities` added. `InputPort.consumeAnyKey()` added (Boot gate).
   `EventChannel` is an interface in contracts (core implements it); `push()` never returns null.
10. `RunFlags.pauseRequested` removed: pause comes from `input.pollMenu` 'pause' intents (and lifecycle).
    `RunFlags.extractReady` became `finalVisit`; EXTRACT/PUSH DEEPER is `ShopTx {kind: 'choose'}` and
    `ShopApi.choice`, plus `ShopApi.update(frameDtMs)` and `countdownDone`.
11. Overheat is applied at runtime by weapons.ts (entities cannot import upgrades/stats); computeStats has no
    dynamic-flags argument.
12. Plan errata: the budget formula `round(30 + 14w + 1.8w^2)` gives 46 at w1 (matches) but **645** at w15, not
    516; the formula is authoritative. "16 edges" are 17 (from, to) entries. Aim assist "20 deg cone" is a
    +-10 deg half-angle. Spare Kernel `maxLevel` is unbounded (hold cap 3 is the limit).
13. `engines.node` is `>=22.13.0` (eslint 10 requires ^22.13 on Node 22); `.nvmrc` stays 24.21.0.

## Toolchain

| Package             | Range    | Resolved |
| ------------------- | -------- | -------- |
| three               | 0.186.1  | 0.186.1  |
| @types/three        | 0.186.0  | 0.186.0  |
| typescript (gating) | ~6.0.3   | 6.0.3    |
| vite                | ^8.3.1   | 8.3.1    |
| vitest              | ^5.0.2   | 5.0.2    |
| @vitest/coverage-v8 | ^5.0.2   | 5.0.2    |
| eslint              | ^10.11.0 | 10.11.0  |
| @eslint/js          | ^10.0.1  | 10.0.1   |
| typescript-eslint   | ^8.70.1  | 8.70.1   |
| globals             | ^17.12.0 | 17.12.0  |
| prettier            | ^3.9.9   | 3.9.9    |
| @types/node         | ^24.19.0 | 24.19.0  |

Scripts: `dev`, `build` (tsc -b all 3 configs, then vite build), `preview`, `typecheck`, `typecheck:scope`,
`typecheck:ts7` (non-gating, TypeScript 7.0.2), `lint` (`--max-warnings=0`), `check:arch`, `test`,
`test:coverage` (v8, lines 85% / branches 80% on the pure layers), `format`, `format:check`,
`verify:nobuild` (format:check, typecheck, check:arch, lint, test), `verify` (verify:nobuild + vite build).

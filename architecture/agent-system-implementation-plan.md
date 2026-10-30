# Implementation Plan — Operations, Observation & Agent Layer

Executes [ADR 0002](adr/0002-agent-and-operations-layer.md) including its amendments B1–B9, B11 and B12. Read ADR 0001 (with amendments A1–A20), ADR 0002 and [ADR 0003](adr/0003-native-platform-layer.md) first; they are the spec. This plan is the order of work. Task ids use the prefix `A`.

## Starting point (2026-10-16)

- The [plugin-system plan](plugin-system-implementation-plan.md) (P0–P7) and the [modifier UX plan](modifier-ux-implementation-plan.md) are **done**. Every former `P*` prerequisite of this plan is satisfied; the phases below reference concrete files instead.
- The project format is **schema 3** with a migration pipeline (`app/utils/persistence/migrations/`). Modifiers use `distribution`/spread (ADR 0001 A20) and ABI v1.2.
- The app is being ported to **Tauri 2** (ADR 0003). Steps 1 (platform contract, `#platform`) and 2 (Tauri shell, native UDP) exist; steps 3–5 (serial/MIDI, touch, native engine) are open. This plan runs **interleaved** with those steps; dependencies are named `T<step>` (e.g. `T2` = ADR 0003 step 2).
- Already usable for this plan:
  - `CoreCommandFactory` in `packages/extension-api/src/commands.ts` (ADR 0001 §5.8 + A2/A9),
  - the real core engine running in Vitest/Node (`app/zero-extensions.smoke.test.ts`, `WorkerPluginBridge`),
  - `rgb_read` / `from_dmx16` / `remap_range` in `rs-engine/core/src/signatures.rs` (inverse mapping),
  - `signature` live values (A14),
  - the generated AI reference (`scripts/generate-ai-docs.ts` → `docs/ai/`),
  - CI `app-checks.yml`.

## Status (2026-10-30): MCP-first slice

ADR 0002 **B12** reordered the work: the tool layer was built first and exposed over MCP (Claude Code / Claude Desktop are the agent), the in-app runtime (A5) is deferred. Ticked tasks below were delivered by that slice; annotations name deviations and partial scope. Untouched tasks are open. Outside the A-tasks, the slice also delivered ABI 1.3 (`worldAspect`, `worldDepth`, `Sample.z`, room `u`/`v`), the `trigger` param type, canvas hints (`ui.canvas: 'point' | 'radius'`), SDK pattern helpers, the effect-authoring skill and the reference plugins `corner-wave` / `mirror-runner` (see B12). Docs: [operations.md](operations.md), [observability.md](observability.md), [mcp-bridge-protocol.md](mcp-bridge-protocol.md), the [effect-authoring skill](../docs/ai/skills/effect-authoring/SKILL.md), acceptance scenarios in [evals/effects/](../evals/effects/README.md).

## How to work through this plan

- Phase by phase, task by task; the app (web **and** `bun run dev:tauri`) builds and is usable after every phase; tick checkboxes when *Done when* holds; commit per task, e.g. `feat(agent): A1.2 transaction runner`.
- After each phase: `bun run typecheck`, `bun run test`, `cargo test` (in `rs-engine/` and, once it exists on master, `--manifest-path src-tauri/Cargo.toml`), `bun run build`; update `architecture.md` and the docs named in the phase.
- **Platform rule (ADR 0003 D3):** platform-dependent code goes behind `#platform` (host) or `getPlatform()` (extensions). No `if (isTauri)` in agent code. Web is first-class: every feature works on the web or degrades visibly.
- Follow `AGENTS.md`. Every new operation, agent and tool gets a `description` written for an AI reader. UI strings are English.
- If code contradicts this plan, prefer the ADR's intent and add an amendment to ADR 0002 (B10 is reserved for A5.0; next free id B13).
- Respect the **Requires** line of each phase.

Legend: **Files** = main files to create (+) / change (~) / delete (−). **Done when** = acceptance criteria.

---

## Phase A0 — Test & observability foundation

**Requires:** nothing.

- [ ] **A0.1 Headless harness.** + `packages/headless` (`@pixelmapper/headless`): extract the engine boot from `app/zero-extensions.smoke.test.ts` into `createHeadlessApp({ project?, extensions?, platform? })`: Pinia + `engine-store` + history + core WASM + `WorkerPluginBridge` with built-in plugins, no canvas/Three.js/connectors. `platform` defaults to `createTestPlatform()` (+ `app/platform/test/`: all capabilities `null`, injectable fakes). Exposes `history`, `store`, `tick(ms)`, `dmx()`, `signature(fixtureId, sig)`. Runs in the Vitest `node` environment (as the smoke test does); `bun test` support is not required. The smoke test is rewritten on top of the harness.
  *Done when:* the smoke test passes on the harness; a new test loads 4 OFL fixtures, sets a channel via a command, ticks, and reads the expected DMX byte.
- [x] **A0.2 Event log.** + `app/utils/observability/event-log.ts` (ring buffer, ADR 0002 §6.5) + `Actor` type. ~ `use-history.ts`: log execute/undo with `commandType` and actor (default `user`). ~ engine worker: forward engine warnings and plugin traps as events. ~ `ConnectorBase` logs (A17) are mirrored as `connector` events.
  *Done when:* Vitest: commands produce events; ring buffer evicts oldest; actor is recorded.
  *Done via MCP-first slice (B12):* ring buffer (5000) + `Actor`, `useHistory` logs execute/undo/redo/remote, `applyOperations` logs op events (`event-log.test.ts`). **Open:** engine warnings / plugin traps and `ConnectorBase` logs are not forwarded yet.
- [x] **A0.3 Composite command.** + `app/components/engine/commands/composite-command.ts` (ordered execute, reverse undo, `Composite` serialization with child payloads, `label`, `actor`). ~ replay in live collaboration and WAL (`app/utils/persistence/wal.ts`); ~ open gate (A19): namespaced child command types inside a `Composite` count as requirements.
  *Done when:* Vitest: undo restores state exactly; replay from payload produces identical state; a composite with an extension child command adds the extension to `requires`; two-browser manual test shows one undo step on both.
  *Done via MCP-first slice (B12):* `composite-command.test.ts` covers order, atomicity, payload replay, inverse, requires gate and rebase (sync merge adapter `app/utils/sync/merge/adapters/composite.ts`). The two-browser manual test is not recorded.
- [x] **A0.4 Docs.** + `architecture/observability.md` (event log, actors, composite).
  *Done via MCP-first slice (B12):* event log and composite are documented in [operations.md](operations.md); `observability.md` documents observe-lite.

---

## Phase A1 — Operations registry

**Requires:** A0.

- [x] **A1.1 `@pixelmapper/agent-kit` types.** + `packages/agent-kit/src/{operation,finding,expectation,actor,tool,agent}.ts` per ADR 0002 §4.1, §7.1; re-export the operation/agent types from `@pixelmapper/extension-api` (API **1.2.0**, additive). Full TSDoc.
  *Done via MCP-first slice (B12):* `operation` (incl. the new `action` kind), `finding`, `expectation` (+ evaluator), `actor`, `apply`, `observe`, `host` (`AgentHost`), `json-schema`, `tools/`. **Deviation:** no `agent.ts` (comes with A5) and no re-export from `@pixelmapper/extension-api` yet (comes with A1.5).
- [x] **A1.2 Registry + transaction runner.** + `app/utils/operations/{registry,run,apply}.ts`: register/validate (unique ids, namespacing for extensions), Zod input validation, `apply` (batch → `CompositeCommand`, `dryRun`, `verify` collection, error → rollback), semantic diff builder.
  *Done when:* Vitest covers dry run leaves state untouched, verify error rolls back, diff lists changed fields.
  *Done via MCP-first slice (B12):* `registry.ts`, `apply.ts`, `diff.ts` (no separate `run.ts`); actions run outside history and are skipped on `dryRun` (`apply.test.ts`).
- [x] **A1.3 `CoreReadApi`.** + `app/utils/operations/read-api.ts`: readonly, typed access to fixtures, groups, modifiers, presets, live pages, selection, BPM. Reuses the scope view projections (`app/utils/extensions/scope-views.ts`) and `getFixture`; independent of Vue component scopes.
  *Done via MCP-first slice (B12)*, except presets (not exposed yet).
- [ ] **A1.4 Core operations v1.** + `app/utils/operations/core/<namespace>.ts` for the catalog in ADR 0002 §4.2 (amended by B3). Order:
  1. Wrap every `CoreCommandFactory` method as an operation (`fixtures.move`, `fixtures.rotate`, `nodes.rename`, `channels.set`, `channels.setRange(s)`, `fixtures.add`, `fixtures.setKindConfig`, `extensionData.set`).
  2. Add the rest of the catalog. `fixtures.arrange` implements circle, arc, line, grid, distribute, align with `verify` (positions on shape ±ε, no overlaps).
  3. `modifiers.*` speak the **UI vocabulary** of the modifier cards (B3): plugin alias, recipe (`presets`), primary params, spread (`same` / `spatial` with handle / `order` with ranks / `within`), strength, blend, speed. Inputs are translated to `ModifierInstance.distribution` by the same helpers the cards use.

  *Done when:* each operation has a headless Vitest test incl. undo.

  *Partial (B12):* MVP catalog done with execute + undo tests: `project.digest/setBpm`, `fixtures.find/get/move/rotate/setKindConfig`, `nodes.rename`, `groups.list`, `selection.get`, `channels.set`, `extensionData.set`, `modifiers.list/add/update/remove/reorder/applyRecipe` (B3 vocabulary, caller-chosen `id`), `plugins.list/get` + actions `plugins.build/publish`, `live.listPages/addPage/addWidget/updateWidget/removeWidget` (`effect-param` mappings incl. `trigger` and `point`). **Open:** `channels.setRange(s)`, `fixtures.add`, `fixtures.arrange` and the rest of §4.2. Tests use Pinia stubs, not the A0.1 harness.
- [ ] **A1.5 `ctx.commands` as a view.** ~ `app/utils/extensions/` context: `CoreCommandFactory` methods delegate to the operations (same signatures, no breaking change for existing extensions). + `HostApi.operations` (`call`, `list`, `describe`) and `contributes.operations` in the manifest (ADR 0002 D12).
  *Done when:* all first-party extension tests pass unchanged; a test extension contributes an operation that appears in `operations.list()`.
- [ ] **A1.6 Coverage test.** + `app/utils/operations/coverage.test.ts`: every `registerCommand` type (core and first-party extensions) is produced by ≥ 1 operation (operations declare `produces: string[]`).
- [ ] **A1.7 UI on operations.** ~ move/rotate/arrange/rename/delete/add/group handlers in the workspace, sidebars, context menus and modifier cards call operations instead of constructing commands. Keep behavior identical.
  *Done when:* grep shows no `new <X>Command(` outside `app/utils/operations/` and command files (exceptions documented inline).
- [ ] **A1.8 Command palette (optional, cheap proof).** Palette lists operations with `description`, runs them with a generated `ParamForm`-style form. Validates that descriptions and schemas are usable.
- [ ] **A1.9 Docs.** + `architecture/operations.md`; ~ `architecture/extensions.md` and `architecture/guides/authoring-extensions.md` (contributing operations); ~ `scripts/generate-ai-docs.ts` emits the operation catalog into `docs/ai/index.json`.
  *Partial (B12):* `operations.md` and the operation catalog in `docs/ai/index.json` are done; the extension guides wait for A1.5.

---

## Phase A2 — Stage semantics (schema 4)

**Requires:** A1.

- [ ] **A2.1 `project.stage`.** Model `{ bounds, audience: 'y-' | 'y+' | 'x-' | 'x+' | number /* degrees */ }`; `SCHEMA_VERSION = 4` in `serialize.ts`; + `app/utils/persistence/migrations/v4-stage.ts` (default: audience `y+`, bounds from the world size) + test; operation `project.setStage`; UI: small stage-orientation control in the 2D view (English labels).
- [ ] **A2.2 Regions.** + `app/utils/operations/regions.ts`: derive `front/back/left/right/center/upstage/downstage` from stage + fixture positions (thirds by default); `fixtures.find({ region })`; the project digest includes the region per fixture.
  *Done when:* Vitest with rotated audience direction assigns regions correctly; v3 projects load with a default stage.

---

## Phase A3 — Observation

**Requires:** A0, A2.

- [ ] **A3.1 Wire decoder.** Export the inverse mapping from Rust (`rgb_read`, `from_dmx16`, `remap_range`, `nearest_wheel_slot`) via `wasm_bindings.rs` as `decode_signatures(universes, layout)` → per-fixture signature tuples. Do not duplicate it in TS.
  *Done when:* round-trip tests (`cargo test` + Vitest) for RGB, RGBW, CMY, color wheel, pan/tilt 16-bit, channel ranges.
- [ ] **A3.2 Intent trace in Rust.** ~ `rs-engine/core/src/engine.rs`: optional trace mode for a target set recording, per sample, base value, the value after each modifier instance, and `spatial` / `rank` / `distGroup` (A20) into a flat `Float32Array`; zero cost when disabled. `cargo test` for contribution accounting.
- [ ] **A3.3 Observation engine contract.** + `ObservationEngine` interface in `app/utils/observability/engine-contract.ts`: `simulate(snapshot, window, targets, fps) → Trace` and `capture(window, targets) → Trace`. Web implementation: a second WASM worker (`observe-sim.worker.ts`) seeded with snapshot + clock + overrides, never connected to connectors. Resolved via `#platform` (B5) so the native engine (T5) can provide its own implementation later.
- [x] **A3.4 Feature extraction.** + `app/utils/observability/features/{range,color,temporal,spatial,sources,issues}.ts` per ADR 0002 §6.3:
  - *temporal:* autocorrelation/FFT for period and band, beat-lock detection;
  - *spatial:* reported along the instance's **spread**: chase direction over the Spatial 2D handle axis, order over ranks, `within` per fixture, plus mean pairwise correlation;
  - *sources:* modifier alias + recipe name rather than only the hash.

  *Done via MCP-first slice (B12, observe-lite):* `features/{range,color,temporal,spatial,radial,mirror}.ts` + `analyzeTrace`. **Deviations:** `radial` (lag vs. distance to points) and `mirror` (left↔right / front↔back) are new; sources and issues are part of `analyzeTrace`/`index.ts` instead of separate modules; spread-following spatial features need the preview's distribution coordinate (live samples have none).
- [x] **A3.5 Report + expectations.** + `report.ts` (text format §6.4 + JSON), + `packages/agent-kit/src/expectation.ts` evaluator (predicates over features and state).
  *Done via MCP-first slice (B12).*
- [x] **A3.6 Live mode.** `observe({ mode: 'live' })` captures real frames via the live hub (ADR 0001 §5.5, `signature` targets from A14) for the window.
  *Done via MCP-first slice (B12):* `capture.ts`, per fixture (first head), DMX-byte fallback. Instead of `sim`, B12 adds `mode: 'preview'`: one modifier instance rendered through the real `rs-engine-core` WASM in a private headless engine (`preview.ts`, `preview-core.ts`). `sim` is not implemented.
- [ ] **A3.7 Observation goldens.** + `app/utils/observability/observe.golden.test.ts` on the headless harness using the **current built-ins**:
  - Wave 1 Hz → `periodic 1.00 Hz ±0.02`;
  - Wave with Fixture-by-fixture spread over 8 fixtures → order chase, step 1/8;
  - Pattern / Noise recipes → expected temporal class;
  - RGBW white → W = 255 / RGB = 0, decoded `rgb(1,1,1)`;
  - blackout override → wire ≠ intent finding;
  - clamped values;
  - modifier with zero targets.

  *Done when:* all goldens pass; observing 64 fixtures × 2 s @ 30 fps completes in < 300 ms in the harness.
- [ ] **A3.8 Dev panel.** Observability panel (event log + last reports) for humans, built from layout primitives.
- [ ] **A3.9 Docs.** `architecture/observability.md`: taps, features, report format, engine contract, how to add a feature.
  *Partial (B12):* `observability.md` documents modes, features, JSON paths, findings and the report; taps and the engine contract wait for A3.2/A3.3.

---

## Phase A4 — Tool surface

**Requires:** A1, A3.

- [x] **A4.1 Tool implementations.** + `packages/agent-kit/src/tools/{inspect,operations,describe,apply,observe,delegate,ask-user}.ts` (host-agnostic; take an `AgentHost` interface), JSON schemas via `z.toJSONSchema`.
  *Done via MCP-first slice (B12)* for `inspect`, `operations`, `describe` (also guide topics), `apply`, `observe`. `delegate` and `ask-user` are omitted over MCP and come with A5.
- [x] **A4.2 Host adapter.** + `app/utils/agents/host.ts` implementing `AgentHost` on the registry, read API, observation and event log.
  *Done via MCP-first slice (B12):* `createAppAgentHost()`; observation is loaded lazily; guides from `guides.ts`.
- [x] **A4.3 Tool tests.** Snapshot of generated schemas; scripted tool sequences in the headless harness (find front → arrange → observe → expectations pass).
  *Done via MCP-first slice (B12), adapted:* schema snapshot and tool tests (`app/utils/agents/tools.test.ts`), MCP end-to-end over stdio (`mcp-e2e.test.ts`), effect loop in `effects-acceptance.test.ts`. No `arrange` op and no A0.1 harness yet, so the original sequence is not scripted.

---

## Phase A5 — Model access, agent runtime, copilot

**Requires:** A4. A5.0 has no prerequisite and SHOULD run **first, in parallel with A0**: it decides how A5.2 is built.

- [ ] **A5.0 Spike: Sign in with ChatGPT on both targets.** Throwaway branch.
  - **Web**, app served on `http://127.0.0.1:3000`: redirect to an app page `/auth/chatgpt/callback`; check whether the token endpoint and the Responses API accept browser `fetch` (CORS).
  - **Tauri** (`dev:tauri`): native loopback listener + native HTTP.
  - On both: refresh, streamed tool call with namespaced function tools, `listModels`.
  - Record the result as amendment B10 (which parts need native HTTP; whether the web build can use the flow at all).
- [ ] **A5.1 Platform capabilities for agents (ADR 0003 extension).** Add transport-shaped capabilities, nullable per ADR 0003 D2, API minor bump:
  - `http: HttpApi | null`: request/stream without CORS restrictions. Web: `null`, callers use `fetch`. Tauri: Rust `reqwest` streaming over a `Channel`.
  - `loopback: LoopbackApi | null`: one-shot `127.0.0.1` callback listener on a free port. Web: `null`, callers use the app's own callback page when served on loopback. Tauri: native.
  - `secrets: SecretStoreApi | null`: Web: `null`, callers fall back to IndexedDB. Tauri: OS keychain.

  Update ADR 0003 (D2 list, migration table, status) in the same commit.
- [ ] **A5.2 Providers.** + `app/utils/agents/providers/registry.ts`: `registerModelProvider`, provider config schemas, `ModelInfo` with capabilities (ADR 0002 B11). Local models are **not** implemented, only kept possible. + `app/utils/agents/providers/chatgpt/`: PKCE, dynamic registration with persisted `ext_agent_host_id`, refresh, `listModels`, and a custom chat model on the Responses API honoring the preview limits. Uses `getPlatform().http` / `.loopback` / `.secrets` when present, browser APIs otherwise, as decided in A5.0. + `providers/byok/`: OpenAI, Anthropic and OpenRouter keys, stored per device. + Provider settings UI that shows per target what is available (web: "ChatGPT sign-in needs the desktop app or a local run").
  *Done when:*
  - in `dev:tauri` a Plus account signs in and a streamed tool call round-trips;
  - BYOK works on web and Tauri;
  - a test provider registered only in Vitest (a scripted fake model) drives the copilot graph, which proves that nothing outside `providers/` depends on a concrete provider.
- [ ] **A5.3 Runtime.** + `app/utils/agents/runtime/` with `@langchain/langgraph/web` in a lazy-loaded chunk (verify it loads in WKWebView); `defineAgent` registry; IndexedDB checkpointer; explicit config passing; one undo group per run (A0.3) with actor `agent:<id>`.
- [ ] **A5.4 Copilot graph.** + `graphs/copilot.ts` per ADR 0002 §7.2 (plan → act ⇄ tools → verify → respond; ask_user interrupts; 3-attempt limit). Adapts to `ModelInfo` capabilities, never to provider ids (B11).
- [ ] **A5.5 Copilot UI.** + `app/components/agents/{CopilotPanel,SelectionChip,RunTimeline}.vue`:
  - chat with click-to-attach selection chips,
  - a streamed run timeline showing tool calls, diffs and expectation results,
  - an "Undo this run" button.

  Built from layout primitives (`PmPanel`, …) so extensions can extend it through slots.
- [ ] **A5.6 Presence.** Agent appears as an actor in live collaboration while running.
- [ ] **A5.7 Docs.** + `architecture/agents.md` (runtime, providers per platform, copilot graph, how to add an agent).

---

## Phase A6 — Eval harness

**Requires:** A5.4. Start with two scenarios; grow alongside A7–A9.

- [ ] **A6.1 Runner.** + `evals/runner.ts` (`bun run eval [--model] [--filter]`): seeds a headless project, runs an agent with any registered provider (`--provider <id> --config <json>`, secrets from env), scores final state + observation expectations, writes `evals/results/<date>-<model>.json`. Not part of `app-checks.yml`.
- [ ] **A6.2 Scenarios v1.** + `evals/scenarios/*.ts`:
  - arrange selection in a circle;
  - distribute along a line;
  - "front fixtures fire";
  - "slow blue chase left to right on the back row" (expects order spread);
  - "dim everything except the moving heads";
  - ambiguous request → must `ask_user`;
  - impossible request → must report the problem, not claim success.
- [ ] **A6.3 Report.** Pass rate per scenario and model; regressions highlighted.

---

## Phase A7 — Specialized agents

**Requires:** A5.

- [ ] **A7.1 `modifier-author`.** Graph: spec → write `modifier.ts` + manifest (incl. A20 UX fields: `purpose`, `presets`, `tier`, `distribution`) → `plugin-toolchain` compile → validate → `observe` on the target selection → fix loop → publish via `plugin-store` (`project` visibility) → return. Context: `architecture/guides/authoring-content-plugins.md`, `architecture/guides/modifier-design-principles.md`, built-ins as examples. Eval scenarios: fire flicker, beat-locked strobe, rainbow chase.
- [ ] **A7.2 `fixture-definition`.** Port `aiBackendService/src/graph.ts` nodes to the browser runtime with the provider abstraction and switch `useAiFixtureEnrichment.ts` / `CustomFixtureEditorDialog.vue` from `aiBackendUrl` to the in-app agent. This resolves ADR 0003's open point "AI backend as remote service or sidecar": no sidecar. The PDF/OCR path (model-native file input vs. optional Mistral OCR service) is decided here and recorded as an amendment. `aiBackendService` is removed once nothing calls it.
- [ ] **A7.3 Delegation.** Copilot can `delegate` to both; eval scenario: "make the front fixtures look like fire" without a suitable built-in → copilot delegates to `modifier-author`.

---

## Phase A8 — MCP bridge

**Requires:** A4; A8.3 also T2 (Tauri shell on master).

- [x] **A8.1 Bridge transport (host-only).** + `app/platform/{web,tauri}/agent-bridge.ts` exported from `#platform` (host-only, not part of the extension `Platform` contract): delivers incoming tool calls to `AgentHost` with actor `agent:mcp:<client>`. "Allow external agents" toggle + pairing token in the UI.
  *Done via MCP-first slice (B12):* one shared WebSocket client (`app/utils/agents/agent-bridge.ts`, `bridge-client.ts`) exported as `getAgentBridge()` from both `#platform` entries instead of per-platform files; Settings → External agents (toggle, token, status).
- [x] **A8.2 Web: `pixelmapper-mcp` CLI.** + `packages/mcp-bridge` (Bun, stdio MCP server exposing the seven tools, forwarding over `ws://127.0.0.1:<port>` to the open tab).
  *Done via MCP-first slice (B12):* five tools (+ local `pixelmapper_status`), port 7778, token + Origin check, relay mode for a second instance, skill prompts. Serves the Tauri webview too until A8.3. Contract: [mcp-bridge-protocol.md](mcp-bridge-protocol.md).
- [ ] **A8.3 Tauri: in-process MCP server.** ~ `src-tauri/`: streamable-HTTP MCP server on `127.0.0.1` (Rust), forwarding tool calls to the webview over a Tauri `Channel`/event and back. No CLI needed for desktop users.
  *Done when:* Claude Code and Codex can arrange fixtures and observe results against both the web app (via CLI) and the desktop app (direct); results identical to the in-app tools (tool-surface test).
- [x] **A8.4 Docs.** README section "Use Pixelmapper from Claude Code / Codex" (web and desktop).
  *Done via MCP-first slice (B12)* as "Use Pixelmapper from Claude Code / Claude Desktop" (`README.md`, `packages/mcp-bridge/README.md`, `.mcp.json.example`); Codex is not covered.

---

## Phase A9 — Extension authoring

**Requires:** A8.

- [ ] **A9.1 Hot-swap.** ~ `app/utils/extensions/registry.ts`: `unregisterExtension`, `replaceExtension` (dispose `activate`, rebuild slot index, re-render slots, history rules per ADR 0002 §8). Dev mode only.
- [ ] **A9.2 `@pixelmapper/extension-testing`.** `createHeadlessApp({ extensions })` (A0.1) + slot render helpers; one test per first-party extension (several already have unit tests, e.g. `connector-artnet`, `connector-esp`, `controller-akai-apc-mini-mk2`; add host-level tests).
- [ ] **A9.3 Scaffold + dev link (Tier A).** `bun run ext:new <id>` (generates `extension.ts`, example contribution, test, `AGENTS.md`). In-repo extensions already hot-reload through the dev catalog layers (A19, `PM_CATALOG_LAYERS`). `bun run ext:dev <path>` covers **out-of-repo** extensions: watch build with `packages/extension-build` → push the bundle over the bridge (A8) → `replaceExtension`.
  *Done when:* Claude Code creates a small out-of-repo extension (e.g. "fixture count badge in the scene panel"), it appears live in web and desktop without reload, and its test passes.
- [ ] **A9.4 Publish with source.** Bundle + source + test results to the extension registry (migration 006); the installer rebuilds from source and compares.
- [ ] **A9.5 Extension Studio (Tier C, web and desktop).** + `app/pages/dev/extension-studio.vue`:
  - compile worker with `esbuild-wasm` and `@vue/compiler-sfc`, reusing the shared-module virtual exports of A19;
  - virtual file system in IndexedDB;
  - hot-swap via blob `import()`;
  - test runs on the harness in a worker.
- [ ] **A9.6 `extension-author` agent.** Graph: spec → scaffold → write → compile → hot-swap → test (`extension-testing` + `observe`/`inspect`) → fix loop → publish. Runs in the Studio; the same guides are used by local agents (Tier A).
- [ ] **A9.7 Tier B: Codex app-server sidecar (desktop).** **Requires** T2 and A5.2. `src-tauri` spawns `codex app-server` (user-installed; detect and explain if missing) with the ChatGPT access token from A5.2, working directory = a scaffolded extension folder in the app data dir; Codex reaches the app through the A8.3 MCP server; builds are pushed via `ext:dev`. Token refresh restarts the app-server (preview limitation).
- [ ] **A9.8 Docs.** Extend `architecture/guides/authoring-extensions.md` with scaffold, dev link, hot-swap, testing, Studio and Tier B.

---

## Phase A10 — Final pass

- [ ] **A10.1** Update `architecture.md` (overview, layout, documentation map), mark the ADR 0002 implementation status, update ADR 0003 status for A5.1/A8.3.
- [ ] **A10.2** Extend `scripts/generate-ai-docs.ts`: operation catalog, tool schemas, agent list in `docs/ai/`.
  *Partial (B12):* the operation catalog is emitted; tool schemas and the agent list are open.
- [ ] **A10.3** Add operation, observation-golden and tool-surface suites to `app-checks.yml` (evals stay manual).

---

## Dependency overview

```
A5.0 spike ─────────────────────────────────────────────┐ (decides A5.1/A5.2)
A0 ──► A1 ──► A2 ──► A3 ──► A4 ──► A5 ──► A6            │
                              │      └──► A7             │
                              └──► A8 ──► A9             │
ADR 0003:  T2 (Tauri shell) ──► A5.1 natives, A8.3, A9.7 ◄┘
           T5 (native engine) ──► second ObservationEngine implementation (outside this plan)
A10 after A9
```

- A8 MAY start in parallel with A5.
- A6 SHOULD start right after A5.4.
- Native serial/MIDI/touch (T3, T4) do not block anything here.

# Implementation Plan — Operations, Observation & Agent Layer

Executes [ADR 0002](adr/0002-agent-and-operations-layer.md). Read ADR 0001 and ADR 0002 first; they are the spec. This plan is the order of work and runs **interleaved** with the [plugin-system implementation plan](plugin-system-implementation-plan.md) (task ids `P*`). Task ids here use the prefix `A`.

## How to work through this plan

- Same rules as the plugin plan: phase by phase, task by task; the app builds and is usable after every phase; tick checkboxes when *Done when* holds; commit per task, e.g. `feat(agent): A1.2 transaction runner`.
- After each phase: `bun run typecheck`, `bun run test`, `cargo test` (in `rs-engine/`), `bun run build`; update `architecture.md` and the docs named in the phase.
- Follow `AGENTS.md`. Every new operation, agent and tool gets a `description` written for an AI reader.
- If code contradicts this plan, prefer the ADR's intent and add an "Amendments" section to ADR 0002.
- Respect the **Requires** line of each phase: those `P*` tasks MUST be done first.

Legend: **Files** = main files to create (+) / change (~) / delete (−). **Done when** = acceptance criteria.

---

## Phase A0 — Test & observability foundation

**Requires:** P0.1 (workspaces), P0.2 (Vitest).

- [ ] **A0.1 Headless harness.** + `packages/headless` (`@pixelmapper/headless`): `createHeadlessApp({ project?, extensions? })` boots Pinia + `engine-store` + history + the Rust core WASM (no canvas, no Three.js, no connectors) in Vitest/Bun; exposes `history`, `store`, `tick(ms)`, `dmx()`. If the current wasm-pack `--target web` output does not load in Bun, add a second build target for tests and document it.
  *Done when:* a Vitest test loads a project with 4 OFL fixtures, sets a channel via a command, ticks, and reads the expected DMX byte.
- [ ] **A0.2 Event log.** + `app/utils/observability/event-log.ts` (ring buffer, ADR 0002 §6.5) + `actor` type. ~ `use-history.ts`: log execute/undo with `commandType` and actor (default `user`). ~ engine worker: forward engine warnings as events.
  *Done when:* Vitest: commands produce events; ring buffer evicts oldest; actor is recorded.
- [ ] **A0.3 Composite command.** + `app/components/engine/commands/composite-command.ts` (ordered execute, reverse undo, `Composite` serialization with child payloads, `label`, `actor`). ~ live collaboration replay handles `Composite`.
  *Done when:* Vitest: undo of a composite restores state exactly; replay from payload produces identical state; two-browser manual test shows one undo step on both.
- [ ] **A0.4 Docs.** + `architecture/observability.md` (event log, actors, composite).

---

## Phase A1 — Operations registry

**Requires:** A0; P1.1 (extension-api package) and P1.3 (scopes/read projections) — ADR 0001 §5.8 `ctx.commands` is implemented **as** a view onto this registry, so do A1 together with or right after P1.

- [ ] **A1.1 `@pixelmapper/agent-kit` types.** + `packages/agent-kit/src/{operation,finding,expectation,actor,tool,agent}.ts` per ADR 0002 §4.1, §7.1; re-export from `@pixelmapper/extension-api`. Full TSDoc.
- [ ] **A1.2 Registry + transaction runner.** + `app/utils/operations/{registry,run,apply}.ts`: register/validate (unique ids, namespacing for extensions), Zod input validation, `apply` (batch → `CompositeCommand`, `dryRun` via execute+undo on a snapshot, `verify` collection, error → rollback), semantic diff builder.
  *Done when:* Vitest covers dry run leaves state untouched, verify error rolls back, diff lists changed fields.
- [ ] **A1.3 `CoreReadApi`.** + `app/utils/operations/read-api.ts`: readonly, typed access to fixtures, groups, modifiers, presets, live pages, selection, BPM — independent of Vue scopes; reuses ADR 0001 scope view projections.
- [ ] **A1.4 Core operations v1.** + `app/utils/operations/core/<namespace>.ts` for the catalog in ADR 0002 §4.2 except `project.setStage` (A2) and plugin/modifier ops that depend on schema v2 (add as stubs against current `Effect` model; port in A2.3). `fixtures.arrange` implements circle, arc, line, grid, distribute, align with `verify` (positions on shape ±ε, no overlaps).
  *Done when:* each operation has a Vitest (headless) test incl. undo.
- [ ] **A1.5 Coverage test.** + `app/utils/operations/coverage.test.ts`: every `registerCommand` type is produced by ≥ 1 operation (operations declare `produces: string[]`).
- [ ] **A1.6 UI on operations.** ~ move/rotate/arrange/rename/delete/add handlers in the workspace, sidebars and context menu call operations instead of constructing commands. Keep behavior identical.
  *Done when:* grep shows no `new <X>Command(` outside `app/utils/operations/` and command files (exceptions documented inline).
- [ ] **A1.7 Command palette (optional, cheap proof).** Palette lists operations with `description`, runs them with a generated form. Validates that descriptions and schemas are usable.
- [ ] **A1.8 Docs.** + `architecture/operations.md`; ~ ADR 0001 §5.8 amendment pointing to the registry.

---

## Phase A2 — Stage semantics & schema v2 additions

**Requires:** A1; lands **inside** P3.16 (schema v2) so the format breaks once.

- [ ] **A2.1 `project.stage`.** Model `{ bounds, audience: 'y-' | 'y+' | 'x-' | 'x+' | angle }` in types + `serialize.ts`; operation `project.setStage`; UI: small stage-orientation control in the 2D view.
- [ ] **A2.2 Regions.** + `app/utils/operations/regions.ts`: derive `front/back/left/right/center/upstage/downstage` from stage + fixture positions (thirds by default); `fixtures.find({ region })`; project digest includes region per fixture.
  *Done when:* Vitest with rotated audience direction assigns regions correctly.
- [ ] **A2.3 Modifier/plugin operations on v2.** Port `modifiers.*` and `plugins.*` to `ModifierInstance` + content hashes (after P3.11).

---

## Phase A3 — Observation

**Requires:** A0, A2; P3.5 (signatures), P3.7 (runtime + new render loop).

- [ ] **A3.1 Wire decoder.** + `app/utils/observability/wire-decode.ts` (or Rust `signatures.rs` read path exported via wasm-bindgen): DMX universes → per-fixture signature tuples.
  *Done when:* round-trip tests for RGB, RGBW, CMY, color wheel (nearest slot), pan/tilt 16-bit.
- [ ] **A3.2 Intent trace in Rust.** ~ `rs-engine/core/src/engine.rs`: optional trace mode for a target set recording base value and value after each modifier instance per sample into a flat `Float32Array`; zero cost when disabled. `cargo test` for contribution accounting.
- [ ] **A3.3 Simulation engine.** + `app/utils/observability/observe-sim.ts`: separate worker (or headless instance) loaded from the current snapshot + clock + overrides; renders a window at given fps without real time; never connected to connectors.
- [ ] **A3.4 Feature extraction.** + `app/utils/observability/features/{range,color,temporal,spatial,sources,issues}.ts` per ADR 0002 §6.3 (temporal: autocorrelation/FFT for period and band, beat-lock detection; spatial: phase-step regression along position for chase direction, mean pairwise correlation).
- [ ] **A3.5 Report + expectations.** + `report.ts` (text format §6.4 + JSON), + `packages/agent-kit/src/expectation.ts` evaluator (predicates over features and state).
- [ ] **A3.6 Live mode.** `observe({ mode: 'live' })` captures real frames via the live hub (ADR 0001 §5.5) for the window.
- [ ] **A3.7 Observation goldens.** + `app/utils/observability/observe.golden.test.ts` with the scenarios from ADR 0002 §9 (sine 1 Hz, 8-fixture chase, RGBW white, blackout override, clamped values, modifier with zero targets).
  *Done when:* all goldens pass; observing 64 fixtures × 2 s @ 30 fps completes in < 300 ms in the headless harness.
- [ ] **A3.8 Dev panel.** Observability panel (event log + last reports) for humans.
- [ ] **A3.9 Docs.** `architecture/observability.md`: taps, features, report format, how to add a feature.

---

## Phase A4 — Tool surface

**Requires:** A1, A3.

- [ ] **A4.1 Tool implementations.** + `packages/agent-kit/src/tools/{inspect,operations,describe,apply,observe,delegate,ask-user}.ts` (host-agnostic; take an `AgentHost` interface), JSON schemas via `z.toJSONSchema`.
- [ ] **A4.2 Host adapter.** + `app/utils/agents/host.ts` implementing `AgentHost` on the registry, read API, observation and event log.
- [ ] **A4.3 Tool tests.** Snapshot of generated schemas; scripted tool sequences in the headless harness (e.g. find front → arrange → observe → expectations pass).

---

## Phase A5 — Agent runtime, providers, copilot

**Requires:** A4.

- [ ] **A5.1 Runtime.** + `app/utils/agents/runtime/` with `@langchain/langgraph/web` in a lazy-loaded chunk; `defineAgent` registry; IndexedDB checkpointer; explicit config passing; one undo group per run (A0.3) with actor `agent:<id>`.
- [ ] **A5.2 Providers.** + `providers/chatgpt/` (Sign in with ChatGPT: PKCE, loopback redirect, dynamic registration, `ext_agent_host_id`, refresh, `listModels`; custom chat model on the Responses API honoring the preview limits) and `providers/byok/` (OpenAI, Anthropic, OpenRouter keys stored per device). Provider settings UI.
  *Done when:* in `bun run dev` on `127.0.0.1`, a Plus account signs in and a streamed tool call round-trips; BYOK works with one key.
- [ ] **A5.3 Copilot graph.** + `graphs/copilot.ts` per ADR 0002 §7.2 (plan → act ⇄ tools → verify → respond; ask_user interrupts; 3-attempt limit).
- [ ] **A5.4 Copilot UI.** + `app/components/agents/{CopilotPanel,SelectionChip,RunTimeline}.vue`: chat, click-to-attach selection chips, streamed run timeline showing tool calls, diffs and expectation results, "undo this run" button. Built from layout primitives (ADR 0001 §5.3) so extensions can extend it.
- [ ] **A5.5 Presence.** Agent appears as an actor in live collaboration while running.
- [ ] **A5.6 Docs.** + `architecture/agents.md` (runtime, providers, copilot graph, how to add an agent).

---

## Phase A6 — Eval harness

**Requires:** A5. Start early with few scenarios; grow continuously.

- [ ] **A6.1 Runner.** + `evals/runner.ts` (`bun run eval [--model] [--filter]`): seeds a headless project, runs an agent with a real provider (BYOK key from env), scores final state + observation expectations, writes `evals/results/<date>-<model>.json`.
- [ ] **A6.2 Scenarios v1.** + `evals/scenarios/*.ts`: arrange selection in circle; distribute along a line; "front fixtures fire"; "slow blue chase left to right on the back row"; "dim everything except the moving heads"; ambiguous request → must ask_user; impossible request → must report, not claim success.
- [ ] **A6.3 Report.** Pass rate per scenario and model; regressions highlighted.

---

## Phase A7 — Specialized agents

**Requires:** A5; for A7.1 also P4.3 (local compile & create flow).

- [ ] **A7.1 `modifier-author`.** Graph: spec → write `modifier.ts` + manifest → `plugin-toolchain` compile → validate → `observe` on the target selection → fix loop → publish (hash) → return. Context: `architecture/guides/authoring-content-plugins.md` + built-in plugins as examples. Eval scenarios: fire flicker, beat-locked strobe, rainbow chase.
- [ ] **A7.2 `fixture-definition`.** Port `aiBackendService/src/graph.ts` nodes to the browser runtime with the provider abstraction. Decide the PDF/OCR path (model-native file input if the provider supports it; otherwise keep `aiBackendService` OCR as an optional service) and record the decision as an ADR 0002 amendment.
- [ ] **A7.3 Delegation.** Copilot can `delegate` to both; eval scenario: "make the front fixtures look like fire" without a suitable built-in → copilot delegates to `modifier-author`.

---

## Phase A8 — MCP bridge

**Requires:** A4.

- [ ] **A8.1 App-side bridge.** + `app/utils/agents/bridge/ws-server-client.ts`: connects to `ws://127.0.0.1:<port>` when the user enables "Allow external agents"; pairing token shown in the UI; dispatches tool calls to `AgentHost` with actor `agent:mcp:<client>`.
- [ ] **A8.2 `pixelmapper-mcp` CLI.** + `packages/mcp-bridge` (Bun, stdio MCP server exposing the same seven tools, forwarding over WebSocket).
  *Done when:* Claude Code and Codex can arrange fixtures and observe results in a running app; results identical to the in-app tools (tool-surface test).
- [ ] **A8.3 Docs.** README section "Use Pixelmapper from Claude Code / Codex".

---

## Phase A9 — Extension authoring

**Requires:** A8; P6.5 (extension bundles), P6.6 (runtime loader).

- [ ] **A9.1 Hot-swap.** ~ `app/utils/extensions/registry.ts`: `unregisterExtension`, `replaceExtension` (dispose `activate`, rebuild slot index, re-render slots, history rules per ADR 0002 §8). Dev mode only.
- [ ] **A9.2 `@pixelmapper/extension-testing`.** `createHeadlessApp({ extensions })` + slot render helpers; one test per first-party extension.
- [ ] **A9.3 Scaffold + dev link (Tier A).** `bun run ext:new <id>`, `bun run ext:dev <id>` (watch build → push bundle over the bridge → `replaceExtension`). Generated `AGENTS.md` for coding agents.
  *Done when:* Claude Code creates a small extension (e.g. "fixture count badge in the scene panel"), it appears live without reload, its test passes.
- [ ] **A9.4 Publish with source.** Bundle + source + test results to the extension store; installer rebuilds from source and compares.
- [ ] **A9.5 Extension Studio (Tier C).** + `app/pages/dev/extension-studio.vue`, compile worker (`esbuild-wasm`, `@vue/compiler-sfc`), virtual FS in IndexedDB, hot-swap via blob `import()`, test run via headless harness in a worker.
- [ ] **A9.6 `extension-author` agent.** Graph: spec → scaffold → write → compile → hot-swap → test (`extension-testing` + `observe`/`inspect`) → fix loop → publish. Runs in the Studio (Tier C); the same prompts/guides are used by local agents (Tier A).
- [ ] **A9.7 Docs.** Extend `architecture/guides/authoring-extensions.md` (P7.1) with dev link, hot-swap and testing.

---

## Phase A10 — Final pass

- [ ] **A10.1** Update `architecture.md` (overview, layout, documentation map), mark ADR 0002 implementation status.
- [ ] **A10.2** Generated AI reference (with P7.2): operation catalog JSON, tool schemas, agent list.

---

## Dependency overview

```
P0 ──► A0 ──► A1 (with P1) ──► A2 (inside P3.16) ──► A3 (needs P3.5, P3.7) ──► A4 ──► A5 ──► A6
                                                                                │       └──► A7 (A7.1 needs P4.3)
                                                                                └──► A8 ──► A9 (needs P6.5, P6.6)
A10 after A9 and P7
```

A6 (evals) SHOULD start right after A5.3 with two scenarios and grow alongside A7–A9. A8 MAY start in parallel with A5.

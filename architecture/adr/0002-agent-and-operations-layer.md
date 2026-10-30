# ADR 0002 — Operations, Observation & Agent Layer

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-10-07 |
| **Deciders** | Fabian Rafreider |
| **Implementation plan** | [agent-system-implementation-plan.md](../agent-system-implementation-plan.md) |
| **Builds on** | [ADR 0001 — Extension & Content-Plugin System](0001-extension-and-content-plugin-system.md) (fills its §9 "AI generation loop" out-of-scope item); [ADR 0003 — Platform Layer](0003-native-platform-layer.md) (amendments B5, B7, B8) |
| **Amendments** | B1–B9, B11 (2026-10-16; B10 reserved for the plan A5.0 spike), B12 (2026-10-30, MCP-first slice), see end of document |

This ADR is the **normative specification** of how AI agents (in-app and external) read, change and verify Pixelmapper state, and how agents author content plugins and extensions. It is written so that an implementing agent can work from it without further context. Where this document and ADR 0001 disagree, this document wins for the topics it covers; everything else stays as in ADR 0001.

Key words: **MUST** / **MUST NOT** = hard requirement, **SHOULD** = default unless there is a documented reason, **MAY** = optional.

---

## 1. Context

Pixelmapper is AI-first (ADR 0001 §1). The product needs:

- **Specialized agents** for narrow tasks: loading fixture definitions from manuals, authoring modifiers, later shaders and visuals.
- **A general copilot** inside the app that can do *everything the user can do*: the user selects something ("these five fixtures"), asks ("arrange them in a circle", "make the front fixtures look like fire") and the agent acts directly on the live project.
- **An MCP interface** so external agents (Claude Code, Codex, …) get the same capabilities.
- **Agents that build extensions** and hot-swap them into the running app.

Observed failure mode of typical MCP integrations: the agent acts, does not verify, and the result is half right. The core requirement of this ADR is therefore **verifiability**: every change returns what actually changed, and the agent can observe the rendered output as compact, machine-readable text, not as screenshots (token cost, no temporal information).

Constraints:

- **No backend for core AI functionality.** Agents run in the browser (later Tauri). Model access uses the user's own credentials (ChatGPT subscription via *Sign in with ChatGPT*, or own API keys).
- The app is **open source**. OpenAI's open-source token-sharing flow requires a loopback redirect (`http://127.0.0.1:{port}/callback`); it covers local runs (`bun run dev`, Tauri). A remotely hosted deployment needs OpenAI's approval via their interest form.
- The existing command system (`Command`, `SerializableCommand`, `registerCommand`, history in `use-history.ts`) stays the single mutation path.
- AI-generated code (content plugins, extensions) is a first-class, expected case and is **not** treated as second-class. Quality is ensured by **tests and validation**, not by restrictions.

---

## 2. Decision summary

```
┌────────────────────────────────────────────────────────────────────┐
│ Surfaces:   In-app copilot │ Specialized agents │ MCP bridge        │
├────────────────────────────────────────────────────────────────────┤
│ Agent runtime (LangGraph.js/web): graphs, subgraph agents,          │
│ interrupts, mandatory verify step, model providers                  │
├────────────────────────────────────────────────────────────────────┤
│ Tool surface (7 meta-tools, generated from the registries)          │
├──────────────────────────────┬─────────────────────────────────────┤
│ Operations registry          │ Observation (trace, features,        │
│ (queries + mutations)        │ event log, deterministic simulation) │
├──────────────────────────────┴─────────────────────────────────────┤
│ Commands → history / undo / live sync / persistence (unchanged)     │
└────────────────────────────────────────────────────────────────────┘
```

---

## 3. Decisions (normative)

### D1 — One operations registry for every caller
All user-reachable functionality is exposed as **operations** in one registry. The UI, the command palette, agents, the MCP bridge and extensions all call operations. Operations generalize ADR 0001 §5.8 "core command factory" (`ctx.commands`), which becomes a typed view onto this registry.
*Rejected:* hand-written AI tools next to the UI (drift: the agent cannot do what the user can); exposing raw commands (payloads contain `before`/`after` snapshots an agent should not compute).

### D2 — Queries and mutations
An operation is either a `query` (pure read, no side effects) or a `mutation` (returns commands; never mutates state directly). Every operation has a human/AI-readable `description` and Zod schemas for input and output.

### D3 — Coverage is enforced
Every registered `commandType` MUST be producible by at least one mutation operation. A Vitest test enumerates the command registry and fails on gaps. New user-facing features MUST be implemented as operations first; UI handlers call them.

### D4 — Mutations run in transactions
Agents apply mutations through `apply`, which runs a batch of operations as **one undo group** (`CompositeCommand`) with a label and an actor. `dryRun` returns the diff without committing. The result is a **semantic diff** plus post-state of affected entities plus `verify` findings (D5), never just "ok".

### D5 — Operations verify their own postconditions
A mutation MAY implement `verify(ctx, input, result)`; the host runs it after every execution and returns findings (`error` | `warning` | `info`). Errors roll back the transaction.

### D6 — Stage orientation and spatial semantics are project data
Schema v2 (ADR 0001 D24) gets `project.stage`: bounds and the audience direction. The core derives **regions** (`front`, `back`, `left`, `right`, `center`, `upstage`, `downstage`) and exposes them in queries. Without this, "the front fixtures" is a guess.

### D7 — Lean tool surface
Agents (in-app and MCP) see **exactly seven** meta-tools (§5). The operation catalog is disclosed on demand (`operations`, `describe`), not as hundreds of tools. Tool definitions are generated from the registries.
*Rejected:* one tool per operation (context bloat, poor selection accuracy as the catalog grows).

### D8 — Observation is deterministic simulation plus trace, as text
`observe` renders the requested time window **headlessly** in a separate engine instance (modifiers are pure functions, ADR 0001 D5), so it is instant, repeatable and can look into the future. It captures two taps: **intent** (signature values after each modifier, with per-modifier contribution) and **wire** (the actual DMX buffer, decoded back to signatures). The result is a compact **feature report** (§6), not raw frames and not images. A `live` mode captures real frames for state that cannot be simulated (live overrides, controller input).
*Rejected:* screenshots as primary verification (token cost, no temporal information; `screenshot` stays a last resort); raw DMX dumps (unreadable at scale).

### D9 — Event log
Every operation, command, engine warning and plugin trap is written to a structured, ring-buffered **event log** with actor (`user`, `agent:<id>`, `collaborator:<id>`, `extension:<id>`) and undo-group id. `observe` and `inspect` reference events; the log is the primary debugging source for humans and agents.

### D10 — Expectations
`apply` and `observe` accept `expect`: declarative predicates over state and observation features (e.g. `hue within [0,40]`, `temporal.beatLock = 4`, `spatial.mode = 'chase'`). The host evaluates them and returns pass/fail per predicate. Agents SHOULD state expectations before acting.

### D11 — Agent runtime: LangGraph.js in the browser
Agents are LangGraph.js graphs using `@langchain/langgraph/web`, loaded as a **lazy chunk**. `config` is passed explicitly (no AsyncLocalStorage in browsers). The checkpointer persists to IndexedDB. Every agent graph that mutates MUST route through a **verify node** before it can finish (structural guarantee, not a prompt instruction).
*Rejected:* a hand-written tool loop (no interrupts, no enforced verify step, no subgraphs); OpenAI Agents SDK (not supported in browsers).

### D12 — Agents are registered and composable
Agents are defined with `defineAgent` (id, description, input/output schema, graph factory). Every agent is callable by other agents via `delegate` (subgraph). Extensions MAY contribute agents and operations (`contributes.agents`, `contributes.operations`).

### D13 — One agent run = one undo group, attributed
All mutations of one agent run form a single undo group labeled `AI: <summary>`. In live collaboration the agent appears as its own actor (cursor/presence), and its commands carry the actor id.

### D14 — Model providers behind one interface
`ModelProvider` abstracts model access. Providers: **ChatGPT** (Sign in with ChatGPT, Responses API) and **BYOK** (own OpenAI/Anthropic/OpenRouter key). The ChatGPT provider is a custom LangChain chat model, not `ChatOpenAI`, because the plan-usage preview requires `store: false`, `stream: true`, full history as `input`, rejects `temperature`/`max_output_tokens`, and needs function tools grouped in namespaces.

### D15 — Agent context is explicit
Every copilot turn receives: current selection (as **chips** the user can add by clicking entities), viewport, focused entity, and a compact **project digest** (fixtures with id/name/kind/region/signatures, groups, active modifiers, BPM). Larger detail is fetched via `inspect`.

### D16 — MCP bridge exposes the same tools
External agents get the identical seven tools over MCP. Browser: a local Bun CLI `pixelmapper-mcp` (stdio MCP server) connects to the open app tab via a localhost WebSocket with a pairing token. Tauri: in-process MCP server forwarding to the webview. The bridge also serves extension hot-swap (D18).

### D17 — Specialized agents (first set)
`copilot` (orchestrator), `modifier-author` (writes AssemblyScript, loops through `plugin-toolchain` compile → validate → `observe` until expectations pass), `fixture-definition` (port of `aiBackendService` extraction graph), `extension-author` (D18). Later: `shader-author`, `visual-author`.

### D18 — Agents build extensions; dev extensions hot-swap
The extension registry gets `replaceExtension(manifest)` / `unregisterExtension(id)` for **dev mode**: a changed extension is swapped into the running app without reload (production install keeps ADR 0001's reload). Authoring tiers sharing one toolchain:
- **Tier A — local coding agent:** scaffold + `bun run ext:dev` links the extension into the open app via the MCP bridge; the agent tests through MCP tools.
- **Tier C — in-browser Extension Studio:** virtual file system; compile in a worker (`esbuild-wasm` for TS, `@vue/compiler-sfc` for SFCs; no npm dependencies — host globals cover `vue`, `pinia`, API); hot-swap via blob `import()`; driven by the `extension-author` agent.
- **Tier B — Tauri + Codex app-server sidecar** using the user's ChatGPT login (later, with Tauri).
Published extensions always ship **source**; the host rebuilds and compares, as for content plugins.

### D19 — Everything AI-relevant is tested headlessly
A **headless harness** boots the core (stores, commands, Rust engine WASM, plugin runtime) in Vitest/Bun without UI. It is the base for operation tests, observation golden tests, extension tests and agent evals. Agent evals are scenario-based, scored on final state and observation features, and run outside the default `bun run test` (they cost model calls).

---

## 4. Operations

### 4.1 Definition

```ts
import { z } from 'zod';

interface OperationDefinition<I extends z.ZodType, O extends z.ZodType> {
  id: string;                         // 'fixtures.arrange'; extensions: '<extensionId>/<name>'
  kind: 'query' | 'mutation';
  description: string;                // read by humans and AI; state units and coordinate spaces
  input: I;
  output: O;
  examples?: { input: z.infer<I>; note?: string }[];   // shown by `describe`
  run(ctx: OperationContext, input: z.infer<I>): OperationResult<z.infer<O>>;
  verify?(ctx: OperationContext, input: z.infer<I>, result: z.infer<O>): Finding[];
}

type OperationResult<O> =
  | { kind: 'query'; value: O }
  | { kind: 'mutation'; commands: Command[]; value: O };

interface Finding { level: 'error' | 'warning' | 'info'; code: string; message: string; entityIds?: string[] }

interface OperationContext {
  read: CoreReadApi;                  // typed, readonly access to project state (no Vue scopes)
  ops: OperationCaller;               // call other operations (composition)
  actor: Actor;
}
```

- Location: types in `packages/agent-kit` (re-exported by `@pixelmapper/extension-api`); host registry in `app/utils/operations/`.
- Mutations MUST NOT mutate state in `run`; they return commands. `ctx.read` reflects the state **before** the transaction plus already-applied operations of the same batch.
- Coordinates: normalized world space as in `FixturePositionSnapshot` (0–1, `z` height). Descriptions MUST state this.

### 4.2 Initial core catalog (minimum for v1)

| Namespace | Operations |
|---|---|
| `project` | `digest` (q), `setStage` (m), `setBpm` (m) |
| `fixtures` | `find` (q, filters: ids, region, kind, signature, group, name), `get` (q), `add` (m), `remove` (m), `move` (m), `rotate` (m), `rename` (m), `arrange` (m: circle, arc, line, grid, distribute, align) |
| `groups` | `list` (q), `create` (m), `ungroup` (m) |
| `channels` | `set` (m: by signature or channel type, normalized), `setRange` (m) |
| `modifiers` | `list` (q), `add` (m), `update` (m), `remove` (m), `reorder` (m) |
| `plugins` | `list` (q: built-ins, mine, project, public), `get` (q: manifest + source) |
| `presets` | `list` (q), `save` (m), `apply` (m), `update` (m), `delete` (m) |
| `live` | `listPages` (q), `addWidget` (m), `updateWidget` (m), `removeWidget` (m) |
| `selection` | `get` (q), `set` (m — UI-only, not in history) |

The coverage test (D3) is the authority for completeness.

### 4.3 Transactions

```ts
interface ApplyRequest {
  ops: { op: string; input: unknown }[];
  label: string;                      // undo-group label
  dryRun?: boolean;
  expect?: Expectation[];             // D10, evaluated after commit (or on the dry-run state)
}

interface ApplyResult {
  committed: boolean;
  undoGroupId?: string;
  diff: SemanticChange[];             // e.g. { entity: 'fixture:12', field: 'position', from, to }
  affected: EntityView[];             // post-state of touched entities
  findings: Finding[];                // from verify() of every op
  expectations?: ExpectationResult[];
  events: EventRef[];
}
```

`CompositeCommand` (new, `app/components/engine/commands/composite-command.ts`) executes children in order, undoes in reverse, serializes as `Composite` with child payloads, and carries `actor` + `label`.

---

## 5. Tool surface

| Tool | Input | Returns |
|---|---|---|
| `inspect` | `{ selector, detail?: 'summary' \| 'full' }` — selector = `'selection'`, `'project'`, `{ op: '<query op>', input }`, or entity ids | Entity views, related events |
| `operations` | `{ search?: string, namespace?: string }` | Ids + one-line descriptions |
| `describe` | `{ id }` | Full description, JSON schema of input/output, examples |
| `apply` | `ApplyRequest` | `ApplyResult` |
| `observe` | `ObserveRequest` (§6) | `ObserveReport` (§6) |
| `delegate` | `{ agent, task, input? }` | Agent output (schema of that agent) |
| `ask_user` | `{ question, options? }` | User answer (LangGraph interrupt) |

`screenshot` MAY exist as an eighth, opt-in tool for visual-only questions (3D look, custom panels). It MUST NOT be used for verification that `observe` can do.

Tool schemas are generated from Zod (`z.toJSONSchema`) once and shared by the in-app runtime and the MCP bridge (`packages/agent-kit/src/tools/`).

---

## 6. Observation

### 6.1 Request

```ts
interface ObserveRequest {
  targets: Selector;                  // fixtures/groups/regions
  window?: { from?: TimeRef; duration: TimeRef };   // TimeRef = '2s' | '8 beats'; default 2s from now
  mode?: 'sim' | 'live';              // default 'sim'
  fps?: number;                       // default 30 for sim
  detail?: 'group' | 'fixture' | 'raw';  // default 'group'
  expect?: Expectation[];
}
```

### 6.2 Taps

- **Intent tap** (Rust core, trace mode): per sample, the working value after base and after **each** modifier instance → per-modifier contribution. Enabled only for requested targets.
- **Wire tap**: the universe buffers, decoded back to signatures via the inverse mapping of ADR 0001 §6.4 (`signatures.rs` read path).
- **Consistency check**: `wire ≙ intent` within quantization tolerance; mismatches are findings with the cause (blocked by override/preset, clamped, missing channel, mapping approximation such as color wheel).

Simulation runs in a **separate engine instance** (`observe-sim` worker or the headless harness) seeded with the current project snapshot, BPM clock and live overrides; it never touches the output engine.

### 6.3 Features (per signature component, per fixture and aggregated per group)

| Feature | Content |
|---|---|
| `range` | min, max, mean, stddev |
| `color` (rgb) | hue range/mean (°), saturation, value; named color bucket |
| `temporal` | `constant` \| `periodic` (Hz, beats, beatLock) \| `aperiodic` (dominant band) \| `events` (on/off times) |
| `spatial` | `uniform` \| `chase` (direction vector, phase step) \| `independent` (mean pairwise correlation) \| `gradient` |
| `sources` | contributing modifier instances with plugin alias/hash, blend, strength, share of variance |
| `issues` | clamped values, stuck at 0/1, wire≠intent, NaN/trap events |

### 6.4 Report format

The report is returned as **compact text** (default) plus a JSON form for programmatic expectations:

```
observe front · 0.0–2.0s · 30 fps · sim · bpm 128
GROUP 6 fixtures · rgb · sources: fire-flicker@sha256:3fa…(absolute, 1.0)
  color    hue 8°–34° mean 19° · sat .92 · value .31–.97 mean .64 sd .18
  temporal aperiodic · band 4–9 Hz · no beat lock
  spatial  independent (corr .12)
  issues   none
FIXTURE cameo-5 (x .61 y .07 front) value 0.00 const  ⚠ wire: DIMMER=0 (preset 'Blackout' override)
EVENTS   #812 modifiers.add fire-flicker (agent:copilot, group 41)
EXPECT   ✓ hue within [0,40] · ✓ spatial = independent · ✗ all fixtures active (cameo-5)
```

### 6.5 Event log

`app/utils/observability/event-log.ts`: ring buffer (default 5 000 entries), entries `{ id, t, actor, kind, code, message, entityIds, undoGroupId }`. Sources: operation execution, command execute/undo, engine warnings (modifier with zero targets, unsupported signature), plugin traps, watchdog suspensions, connector errors. Exposed via `inspect({ selector: 'events', … })` and a dev panel.

---

## 7. Agent runtime

### 7.1 Definition

```ts
interface AgentDefinition<I, O> {
  id: string;                         // 'modifier-author'; extensions: '<extensionId>/<name>'
  description: string;
  input: z.ZodType<I>;
  output: z.ZodType<O>;
  createGraph(deps: AgentDeps): CompiledGraph;   // LangGraph.js/web
  tools?: 'all' | ToolName[];         // default 'all'
}
```

### 7.2 Copilot graph (normative shape)

```
START → plan → act ⇄ tools → verify ─(pass)→ respond → END
                         ↑        └─(fail, attempts < 3)→ act
                         └── ask_user (interrupt) when ambiguous or destructive
```

- `verify` is mandatory after any `apply`: it runs `observe`/`inspect` against the expectations stated in `plan` and records the outcome.
- After 3 failed attempts the agent reports what is wrong instead of claiming success.
- Destructive operations (removing > 1 entity, overwriting presets) require `ask_user` unless the user's request names them explicitly.

### 7.3 Model providers

```ts
interface ModelProvider {
  id: 'chatgpt' | 'openai-key' | 'anthropic-key' | 'openrouter-key' | string;
  listModels(): Promise<ModelInfo[]>;
  createChatModel(model: string): BaseChatModel;
  status(): ProviderStatus;           // signed in, limits, errors
}
```

ChatGPT provider (`app/utils/agents/providers/chatgpt/`): PKCE + loopback redirect, scopes `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`, `resource=https://api.openai.com/v1`, dynamic client registration with persisted `ext_agent_host_id`, refresh tokens, and a Responses adapter honoring the preview limitations (D14). Tokens are stored per device (IndexedDB; Tauri: OS keychain), never in project data.

---

## 8. Extension authoring

- **Scaffold:** `bun run ext:new <id>` creates `extensions/<id>/` with `extension.ts`, an example contribution, `extension.test.ts` using the headless harness, and an `AGENTS.md` pointing to ADR 0001 §5, this ADR §4 and the authoring guide.
- **Dev link:** `bun run ext:dev <id>` builds in watch mode (`packages/extension-build`) and pushes each build over the MCP bridge WebSocket to the open app, which calls `replaceExtension`.
- **Hot-swap rules:** disposing an extension calls its `activate` disposer, removes contributions from the registry/slot index, and re-renders affected slots. Persisted extension data stays. Commands of the old version in history remain replayable if `commandType` and payload are unchanged; otherwise history entries of that extension are dropped with a warning.
- **Extension tests:** `@pixelmapper/extension-testing` provides `createHeadlessApp({ extensions })` (registry + operations + observe) and slot rendering helpers with `@vue/test-utils`.
- **Publish:** bundle + source + test results; installation as ADR 0001 §5.9.
- **Studio (Tier C):** `app/pages/dev/extension-studio.vue`, compile worker `app/utils/extensions/studio/compile-worker.ts`; allowed imports are the host globals and relative files.

---

## 9. Testing

| Suite | Runs in | Content |
|---|---|---|
| Operations | `bun run test` | Per operation: input validation, produced commands, undo restores state, `verify` findings |
| Coverage | `bun run test` | Every `commandType` reachable via an operation (D3) |
| Observation goldens | `bun run test` | Known scenes → expected features (sine 1 Hz → `periodic 1.00 Hz ±0.02`; 8-fixture chase → direction `+x`, step 1/8; RGBW white → W=255/RGB=0 and decoded `rgb(1,1,1)`; blackout preset → wire≠intent finding) |
| Tool surface | `bun run test` | Generated schemas stable (snapshot), MCP and in-app produce identical results |
| Extension tests | `bun run test` | Each first-party extension has headless tests |
| Agent evals | `bun run eval` (manual / nightly) | Scenario prompts with seeded projects; scored on final state + observation expectations; pass rate tracked per model |

---

## 10. Repository layout (additions)

```
packages/
├── agent-kit/                 # @pixelmapper/agent-kit — operation/agent/tool types, schema generation, expectation evaluator
├── headless/                  # @pixelmapper/headless — boot core + engine without UI (tests, observe-sim, evals)
├── extension-testing/         # @pixelmapper/extension-testing
└── mcp-bridge/                # pixelmapper-mcp CLI (stdio MCP ↔ WebSocket ↔ app)
app/utils/
├── operations/                # registry, core operations, transaction runner
├── observability/             # event log, trace decoding, feature extraction, report formatter
└── agents/                    # runtime, registry, providers/, graphs/ (copilot, modifier-author, …)
app/components/agents/         # Copilot panel, selection chips, run timeline, provider settings
evals/                         # scenarios + runner
```

---

## 11. Consequences

**Positive**
- The agent can do everything the user can, and coverage is tested instead of hoped for.
- Verification is cheap (text features, deterministic simulation) and built into the graph.
- One tool surface for in-app and external agents; extensions extend both automatically.
- The headless harness also improves non-AI testing.

**Negative / costs**
- UI handlers must be refactored to call operations.
- Rust core needs a trace mode and an inverse signature mapping good enough for decoding.
- A second engine instance for simulation costs memory while observing.
- The ChatGPT provider depends on an OpenAI preview API that may change.

---

## 12. Out of scope

- Server-side agents and hosting the agent loop on a backend.
- Shader/visual authoring agents (only the agent slots are reserved).
- ~~Tier B (Codex app-server sidecar) until the Tauri port exists.~~ In scope since B9.
- Voice/realtime agents.

---

## Amendments

Changes after ADR 0001 was fully implemented (incl. A1–A20) and the Tauri port started ([ADR 0003](0003-native-platform-layer.md)). Each names the affected decision; the [implementation plan](../agent-system-implementation-plan.md) follows these amendments.

- **B1 — Starting point.** All `P*` prerequisites are done. The extension API already has `CoreCommandFactory` (ADR 0001 §5.8, A2, A9); D1 is implemented by making `ctx.commands` a view onto the operations registry without changing its signatures, plus `HostApi.operations` and `contributes.operations` (API 1.2.0, additive).
- **B2 — Headless harness (D19).** The harness is extracted from `app/zero-extensions.smoke.test.ts`, which already runs the real core WASM and `WorkerPluginBridge` in the Vitest `node` environment. It runs under Vitest, not `bun test`. It uses a test platform (`app/platform/test/`, all ADR 0003 capabilities `null` or fakes).
- **B3 — Modifier operations speak the UI vocabulary (§4.2).** Following ADR 0001 A20 (owner revisions R1/R2), `modifiers.add` / `modifiers.update` take plugin alias, recipe (`presets`), params, **spread** (`same`, `spatial` + handle, `order` + ranks, `within`), strength, blend mode and speed — the concepts the user sees on a modifier card — and translate them to `ModifierInstance.distribution` with the card helpers. `modifiers.applyRecipe` is added. The catalog also gains the wrapped factory methods `fixtures.setKindConfig` and `extensionData.set`; `rename` is `nodes.rename` (scene nodes, not only fixtures).
- **B4 — Stage data is schema 4 (D6).** Schema v2 shipped without stage data and the project format is now version 3 with a migration pipeline. `project.stage` arrives as **schema 4** with `migrations/v4-stage.ts` (default audience `y+`).
- **B5 — Observation is an engine capability (D8, §6.2).** `simulate`/`capture` are defined as an `ObservationEngine` contract resolved through `#platform`. Web: a second WASM worker. The native engine of ADR 0003 D7 sends output frames to native sinks without passing through JavaScript, so it MUST implement the same contract natively (wire tap and live capture inside the engine). The follow-up engine ADR of ADR 0003 D7 MUST include this contract. The wire decoder uses the Rust inverse mapping (`rgb_read`, `from_dmx16`, `remap_range`, `nearest_wheel_slot`) exported via wasm-bindgen instead of a TS copy.
- **B6 — Spatial features follow the spread (§6.3).** Modifiers lay out by `spatial` / `rank` / `distGroup` (ABI v1.1/v1.2), not by raw position. The intent trace records these per sample. Spatial features are reported along the instance's spread (handle axis for Spatial 2D, rank order for Fixture by fixture, per fixture for Within). `sources` names alias and recipe.
- **B7 — Model access per platform (D14, §7.3).** Sign in with ChatGPT is only usable from loopback origins (open-source flow). The **desktop app is the primary target** for ChatGPT sign-in; the web build supports it only when served on `127.0.0.1` (local run), otherwise BYOK. Three transport-shaped capabilities are added to the ADR 0003 `Platform` contract, all `null` on the web:
  - `http` (requests and streams without CORS);
  - `loopback` (one-shot `127.0.0.1` callback listener);
  - `secrets` (OS keychain).

  The provider uses them when present and browser APIs otherwise. Whether the web build can reach OpenAI's token endpoint and the Responses API from the browser (CORS) is decided by a spike (plan A5.0) and recorded as B10.
- **B8 — MCP bridge per platform (D16).** The bridge transport is host-only code behind `#platform`; it is not part of the extension `Platform` contract.
  - **Desktop:** `src-tauri` hosts a streamable-HTTP MCP server on `127.0.0.1` and forwards tool calls to the webview. No CLI is needed.
  - **Web:** the `pixelmapper-mcp` Bun CLI with a WebSocket to the open tab.
- **B9 — Agents replace the AI backend; extension authoring tiers (D17, D18, §8).**
  - The in-app `fixture-definition` agent replaces `aiBackendService`. This answers ADR 0003's open point "AI backend as remote service or sidecar" with *neither*. The OCR path is decided during the port.
  - In-repo extensions already hot-reload through the dev catalog layers (ADR 0001 A19), so `ext:dev` and hot-swap target **out-of-repo** extensions.
  - The Extension Studio (Tier C) runs on both targets.
  - **Tier B** (Codex app-server sidecar with the user's ChatGPT token, spawned by `src-tauri`) moves into scope now that the Tauri shell exists.
- **B11 — Provider-agnostic by construction (D14, §7.3).** No local-model provider is built, but nothing may prevent one (Ollama, LM Studio, llama.cpp, WebLLM) from being added later as a single provider module:
  - Providers are registered in a **provider registry** (`registerModelProvider`), not chosen from a hard-coded union. ChatGPT and BYOK are just the first entries. A provider's config schema covers a free endpoint URL.
  - `ModelInfo` carries **capabilities**: `toolCalling`, `parallelToolCalls`, `contextWindow`, `structuredOutput`, `vision`, `streaming`. Agent graphs read capabilities instead of provider ids:
    - the copilot sizes the project digest to `contextWindow`;
    - it runs tools sequentially without `parallelToolCalls`;
    - it refuses with a clear message without `toolCalling`.
  - Graphs, tools, observation and the headless harness MUST NOT reference a concrete provider or vendor-specific request fields. Vendor specifics stay inside the provider module.
  - The eval runner selects the provider and model by registry id and config (`--provider <id> --config <json>`), so every future provider can be evaluated against the same scenarios.
- **B12 — MCP-first slice (D7, D8, D11, D16, §4.1, §5, §6; 2026-10-30).** The tool layer is built first and exposed over MCP. Claude Code / Claude Desktop act as the agent; the target is prompting spatial effects *with their controls* against the running app.
  - **Ordering.** A0 (event log, composite) → A1 (registry, read API, transactions, core catalog subset) → A3.4–A3.6 (observe-lite, below) → A4 (tools) → A8.1/A8.2 (bridge) run before A2, A3.1–A3.3 and A5. The whole in-app agent runtime of A5 (providers, LangGraph, copilot UI) is **deferred**; the tools are host-agnostic (`packages/agent-kit/src/tools/`, `AgentHost`), so A5 reuses them unchanged (D16).
  - **One transport for web and Tauri until A8.3.** `packages/mcp-bridge` (`pixelmapper-mcp`) is a Bun/Node stdio CLI and WebSocket hub on `ws://127.0.0.1:7778`. The app (browser tab or Tauri webview) connects as a client when "External agents" is enabled. Auth: Origin allow-list (`http://localhost:3000`, `tauri://localhost`, `http://tauri.localhost`) plus a pairing token (`~/.pixelmapper/mcp-token`). A second CLI process (e.g. Claude Code and Claude Desktop at once) connects to the first as a **relay** and takes over the port when the hub exits. The CLI forwards calls only; tools run in the app with actor `agent:mcp:<client>` and undo label `AI: <label>`. Contract: [mcp-bridge-protocol.md](../mcp-bridge-protocol.md). This narrows B8: the desktop app uses the same CLI until the in-process Rust server (A8.3) exists. The client is `getAgentBridge()` from `#platform` with one shared implementation (`app/utils/agents/agent-bridge.ts`).
  - **Tool surface over MCP.** `inspect`, `operations`, `describe`, `apply`, `observe` (+ the CLI's local `pixelmapper_status`). `delegate` and `ask_user` are **omitted**: the external client is the agent and asks its user itself. Both return with A5. `describe` also serves guide topics (`guide:plugin-authoring`, `guide:modifier-design`, `guide:plugin-sdk`, `guide:<skill>/<file>`).
  - **New operation kind `action` (§4.1).** Besides `query` and `mutation`, an `action` performs a side effect **outside** the project history: `plugins.build` (`{ manifest, source }` → hash, diagnostics, validation report; registers the package locally) and `plugins.publish`. Actions are not recorded in history, never rolled back and skipped on `dryRun`; they MUST be idempotent, which content addressing (`sha256:` package hash) guarantees.
  - **Observe-lite (D8, §6).** Two modes instead of `sim`:
    - `preview` renders **one** modifier instance per call through the real `rs-engine-core` WASM in a private headless engine (project layout, base values, only that instance; per-head readback via `read_head_signatures`). It is deterministic and can look ahead.
    - `live` captures real output through `liveHub` `signature` targets, with a DMX-byte fallback.

    `mode: 'sim'` is **not implemented** (info finding `observe-sim-unavailable`). There is no Rust intent trace (A3.2), no ObservationEngine contract (B5, A3.3), no wire decoder (A3.1) and no per-modifier contributions yet. Features: `range`, `color`, `temporal`, `spatial`, plus `radial` (lag vs. distance to points, e.g. canvas-hinted `point` params) and `mirror` (left↔right / front↔back symmetry). Text report and expectation JSON paths: [observability.md](../observability.md).
  - **Agent-enabling capabilities (ADR 0001 surface).** Added so an AI can build effects a console cannot, declaratively and without Vue code:
    - **ABI 1.3:** `Frame` gains `worldAspect`, `worldDepth`; `Sample` gains `z` and room coordinates `u`/`v` (20 slots each; no compatibility shim).
    - **`trigger` param type:** momentary input (pressed, ms since press/release, click count) encoded by the host each frame; live buttons drive it via `effect-param` mappings.
    - **Canvas hints:** `ui: { canvas: 'point' | 'radius' }` on params render draggable handles on the 2D canvas in any distribution mode.
    - **SDK pattern helpers** (`plugin-sdk/assembly/{patterns,patterns-time,trigger}.ts`): distances with aspect, `minDistToPoints`, `pingPong`, `mirror`, `pulse`, `ease`, crossing times, `envelope`, trigger readers.
  - **Effect-authoring skill.** One source, `docs/ai/skills/effect-authoring/` (workflow, patterns, UI rules, verification, reference plugins `plugins/corner-wave` and `plugins/mirror-runner` with goldens), served three ways: Claude Code skill (`.claude/skills/pixelmapper-effects` symlink), MCP prompts (`create-effect`, `add-controls`) and `describe` guide topics.
  - **Acceptance.** Scenarios in `evals/effects/` (target effects 0–6) are run **manually** from Claude Code / Claude Desktop; the automated eval runner (A6) is deferred with A5. The automated acceptance test `app/utils/agents/effects-acceptance.test.ts` drives the same tool loop headlessly in Vitest (no model involved).

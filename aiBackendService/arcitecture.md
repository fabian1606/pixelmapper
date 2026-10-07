# aiBackendService Architecture

Express + Bun service that turns fixture manuals (PDF) into OFL (Open Fixture
Library) JSON, using Gemini Flash-Lite for structured extraction and Mistral
OCR for PDF-to-text. Not an isolated package: it imports Zod schemas/types
directly from the Nuxt app's `app/utils/ofl/` and `app/utils/engine/` source
tree, so the OFL vocabulary stays a single source of truth.

## Endpoints (`src/server.ts`)

All endpoints stream progress via Server-Sent Events (SSE): each event is
`data: <json>\n\n` with no custom `event:` field, discriminated by payload
shape — `{status}` (progress), `{success, data}` (final result), or `{error,
details}` (failure).

- `POST /extract-fixture-pdf` — multipart `manualPdf`. Runs the full
  extraction LangGraph (`src/graph.ts`) from scratch: OCR → general info →
  identify channels → extract each channel → extract modes → assemble.
  Returns `{success, data: OflFixture}`.
- `POST /extract-fixture` — JSON `{manualText}`. Same graph, skips the OCR
  step (manual text already available).
- `POST /enrich-fixture-pdf` — multipart `manualPdf` + text field
  `existingOfl` (JSON-stringified `OflFixture`). Single-shot comparison (not
  a graph node — no multi-stage extraction needed since channels are already
  known): OCRs the manual, then asks the model to propose corrections to the
  fixture's **render-relevant** behavior only — shutter/strobe DMX ranges,
  dimmer DMX ranges, color wheel slot colors. Returns `{success, data:
  {proposals: EnrichmentProposal[]}}`. See `src/nodes/enrichFixture/`.
  Frontend: `app/composables/engine/useAiFixtureEnrichment.ts` +
  `app/components/engine/custom-fixture-editor/AiEnrichmentReview.vue`,
  wired into `CustomFixtureEditorDialog.vue`'s "Verify with AI" action.
  Accepted proposals are applied to a working copy of the OFL JSON via
  `app/utils/engine/enrichment-apply.ts`, then re-loaded into the editor
  draft through the same `initFromOflFixture()` round-trip the PDF import
  already uses.

## Extraction pipeline (`src/graph.ts`, `src/nodes/`)

LangGraph state machine (`ExtractionStateAnnotation` in `src/state.ts`):

```
routeBasedOnInput → [extractTextFromPdf] → extractGeneralInfo → identifyChannels
  → (Send, one per channel) → extractSingleChannel → extractModes
  → assembleOflDocument
```

- `extractTextFromPdf.ts` — Mistral OCR (`src/utils/mistralOcr.ts`), with a
  dev-mode file cache under `cache/` keyed by filename.
- `extractGeneralInfo.ts` — fills `CustomFixtureFormSchema` (app's own form
  schema, not raw OFL) via a Gemini tool call.
- `identifyChannels.ts` — one tool call enumerating every DMX channel's name
  + OFL capability type.
- `extractSingleChannel.ts` — per channel (parallel via `Send`, concurrency
  capped by a `Semaphore`), builds a **narrowed single-capability-type**
  schema rather than sending the full 43-variant `OflCapabilitySchema` union
  — Gemini misinterprets large discriminated unions. Validates against
  `OflChannelSchema`.
- `extractModes.ts` — one tool call per mode, validated against
  `OflModeSchema`.
- `assembleOflDocument.ts` — pure assembly, no LLM call: builds the final
  `OflFixture` object from the accumulated state.

## Gemini schema conversion (`src/utils/gemini-schema.ts`)

Gemini's function-calling JSON Schema support is a strict subset of what Zod
v4's `z.toJSONSchema()` emits. `toGeminiJsonSchema(zodSchema)` strips
`$ref`/`$defs`/`additionalProperties`/etc., converts `const` to single-value
`enum`, and flattens single-element `anyOf`/`oneOf`. Every Zod schema handed
to the model as a tool schema must go through this first. Reuse it for any
new structured-extraction node.

## Model (`src/model.ts`)

`getExtractionModel()` (aliased `getHaikuModel` for legacy imports) returns
`gemini-flash-lite-latest` at `temperature: 0`, `maxRetries: 2`. Requires
`GOOGLE_API_KEY`. Uses `bindTools()` (function calling), not native
structured-output, per the existing nodes' precedent — more reliable with
this model.

## Adding a new structured-extraction feature

1. Define a Zod schema in the new node's own file (or module) — keep
   discriminated unions small (≤ ~5 variants); narrow per-item like
   `extractSingleChannel.ts` does if the domain has many variants.
2. Convert with `toGeminiJsonSchema()`, wrap in a `DynamicStructuredTool`.
3. Bind to `getExtractionModel()`, loop up to ~3 attempts feeding back Zod
   validation errors as a `ToolMessage` on failure (see
   `enrichFixture/index.ts` or `identifyChannels.ts`).
4. If it fits the existing extraction pipeline, add it as a graph node in
   `src/graph.ts`; if it's a standalone comparison/review pass over already-
   known data (like enrichment), a plain async function is simpler — call it
   directly from a new `server.ts` route instead of extending the graph.
5. Stream progress via `res.write` SSE frames matching the existing shape.
6. Update this file.

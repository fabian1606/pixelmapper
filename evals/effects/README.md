# Effect acceptance scenarios (plan M6)

Seven manual scenarios, one per target effect of the MCP-first agent plan. Each file holds the user prompt, the scene it assumes, the controls the result must have, `observe` expectations (real JSON paths, see `architecture/observability.md`) and the pass criteria. They are run by hand from **Claude Code** and **Claude Desktop**; an automated runner comes with the in-app agent (A6).

| # | File | Effect |
|---|---|---|
| 0 | [0-corner-wave.md](0-corner-wave.md) | Wave from 4 draggable corner points |
| 1 | [1-mirror-runner.md](1-mirror-runner.md) | Mirrored ping-pong runner on LED tubes |
| 2 | [2-black-hole.md](2-black-hole.md) | Black hole / explosion: corners ↔ center, collision color |
| 3 | [3-edge-run.md](3-edge-run.md) | Segment running around the room contour |
| 4 | [4-crossing-diagonals.md](4-crossing-diagonals.md) | Crossing diagonals with a strobe on collision |
| 5 | [5-blackout-flash.md](5-blackout-flash.md) | Hold = blackout, release = shock wave, double-click = blinder |
| 6 | [6-chase-duo.md](6-chase-duo.md) | Two chasing points, flash on overtake |

## Reference scene ("room")

All scenarios assume the same project; build it once and save it as `evals-room` (re-load it before every run):

- **8 RGB LED tubes**, 24 pixels each (multi-head fixtures, `heads: 24`), two per wall of a rectangular room (about 0.1–0.9 in x and 0.2–0.8 in y). Group `Tubes` (id written below as `g-tubes`).
- Tubes are **patched as a loop** (clockwise: pixel 1 of each tube follows the last pixel of the previous one). Scenario 1 has a variant with the side-wall tubes patched in the same direction.
- **4 RGB PARs** at the room corners, group `PARs` (`g-pars`), ids written as `par-tl`, `par-tr`, `par-br`, `par-bl`.
- Programmed base: every fixture at a visible color (e.g. warm white at 60 %), so `scale` effects have something to scale.
- **BPM 120** (one beat = 0.5 s, one 4-beat bar = 2 s). Empty modifier stack, no live pages.
- The JSON snippets use these placeholder ids; replace them with the real ids from `inspect { "selector": "project" }`. The room box (bounding box of all heads) is written as `minX…maxX`, `minY…maxY`; the room center as `cx, cy`.

## Setup

1. `bun run dev` (or `bun run dev:tauri` for the desktop app) and open `http://localhost:3000`.
2. Pairing token: `bun run mcp token` (created once in `~/.pixelmapper/mcp-token`).
3. In the app: **Settings** (gear icon in the header) → **External agents**: turn it on, paste the token. The status says *Connected* once a Claude client has started the CLI (*Waiting for pixelmapper-mcp* before).
4. Register the MCP server (name `pixelmapper`):
   - **Claude Code**, inside the repo: `cp .mcp.json.example .mcp.json`; from anywhere:
     ```bash
     claude mcp add pixelmapper -- bun run /ABSOLUTE/PATH/TO/pixelmapper/packages/mcp-bridge/src/cli.ts
     ```
     The repo also provides the `pixelmapper-effects` skill (`.claude/skills/pixelmapper-effects` → `docs/ai/skills/effect-authoring`).
   - **Claude Desktop**: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows), then restart Claude Desktop:
     ```json
     { "mcpServers": { "pixelmapper": { "command": "bun", "args": ["run", "/ABSOLUTE/PATH/TO/pixelmapper/packages/mcp-bridge/src/cli.ts"] } } }
     ```
     Use the absolute `bun` path (`which bun`) if Desktop cannot find it.
5. Check: ask Claude to call `pixelmapper_status`; it must report the app as connected.

## Run procedure (per scenario × client)

1. Load `evals-room`; clear the undo history (reload the project).
2. Start a **fresh** conversation.
   - Claude Code: paste the prompt (the skill triggers on effect requests), or run the MCP prompt `/mcp__pixelmapper__create-effect` with the prompt as `description`.
   - Claude Desktop: attach the `create-effect` prompt from the `pixelmapper` server (prompt menu) and paste the prompt as `description`, or paste the prompt directly and add "Use the Pixelmapper effect-authoring guide."
3. Do not help beyond answering questions the agent asks (answer with the setup facts above).
4. When the agent is done, check the controls by hand: card params and labels, canvas handles (drag them; the effect must follow), recipes, live page and every widget (move each slider, press each button).
5. Re-run the scenario's `observe` expectations yourself if the agent skipped or changed them (copy the JSON into a request to the agent: "run exactly this observe call").
6. Press **Undo once**: the effect, its live page and all widgets must disappear together (the undo label reads `AI: …`). Redo, then Undo again for the record.
7. Fill in a results row.

## What to record

- Build: number of `plugins.build` attempts until `ok: true`, final hash, any `validate` diagnostics.
- Expectations: pass/fail per scenario expectation (agent's run and your re-run), plus the text report of the final `observe`.
- Controls: missing / extra / badly named params, handles, recipes, widgets; any `mapping-ignored-by-widget` warning.
- Undo: one step? anything left behind?
- Findings with level `error` or `warning` in any `apply` / `observe` result.
- Time to done and number of tool calls (rough), plus every gap (a missing helper, operation or observe feature) for the plan (M6 feeds back into M4/M5).

## Results

Recorded runs: [2026-10-30 live MCP run (headless app, agents as client)](results/2026-10-30-live-mcp-run.md).

| Scenario | Client | Date | Build ok (attempts) | Expectations | Controls | One undo | Notes |
|---|---|---|---|---|---|---|---|
| 0 corner wave | Claude Code | | | | | | |
| 0 corner wave | Claude Desktop | | | | | | |
| 1 mirror runner | Claude Code | | | | | | |
| 1 mirror runner | Claude Desktop | | | | | | |
| 2 black hole | Claude Code | | | | | | |
| 2 black hole | Claude Desktop | | | | | | |
| 3 edge run | Claude Code | | | | | | |
| 3 edge run | Claude Desktop | | | | | | |
| 4 crossing diagonals | Claude Code | | | | | | |
| 4 crossing diagonals | Claude Desktop | | | | | | |
| 5 blackout flash | Claude Code | | | | | | |
| 5 blackout flash | Claude Desktop | | | | | | |
| 6 chase duo | Claude Code | | | | | | |
| 6 chase duo | Claude Desktop | | | | | | |

Repeat the table for `bun run dev:tauri` (desktop app) when testing a release.

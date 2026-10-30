# Effect scenarios — live MCP run, 2026-10-30

First run of scenarios 0–6 against the **running app** (branch `feat/mcp-agent-tools`, `nuxt dev` in headless Chrome) through real `pixelmapper-mcp` processes (one hub, every call a fresh relay process). Three Opus agents played the AI. They used **only the MCP tools and prompts**, as Claude Desktop without repo access would, and could read only the scenario files.

**Scene:** 4 LED tubes, 12 DRGB pixels each, along the walls, patched as a clockwise loop (`g-tubes`), plus 4 corner PARs (`g-pars`). Base: full white. This is smaller than the README's reference room (8 × 24 px).

**Not covered by this run:**
- a real Claude Code / Claude Desktop UI;
- a signed-in project;
- `dev:tauri`;
- physical presses of live widgets;
- the per-scenario "one Undo" check. Agents were told not to use global undo on the shared project. One-undo for an effect + page + widget batch was checked separately in the live app: one undo removed all of it.

| Scenario | Verdict | Build (attempts) | Expectations | Controls | Notes |
|---|---|---|---|---|---|
| 0 corner wave | PASS | built-in `corner-wave` | 11/11; radial r 1.00 outward; Implode r −0.999; simulated drag moves `radial.from` | 4 canvas points, reach ring, recipes, live sliders | — |
| 1 mirror runner | PARTIAL | built-in `mirror-runner` | `mirror.x.r` 1.0, period 2 s, reverse / front-back / tail / speed switches behave | Reverse button, sliders | `fixtures.*.range.max > 0.5` fails because observe averages a tube's pixels (0.15–0.30 vs. pixel max 0.95). Observe limitation, fixed in WP-I. Variant B not run. |
| 2 black hole | PASS | own plugin, 1 | 8/8; inward r −0.98, explode +0.996, collision flash white | start/curve enums, colors, width, flash; 3 recipes; live sliders | A thin ring plus a whole-room flash reads as outward; check radial with the flash off (documented) |
| 3 edge run | PASS | own plugin, 1 | 9/9; periodic 4 beats; clockwise onset order, flips with counter-clockwise | length/softness/direction; 3 recipes; direction button, sliders, beat widget | Validator falsely warned "constant output" for an order-spread plugin (fixed in WP-I) |
| 4 crossing diagonals | PASS | own plugin, 1 | periodic 4 beats, mirror x r 1.0, strobe only at the crossing, colors as set | colors, size, strobe length/rate; 3 recipes; live sliders | — |
| 5 blackout flash | PASS (live press not verified) | own plugin, 1 | hold black; release radial r 0.999 outward; idle pass-through; double-click blinder | `trigger` param with a big live button first, sliders, 3 recipes | Trigger states were set via `modifiers.update` (adds undo steps); `modifiers.trigger` action added in WP-I |
| 6 chase duo | PARTIAL | own plugin, 1 | overtake flashes exactly at 2 s / 6 s; colour swap; speed change moves them | speeds, colours, size, flash; 3 recipes; live sliders | Group classified aperiodic although each fixture is periodic at 8 beats (multi-period, fixed in WP-I); scenario windows needed adjusting |

## Bugs found and where they went
- **First call of a fresh `pixelmapper-mcp` process often returned `no_app`.** About a third of calls were affected. Calls now wait up to 8 s for a connected app (`PIXELMAPPER_MCP_APP_WAIT_MS`); re-checked live with 0/10 failures. Commit `fix(mcp): first call waits for the app …`.
- **An action-only `apply` reported "rolled back".** Fixed (`fix(agent): report action-only apply batches as run …`).
- **Fixed in WP-I:**
  - per-head observe data;
  - multi-period classification;
  - observe `targets` vocabulary and validation;
  - mirror and group lines in the text report;
  - short-window warnings;
  - validator rig for order spreads;
  - `inspect` truncation notice;
  - world positions of heads;
  - `id` / `modifierId` consistency;
  - the `modifiers.trigger` action;
  - trigger, blend and window guidance in the skill.

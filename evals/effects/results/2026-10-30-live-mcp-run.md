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

## 2026-10-30 — re-run on master (final)

Re-run of scenarios 1, 5 and 6 against the live app on `master` after WP-I to WP-L, on the same 4 × 12 rig. The open items it left were fixed in WP-M (`feat/agent-final-fixes`): live signature choice, `modifiers.update` speed merge and the `id` alias, live group temporal under capture jitter, `beatLock` only for beat-mode speeds, timed triggers inside a live `observe`, the startup layout packet, and the scenario specs.

**Scenario 1 (reused `mirror-runner`, DIMMER)**

| Check | Verdict | Notes |
|---|---|---|
| Preview periodic, mirror | PASS | Periodic 1.999 s; `mirror.x.r` 1.00 over 48 pairs |
| Every pixel lit | PASS | Head max 0.953 on all 48 heads |
| Mirror A/B | PASS | `frontBack`: `mirror.y.r` 1.00 |
| Reverse A/B | PASS | `order.first` flips tube-right.4 ↔ tube-front.4 |
| Controls | PASS | |
| Live | PARTIAL | Without `signature`, live read the static RGB base and reported `constant` / `stuck-1` while the DIMMER layer moved. Fixed in WP-M: live picks the signature of the moving layer. The spec now passes `signature: "scalar"` |
| One undo | PASS | |
| Screenshot | PASS | |

**Scenario 6 (own plugin, built first try)**

| Check | Verdict | Notes |
|---|---|---|
| Flashes at 2 / 6 / 10 s | PASS | |
| Colour swap magenta → cyan | PASS | |
| Speed B 0.75 | PASS | Flashes at 4 / 12 s |
| Equal speeds | PASS | No NaN |
| Controls | PASS | |
| One undo | PASS | |
| Group period | PASS on the derived expectation | Measured 16 beats. The spec said 8 and was wrong: the colour swap doubles the full period. Spec fixed in WP-M |

**Scenario 5 (own plugin, built first try)**

| Check | Verdict | Notes |
|---|---|---|
| Preview frozen states | PASS | |
| Live press → blackout | PASS | |
| Live release → wave | PASS | Wave from the corners (radial outward, r 0.98); recovered by 3.9 s |
| Double-click | PARTIAL | The full-white base hid the blinder; the held double-click only proved white. The spec now requires the 60 % warm base and "click then press in one request" |
| Triggers create no undo entries | PASS | |
| One undo | PASS | |
| Screenshot | PASS | |

**Not covered:** a human tester clicking through a real Claude Desktop or Claude Code UI against a signed-in project in `dev:tauri`. The user has since used Claude Desktop against the desktop app; that feedback led to WP-J, WP-K and WP-L.

## 2026-10-30: real Claude Code client and real button presses (master 1e1f6c1)

**Setup.** Two headless runs of the **Claude Code CLI** (`claude -p`, v2.1.181) against the running app. Each run:
- started from an empty directory, with no repo context;
- used only the `pixelmapper` MCP server (`--strict-mcp-config`), with all non-MCP tools disallowed;
- reached its own `pixelmapper-mcp` hub, which forwarded to the app in headless Chrome.

The room is the 4×12-pixel tube loop with 4 corner PARs and a full base.

| Run | Prompt (short) | Tool calls | Errors | Result |
|---|---|---|---|---|
| 1 | Tubes along the walls, rotated along them, PARs in the corners, check with a screenshot. Then a wave from the four corners with draggable points, a live page, and a check with observe. | 15 | 1 (`screenshot` `view: "canvas"`: no editor mounted headless; switched to `layout` by itself) | Read the layout and the head directions correctly from inspect and screenshot: tube-front 0° left→right, tube-right 90° top→bottom, … No rotation guessing. Built-in corner-wave with points A–D at the PAR corners as canvas handles, plus a live page with 4 xy pads, 5 sliders, a stage preview and beat: one undo step "AI: Corner Wave + live page". Checked with live observe. ≈ $0.74 |
| 2 | Hold the button for blackout; release sends a shock wave from the corners inward; a double-click gives a blinder. Button first on a new page, sliders for speed and decay; check with observe and triggers. | 14 | 0 | Wrote and built its own plugin on the first try. Added modifier and page in one batch. Checked hold/release and the double-click with `observe.triggers`: press → black; release → PARs at 1.22 s, then tubes 67 ms later; double-click → white at once. ≈ $0.89 |

**Real button presses.** The HIT button that Claude built in run 2 was pressed through the app's own button runtime (`pressButton` / `releaseButton`, the code a click on the live page runs) during a live `observe`:
- **Hold, then release:** everything goes off at 1.62 s (press). On release the corner PARs come back first (2.85 s), then the tubes (2.91 s): `order` reads par-tl → tube-front, so the wave runs from the corners inward.
- **Double-click** (two press/release pairs within 360 ms): a short off from the first press at 1.58 s, then full white at 1.70 s (blinder, colour "white").
- The presses created no undo entries.

**Still to check by hand:**
- the Claude Desktop GUI;
- the Tauri WKWebView (`dev:tauri`);
- a mouse click on the live page in a signed-in project.

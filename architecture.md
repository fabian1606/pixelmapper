# Pixelmapper Architecture

## Core Tech Stack
- **Framework:** Nuxt 4 + Vue 3
- **UI Components:** Shadcn-vue, Tailwind CSS
- **Runtime:** Bun
- **Language:** TypeScript (Strict Mode)

---

## Effect Engine

The Effect Engine computes per-frame DMX channel values (0–255) for all connected fixtures, transforming time-based oscillations and spatial positioning into light output.

### Core Concepts

#### FixtureGroup
A `FixtureGroup` is a logical container that can hold `Fixture`s or other `FixtureGroup`s, forming a hierarchy (similar to Figma layers).
- **`id`** — Unique identifier.
- **`name`** — Display name (e.g., "New Group").
- **`children: SceneNode[]`** — The nested nodes within this group.
- **`parent: FixtureGroup | null`** — Reference to the parent group, if any.
- **`getAllFixtures()`** — Recursively extracts all child fixtures for rendering limitelessly nested groups.

#### Fixture
A `Fixture` is the top-level entity representing a physical light device. It contains:
- **`id`** — Unique identifier.
- **`name`** — Display name.
- **`parent: FixtureGroup | null`** — Reference to the parent group, if any.
- **`channels: Channel[]`** — The DMX channels this fixture exposes.
- **`fixturePosition: { x, y }`** — World-space position in normalized 0–1 space (used by the Fixture Editor and spatial effects).
- **`beams: Beam[]`** — One or more beams. For a simple RGB LED, this is one Beam at `{localX: 0, localY: 0}`. Complex fixtures (moving heads, LED bars) can define multiple beams, each with a local offset from the fixture's world position.
- **`resolveColor(): string`** — Computes the fixture's current visual color from its channel states and blending rules. Used by the Fixture Editor for display.

#### Channel
Each channel has:
- **`type: ChannelType`** — e.g. `RED`, `GREEN`, `BLUE`, `DIMMER`, `PAN`, `TILT`.
- **`value: number`** — Current DMX output value (0–255), written by the engine each frame.
- **`baseValue: number`** — The resting value effects oscillate around.
- **`role: ChannelRole`** — How this channel participates in color computation:
  - `COLOR` — Contributes a color addtively. Must provide `colorValue` (hex string).
  - `DIMMER` — Scales all `COLOR` channels globally (0 = off, 255 = full).
  - `NONE` — No visual contribution (e.g. PAN, TILT).
- **`colorValue: string`** — The peak hue of this channel (e.g. `#FF0000` for RED). Only used when `role === 'COLOR'`.

#### Beam
A `Beam` lives inside a `Fixture` and represents a single output point of light.
- **`id`** — Beam identifier within the fixture.
- **`localX`, `localY`** — Offset relative to the fixture's world position. Defaults to `0, 0`.
- Future extension: `rotation`, `zAngle`, `spread` for moving heads.

---

### EffectEngine & Rendering

`EffectEngine.render(fixtures, timeMs, deltaTimeMs)` runs once per animation frame:

1. **Update phase** — calls `effect.update(deltaTime)` on every effect to accumulate internal state (e.g. phase position).
2. **Reset channels** — each channel is reset to its `baseValue`.
3. **Apply effects** — for each fixture, each effect renders a normalized wave shape `[-1, 1]`. The engine maps this shape to a safe DMX range `[max(0, base - strength), min(255, base + strength)]`, then adds the offset to the channel value.
4. **Clamp** — final values are clamped to `[0, 255]`.

This additive blending allows multiple effects to stack naturally.

---

### Effects: BaseOscillatorEffect

All time-based oscillator effects extend `BaseOscillatorEffect`. Subclasses only need to implement `getShape(phase: number): number`.

#### Parameters
| Property | Description |
|---|---|
| `speed` | Rate of phase accumulation (phase/ms). |
| `strength` | Amplitude in DMX units (0–255). |
| `fanning` | Per-fixture phase offset multiplier. |
| `direction` | How phase offset is calculated across fixtures. |
| `targetChannels` | Array of channel types to apply the effect to. |
| `targetFixtureIds` | Optional array of fixture IDs to restrict the effect to. Used heavily by the Modifiers UI. |

#### Direction Modes
| Mode | Behavior |
|---|---|
| `FORWARD` | Phase offset increases from fixture 0 → N |
| `BACKWARD` | Phase offset increases from fixture N → 0 |
| `CENTER_OUT` | Phase offset radiates outward from the center index |
| `OUTSIDE_IN` | Phase offset converges inward from both edges |
| `SPATIAL_X` | Phase offset driven by fixture's world X position |
| `SPATIAL_Y` | Phase offset driven by fixture's world Y position |
| `SPATIAL_RADIAL` | Phase offset driven by distance from center (0.5, 0.5) |

#### Built-in Effects
- **`SineEffect`** — Smooth sinusoidal wave. `getShape = Math.sin(phase)`.

#### Adding New Effects
```ts
// Example: SawEffect
export class SawEffect extends BaseOscillatorEffect {
  getShape(phase: number): number {
    return ((phase / (2 * Math.PI)) % 1) * 2 - 1; // sawtooth -1 to 1
  }
}
```

---

### Fixture Editor

`FixtureEditor.vue` is a standalone visual component for arranging fixtures in 2D space.

- Renders each fixture as a glowing colored circle, color derived from `fixture.resolveColor()`.
- Support drag-and-drop to update `fixture.fixturePosition`.
- Positions are normalized (0–1), making them resolution-independent.
- The updated positions are immediately used by spatial direction modes (SPATIAL_X/Y/RADIAL) in the next render frame.

### Context Menu System

`FixtureContextMenu.vue` is the single shared context menu wrapper used by every interactive node.
- Accepts capability flags (`canZoom`, `canGroup`, `canUngroup`, `canDelete`) to control which items appear.
- Default slot is used as the `ContextMenuTrigger`, so any element can be wrapped.
- Internally renders `DeleteConfirmDialog` on delete requests.
- Used by `FixtureNode` (2D canvas), `FixtureSidebarNode` (sidebar), and `FixtureGroup` nodes.

### Delete Flow

1. User right-clicks a fixture → context menu shows **Delete** with `Del` shortcut label.
2. Alternatively, user presses `Del` or `Backspace` while a fixture is selected in the 2D editor.
3. `DeleteConfirmDialog` is shown with the fixture name and an undo hint.
4. On confirm, `DeleteNodeCommand` is executed via `useHistory()` → supports undo with `Cmd+Z`.

### Property Changes Flow
Channel values (faders, capability dropdowns, stepValues, base colors, and chaser configs) are mutated through the UI.
To support `Cmd+Z`, the system uses `SetChannelValuesCommand`:
1. Before a change (e.g. `mousedown` on a fader or entering a number), a deep copy of the `ChannelSnapshot` is taken for all affected fixture channels.
2. The user interacts and freely mutates the live object.
3. On completion (e.g. `mouseup`), a post-change snapshot is captured.
4. If there's a difference, the `SetChannelValuesCommand` is pushed to `useHistory()`.

---

## Fixture Library (OFL)

The system integrates with the **Open Fixture Library (OFL)** to provide a vast database of standardized fixture definitions.

- **Local Data Source:** A shallow clone of the OFL repository exists at `ofl-data/` (gitignored).
- **Server API:** Nuxt server routes (`/api/fixtures`) browse and serve the local JSON definitions.
- **Fixture Factory:** `createFixtureFromOfl` translates OFL definitions into internal `Fixture` and `Channel` structures, mapping capabilities and colors to the internal engine types.
- **Library Browser:** A grouped accordion UI in a global dialog allows users to search, select, and configure fixtures (Universe, DMX Address, Mode) before adding them to the scene.

---

## Directory Layout
```
app/utils/engine/
├── types.ts                    # Core types: ChannelType, EffectDirection, Effect interface
├── engine.ts                   # EffectEngine controller
├── core/
│   ├── group.ts                # FixtureGroup and SceneNode hierarchy (Figma-style grouping)
│   ├── channel.ts              # Channel interface, ChannelRole, concrete classes
│   ├── beam.ts                 # Beam class (local offset within a fixture)
│   └── fixture.ts              # Fixture class with position, beams, resolveColor()
└── effects/
    ├── base-oscillator-effect.ts   # Abstract base for oscillating effects
    └── sine-effect.ts              # SineEffect implementation

app/components/engine/
├── FixtureSidebar.vue          # Figma-style sidebar layer hierarchy
├── FixtureSidebarNode.vue      # Recursive node for folders/fixtures; uses FixtureContextMenu
├── FixtureContextMenu.vue      # Unified context menu; capability flags control visible items
├── DeleteConfirmDialog.vue     # AlertDialog confirmation before deleting a node
├── commands/
│   ├── move-fixture-command.ts  # History command for dragging fixtures
│   ├── group-command.ts         # History commands for grouping/ungrouping
│   ├── rename-command.ts        # History command for renaming a node
│   ├── delete-node-command.ts   # History command for deleting a fixture or group (undo-able)
│   └── set-channel-values-command.ts # History command for undoing channel mutations (drag, dropdowns, etc)
└── FixtureEditor.vue           # 2D drag-and-drop fixture positioning UI
```

---

## Coding Guidelines
- **Modules**: ESM focus.
- **Types**: Shared types in `types/` or co-located for specific features. Prefer interfaces for objects, types for unions. Avoid `any`.
- **Functions**: Keep under 50 lines. Prefer pure functions. Extract reusable logic. Avoid deep nesting (>3 levels).
- **Naming**: `kebab-case` for files, `camelCase` for vars/funcs, `PascalCase` for types/classes, `UPPER_SNAKE_CASE` for constants.
- **Documentation**: All new major features should be added to this file.

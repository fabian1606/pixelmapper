# UI & History

## Fixture Editor and Workspace

`FixtureEditor.vue` is the main 2D canvas for arranging fixtures in world space.

- Renders each fixture as a glowing colored circle; color derived from `fixture.resolveColor(dmxBuffer)`.
- Supports drag-and-drop to update `fixture.fixturePosition`.
- Positions are normalized (0–1), making them resolution-independent.
- Updated positions are immediately encoded into the next `layoutPacket` rebuild (via the `watch(flatFixtures)` watcher in engine-store).
- **Swap handles (Figma-style)**: with ≥2 fixtures selected (groups count via their members, max 400), an SVG overlay draws a small grey dot at each selected fixture's visual center. Dragging a dot drags that fixture with the pointer. Every fixture's pre-drag footprint is frozen at drag start as its hover zone (`pointInFootprint`, +4 px). Hovering another fixture's zone moves that fixture into the dragged fixture's original place and shows a ghost outline (`fixtureFootprint`) of the dragged fixture where the partner stood. Leaving the zone sends the partner back. Releasing on a partner snaps into the ghost; both changes are one `MoveFixtureCommand` (x/y only; z and rotation stay). Releasing elsewhere or leaving the viewport returns everything to the original positions. Code: `composables/use-swap-handles.ts` (pointer, live placement, ghost) and `utils/engine/swap-positions.ts` (pure math — kind fixtures swap by AABB center, not origin).

### 60 fps Rendering Optimizations

1. **O(1) camera panning** — All fixtures live in a single `.world-container`. Pan and zoom are applied to the container via `transform: translate3d(...) scale(...)`, not to individual fixtures.
2. **GPU-accelerated positioning** — Individual fixture nodes use `transform: translate3d(...)` instead of `left`/`top`, keeping layout out of the critical path.
3. **Reactivity detachment** — The canvas draw loop does not use `watchEffect`. It relies on manual shallow watchers on `camera` and `engine.dmxBuffer` to trigger redraws.
4. **Native clipping** — Off-screen fixtures are not conditionally rendered with `v-if`/`v-show`. The world container's `overflow: hidden` lets the browser clip them for free.

## History & Command Pattern

All user actions that mutate fixture data go through a `Command` pushed to `useHistory()`. This enables full Cmd+Z / Redo support.

### Command Examples

| Command | Triggered by |
|---------|-------------|
| `SetChannelValuesCommand` | Dragging a fader, editing a step value |
| `SetModifiersCommand` | Adding/removing an effect |
| `DeleteNodeCommand` | Deleting a fixture or group |
| `MoveNodeCommand` | Dragging a fixture in the editor |

### SetChannelValuesCommand Flow

1. On `mousedown`: take a deep snapshot of the affected channel's `ChaserConfig`.
2. User interacts freely with the live object.
3. On `mouseup`: take a post-change snapshot.
4. If different: push `SetChannelValuesCommand` to history.

This avoids recording every intermediate drag position — only the before/after states are stored.

### Undo/Redo & Engine Sync

When history undoes/redoes a `SetModifiersCommand`, the effects array may be replaced entirely. The engine-store watches `history.version` and re-syncs `activeEffects` if needed:

```typescript
watch(() => history.version.value, () => {
    triggerRef(sceneNodes)
    if (engine.effects !== activeEffects.value) {
        activeEffects.value.splice(0, activeEffects.value.length, ...engine.effects)
        engine.effects = activeEffects.value
    }
})
```

## Context Menu System

`GlobalContextMenu.vue` (mounted once in `app.vue`) renders the menu opened via `useGlobalContextMenu().openMenu(event, options, context?)`. The optional `context = { id, scopes }` names the menu for extensions (slot `context-menu/<id>:items`) and carries the opener's scopes, which the menu re-provides to contributed items (see [extensions.md](extensions.md)).

## Layout Primitives

Extensible UI is built from layout primitives in `app/components/primitives/` — `PmPanel`, `PmPanelSection`, `PmToolbar`, `PmMenuGroup`, `PmListItem`. Each takes a stable kebab-case `id`, renders its root as `as` (element or component, attributes fall through) and automatically places extension slots (`<path>:<position>`). Use them for any new panel, section, toolbar, menu or list row so extensions can contribute without extra wiring; see [extensions.md](extensions.md#slots) for positions, manual placement and the current slot ids.

Domain inputs (faders, number fields, color/XY inputs, tap tempo, trigger buttons, …) are rendered through `<Replaceable name="pm.*">` — never import `app/components/pm/*` directly.

## Sidebar

`FixtureSidebar.vue` provides a navigable tree of all fixtures and groups with:

- **Fixture tree tab** — Hierarchical view with selection sync to the canvas editor. Hovering a fixture in the 2D canvas highlights its row (`canvas-hover-store.ts`), also inside a selected group, and scrolls it into view.
- **Highlight (identify)** — Context menu of a tree row or the canvas selection: "Highlight (Blink White)" / "Stop Highlight" toggles the fixtures blinking full white at 2 Hz. Not a history command and not persisted: `engine-store` keeps the highlighted ids and writes `highlight-overlay.ts` slots onto the final output buffer after the Simple Desk overrides, so effects can't mask it (needed for RGB-only fixtures, which have no dimmer). Cleared by "Clear all" and on project load.
- **Preset/programmer tab** — Active preset management.
- **Selection info** — Average X/Y position for multi-selections; full channel details (address, type, manufacturer, model) for single selections.

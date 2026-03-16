# UI & History

## Fixture Editor and Workspace

`FixtureEditor.vue` is the main 2D canvas for arranging fixtures in world space.

- Renders each fixture as a glowing colored circle; color derived from `fixture.resolveColor(dmxBuffer)`.
- Supports drag-and-drop to update `fixture.fixturePosition`.
- Positions are normalized (0–1), making them resolution-independent.
- Updated positions are immediately encoded into the next `layoutPacket` rebuild (via the `watch(flatFixtures)` watcher in engine-store).

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

`FixtureContextMenu.vue` is the single shared context menu used by all interactive nodes (canvas nodes, sidebar nodes, group nodes). It accepts capability flags (`canZoom`, `canGroup`, `canUngroup`, `canDelete`) to show/hide items, and renders `DeleteConfirmDialog` on delete requests.

## Sidebar

`FixtureSidebar.vue` provides a navigable tree of all fixtures and groups with:

- **Fixture tree tab** — Hierarchical view with selection sync to the canvas editor.
- **Preset/programmer tab** — Active preset management.
- **Selection info** — Average X/Y position for multi-selections; full channel details (address, type, manufacturer, model) for single selections.

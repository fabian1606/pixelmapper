# Vue UI & Editor Systems

The visual surface of the application. The UI mostly reads from `engine.dmxBuffer` to draw colors on the screen, remaining cleanly decoupled from the heavy math of the core engine.

## Fixture Editor
`FixtureEditor.vue` is a standalone visual component for arranging fixtures in 2D space.

- Renders each fixture as a glowing colored circle, color derived from `fixture.resolveColor(dmxBuffer)`.
- Support drag-and-drop to update `fixture.fixturePosition`.
- Positions are normalized (0–1), making them resolution-independent.
- The updated positions are immediately used by spatial direction modes (SPATIAL_X/Y/RADIAL) in the next render frame.

## Context Menu System
`FixtureContextMenu.vue` is the single shared context menu wrapper used by every interactive node.
- Accepts capability flags (`canZoom`, `canGroup`, `canUngroup`, `canDelete`) to control which items appear.
- Default slot is used as the `ContextMenuTrigger`, so any element can be wrapped.
- Internally renders `DeleteConfirmDialog` on delete requests.
- Used by `FixtureNode` (2D canvas), `FixtureSidebarNode` (sidebar), and `FixtureGroup` nodes.

## History & Command Pattern
The system provides proper `Cmd+Z` / Undo-Redo via the `useHistory()` composable and the Command pattern.

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

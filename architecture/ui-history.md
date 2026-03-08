# Vue UI & Editor Systems

The visual surface of the application. The UI mostly reads from `engine.dmxBuffer` to draw colors on the screen, remaining cleanly decoupled from the heavy math of the core engine.

## Fixture Editor and Workspace
`FixtureEditor.vue` is a standalone visual component for arranging fixtures in 2D space.
- Renders each fixture as a glowing colored circle, color derived from `fixture.resolveColor(dmxBuffer)`.
- Support drag-and-drop to update `fixture.fixturePosition`.
- Positions are normalized (0–1), making them resolution-independent.
- The updated positions are immediately used by spatial direction modes (SPATIAL_X/Y/RADIAL) in the next render frame.

### 60fps Rendering Optimizations
To maintain a smooth 60fps even with 50+ fixtures on screen, the editor employs several advanced DOM and Vue optimization strategies:
1. **Containerization for O(1) Camera Panning**: Instead of recalculating camera offsets for each fixture, all fixtures are placed in a single static `.world-container`. The camera's pan and zoom are applied globally to this container using `transform: translate3d(...) scale(...)`. This reduces the rendering cost of moving the camera from O(N) to O(1).
2. **Hardware-Accelerated CSS**: Individual fixture nodes are mapped to their world coordinates using `transform: translate3d(...)` rather than `left` and `top` CSS properties, shifting DOM movement entirely to the GPU and preventing layout thrashing.
3. **Reactivity Detachment`: The underlying `FixtureCanvas` (which draws the beams) is explicitly detached from Vue's deep reactivity system. Instead of using `watchEffect` (which builds massive dependency graphs out of the deeply reactive Fixtures 60 times a second), it relies on manual, shallow watchers on the `camera` and `engine.dmxBuffer` to trigger its `draw()` loop.
4. **Native Clipping**: We omit `v-show` and `v-if` for off-screen fixtures entirely. Because the world container has `overflow: hidden`, the browser's native compositing engine perfectly clips invisible DOM nodes essentially for free, whereas Vue directive evaluations incur significant CPU overhead during rapid zooming or panning.

`FixtureWorkspace.vue` wraps the editor and provides the core layout for the canvas, along with the main right-click Context Menu.

`index.vue` is deliberately kept as a pure layout shell, using `useWorkspaceOperations()` to delegate Node logic, and the `engine-store.ts` for all selection and data references.

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

### The Ticker Pattern
Beyond undo/redo, `useHistory()` provides a reactive `version` ref. This acts as a global "state changed" heartbeat for the application. Because fixtures are stored in a `shallowRef` (to prevent massive deep proxy evaluation graphs natively in Vue), components use this Ticker version to explicitly trigger re-renders exactly when needed.

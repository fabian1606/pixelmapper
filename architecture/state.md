# Global State Management

The single source of truth for saved data (Presets) and the current workspace configuration. It bridges the gap between the stateless EffectEngine and the Vue UI.

## Pinia (`engine-store.ts`)
- Hosts the true global state of the workspace: `sceneNodes`, `flatFixtures`, and `selectedIds`.
- Instantiates the `EffectEngine` and controls the `dmxBuffer`, running the `requestAnimationFrame` loop globally so the math never stops when pages change.
- Tracks the central repository of `savedPresets` and `selectedPresetId`.
- Used extensively by `use-presets.ts` to manage loading, saving, and diffing against the DMX output states without mutating raw Vue component variables.

### Why do Presets store Fixture References (`fixtureIds`)?
A Preset in Pixelmapper goes beyond traditional flat "global palettes." It functions as an explicitly mapped snapshot:
- **Selective Application**: By saving an array of `fixtureIds` within each category block of a `Preset`, the system knows *exactly* which fixtures this preset was authored for. 
- **Modularity**: A user can create a "Red Color" preset exclusively for their Wash lights without accidentally blowing out the colors on their Spot lights when the preset is triggered.
- **Diffing & Tracking**: When the user edits a fader, the UI needs to know which preset is currently active and whether it has unsaved changes. The engine scans the live programmer state against the preset's snapshots (filtered by these `fixtureIds`). If a user selects a fixture *not* referenced in the preset, changing its channels won't artificially flag the preset as "modified."

## Reactivity via History Ticker
Because `Fixture` and `Channel` objects are marked with `markRaw()` (to prevent Vue reactivity overhead during 60fps rendering), standard Vue `computed` properties do not always detect when their internal properties (like `stepValues`) change.

To solve this, the system uses a **History Ticker** pattern:
- The `useHistory()` composable exposes a reactive `version` ref.
- Every time a `Command` (like `SetChannelValuesCommand`) is executed, undone, or redone, `version.value++` is triggered.
- UI components that need to re-evaluate based on "raw" fixture data simply include `history.version.value` inside their computed functions.
- This forces Vue to re-run the computation whenever the user performs an undoable action, ensuring the UI (e.g., "Unsaved Changes" indicators) stays in sync without the performance cost of deep proxies.

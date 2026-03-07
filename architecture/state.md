# Global State Management

The single source of truth for saved data (Presets) and the current workspace configuration. It bridges the gap between the stateless EffectEngine and the Vue UI.

## Pinia (`engine-store.ts`)
- Tracks the central repository of `savedPresets`.
- Maintains the `selectedPresetId`.
- Used extensively by `use-presets.ts` to manage loading, saving, and diffing against the DMX output states without mutating raw Vue component variables.

### Why do Presets store Fixture References (`fixtureIds`)?
A Preset in Pixelmapper goes beyond traditional flat "global palettes." It functions as an explicitly mapped snapshot:
- **Selective Application**: By saving an array of `fixtureIds` within each category block of a `Preset`, the system knows *exactly* which fixtures this preset was authored for. 
- **Modularity**: A user can create a "Red Color" preset exclusively for their Wash lights without accidentally blowing out the colors on their Spot lights when the preset is triggered.
- **Diffing & Tracking**: When the user edits a fader, the UI needs to know which preset is currently active and whether it has unsaved changes. The engine scans the live programmer state against the preset's snapshots (filtered by these `fixtureIds`). If a user selects a fixture *not* referenced in the preset, changing its channels won't artificially flag the preset as "modified."

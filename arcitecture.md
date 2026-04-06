# Pixelmapper Architecture

This document outlines the core architectural patterns of the Pixelmapper application to help build scalable and expandable software.

## Tech Stack Overview
- **Language**: TypeScript (preferred over JavaScript)
- **Runtime / Package Manager**: Bun (preferred over npm/node)
- **Framework**: Nuxt 3 / Vue 3
- **State Management**: Pinia
- **Core Engine**: Custom TypeScript engine for DMX/Fixture management, Effects, and Presets. (Partially Rust WASM for rendering/canvas)
  - **WASM Integration**: Requires `vite-plugin-wasm` and `vite-plugin-top-level-await` in `nuxt.config.ts` to support ESM-style loading of compiled Rust packages.

## Core Concepts

### 1. Engine & State
The `EffectEngine` (in `app/utils/engine`) is the heart of the application. It runs a tick loop that computes DMX values based on fixtures, channel types, and active effects.
- **Fixtures**: Represent physical devices. They have channels (e.g., RED, GREEN, PAN).
- **Effects**: Modifiers (like `SineEffect`) that dynamically alter channel values over time.
- **Pinia Stores**: Bridge the Vue reactivity system with the engine (`useEngineStore`).

### 2. Presets
Presets are snapshots of programmed channel values and active modifiers for a set of fixtures.
- Stored as a list of `Preset` objects.
- Grouped into `PresetCategory` (color, movement, etc.) for UI display.
- **Preset Variants**: A variant is a preset that depends on a `basePresetId`. It only stores the *differences* (overrides) from the base preset. When applied, the system dynamically merges the base preset's state with the variant's overrides. This ensures that updates to the base preset automatically propagate to its variants.

### 3. Groups (SceneNodes)
Fixtures can be organized into hierarchical groups. This helps with selection and applying effects to multiple fixtures at once.

### 4. Custom Fixtures
The Custom Fixture Editor (`CustomFixtureEditorDialog.vue`) allows creating fixtures without an OFL definition.
- **Fixture Category**: Based directly on the official OFL category schema (`custom-fixture-types.ts`). Category determines both the canvas render mode and which settings are shown (e.g., pixel density for `Pixel Bar` and `Matrix`).
- **Canvas render modes** mirror `render.rs`:
  - `single` → circle with inner beam (Color Changer, Moving Head, Dimmer, etc.)
  - `bar` → horizontal pixel row (Pixel Bar)
  - `matrix` → N×M grid of circles (Matrix)
  - `custom_svg` → user-uploaded SVG with interactive head selection
- Layout: `CustomFixtureCanvas` (flex-1, left) + `CustomFixtureSidebar` (fixed w-72, right).
- Shared types: `app/utils/engine/custom-fixture-types.ts`.

### 5. AI Backend Service
The `aiBackendService` is an Express + LangGraph based backend designed to automate data extraction (e.g., Fixture Manuals).
- **LangGraph Workflow**: Uses a state machine (`ExtractionState`) to process PDF texts sequentially.
- **Node Pattern**: Each extraction step (e.g., General Info, Channels, Modes) is isolated into its own LangGraph node (`extractGeneralInfo.ts`, `extractChannels.ts`, `extractModes.ts`).
- **Tool Calling**: When parsing complex nested arrays (like DMX Channels and Modes), the LLM uses structured Tool Calling bound to Zod schemas (e.g., `OflChannelSchema`). This splits the context payload and ensures strictly typed outputs.
- **SSE Streaming**: The backend streams Server-Sent Events (SSE) back to the frontend (`CustomFixtureEditorDialog.vue`), updating the UI with real-time status messages before returning the final assembled `OflFixture`.

## Software Patterns & Guidelines
- **Modularity**: Large files (>200 lines) should be split into smaller, focused modules.
- **Pure Functions for Engine Logic**: Functions like diffing presets or merging variants should be pure functions that take inputs and return new objects. This makes them easily testable and avoids side-effects.
- **Composables**: Vue UI logic should be encapsulated in composables (`use-presets.ts`, `use-global-context-menu.ts`, etc.) to keep components clean. Use composables for global UI states like Context Menus or Modals.
- **v-model components**: Use the `defineModel()` macro (Vue 3.4+) for implementing components with `v-model`. This simplifies prop and emit declarations and allows direct assignment.
- **Context Menus**: Use the global programmatic approach (`useGlobalContextMenu`) to trigger menus on demand. Avoid local wrapper components like `<ContextMenuTrigger>`.
  - Trigger: `@contextmenu.prevent="openMenu($event, options)"`
  - Root Component: `GlobalContextMenu.vue` (placed in `app.vue`)
  - State: `app/composables/useGlobalContextMenu.ts`
  - Pattern: Define menu options including labels, icons, and callback actions direktly at the trigger source for maximum flexibility.
- **Universe Inspector**: A specialized UI for direct DMX control.
  - **View Switching Pattern**: Users can toggle between a visual `AddressGrid` and a structured `PatchTable`. The Grid uses `v-show` to preserve scroll state, while the Table uses `v-if`.
  - **Banner Pattern**: Fixtures are grouped horizontally with a continuous banner showing the fixture name above their assigned channels.
  - **Fader Component**: `DmxChannelFader.vue` provides a vertical slider, a preview box with function-icons (reacting to value/color), and a popover for selecting OFL capabilities.
  - **Data Flow**: Direct overrides are stored in `engineStore.overrideMap`. Interaction involves drag (set), double-click (clear), and numeric input (fine-tune).
  - **High-Resolution DMX (16/24-bit)**:
    - Fine channels are synthesized as independent `GENERIC` channels during parsing.
    - The UI represents them as separate faders for precise manual control.
    - The Rust engine calculates effects on the coarse channel using a float-based `render_buffer` and packs the resulting high-precision value into the respective byte slots.
  - **Patching & Boundaries**:
    - Fixtures are strictly prevented from crossing the 512-channel universe boundary.
    - Drag-and-drop in the `AddressGrid` enforces these boundaries with a live address label and conflict highlighting.
- **Documentation**: Write JSDoc comments for all major interfaces, classes, and exported functions.

## Adding New Features
1. **Plan first**: Review this document and established patterns.
2. **Implement**: Keep UI and Engine logic separated. Use Pinia to bridge them.
3. **Document**: Update this `architecture.md` file if adding new high-level concepts.

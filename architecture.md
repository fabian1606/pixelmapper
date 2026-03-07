# Pixelmapper Architecture

## Core Tech Stack
- **Framework:** Nuxt 4 + Vue 3
- **UI Components:** Shadcn-vue, Tailwind CSS
- **Runtime:** Bun
- **Language:** TypeScript (Strict Mode)

---

## Architecture Domains

To keep the documentation clean and maintainable, the system architecture has been split into independent domain files. Please read through these documents for a deep dive into the system:

### 1. [Core Concepts](./architecture/core-concepts.md)
Contains the foundational structural data models:
- **`FixtureGroup`**, **`Fixture`**, **`Channel`**, **`Beam`**
- Details on `markRaw` wrappers and physical representations.

### 2. [EffectEngine & Rendering](./architecture/engine.md)
Details the pure mathematical core of the application:
- Why we use a `Uint8Array` (`dmxBuffer`) for blazing-fast memory access instead of Vue Reactivity.
- The 60fps render loop steps.
- How `BaseOscillatorEffect` and spatial fanning calculations operate.

### 3. [Global State & Presets](./architecture/state.md)
Explains how the stateless engine bridges to the UI:
- Pinia (`engine-store.ts`) usage for saved data.
- Why Presets store explicit Fixture References (`fixtureIds`) for selective application and modular diffing.

### 4. [Vue UI, Editor & History](./architecture/ui-history.md)
Details the decoupled front-end architecture:
- 2D `FixtureEditor` canvas and coordinate normalization.
- Context Menu system rules.
- Command-pattern Undo/Redo (`useHistory()`) for Property edits and Deletions.

### 5. [Fixture Library (OFL)](./ofl.md)
Explains how Pixelmapper maps and integrates the vast Open Fixture Library (OFL) to automatically construct complex real-world light objects and configurations.

---

## Directory Layout
```
app/utils/engine/
├── types.ts                    # Core types: ChannelType, EffectDirection, Effect interface
├── engine.ts                   # EffectEngine controller (Uint8Array DMX buffer)
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
│   └── (Contains Undo/Redo Command implementations like Move, Group, SetChannels)
└── FixtureEditor.vue           # 2D drag-and-drop fixture positioning UI
```

---

## Coding Guidelines
- **Modules**: ESM focus.
- **Types**: Shared types in `types/` or co-located for specific features. Prefer interfaces for objects, types for unions. Avoid `any`.
- **Functions**: Keep under 50 lines. Prefer pure functions. Extract reusable logic. Avoid deep nesting (>3 levels).
- **Naming**: `kebab-case` for files, `camelCase` for vars/funcs, `PascalCase` for types/classes, `UPPER_SNAKE_CASE` for constants.
- **Documentation**: All new major features should update these architecture files.

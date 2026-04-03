# AGENTS.md - Pixelmapper

## Overview

Pixelmapper is a multi-runtime DMX lighting controller with three sub-projects:
- **Main Frontend**: Nuxt 4 / Vue 3 / TypeScript (package manager: **Bun**)
- **Rust Engine**: WASM packages + ESP32 C FFI (`rs-engine/`)
- **AI Backend Service**: Express 5 / Bun / TypeScript (`aiBackendService/`)
- **ESP32 Firmware**: PlatformIO / C++ (`pio/`)

## Commands

### Main Frontend
```bash
bun install              # Install deps (runs postinstall: nuxt prepare + setup-ofl.sh)
bun run dev              # Full dev: Nuxt + concurrent WASM rebuilds
bun run dev:nuxt         # Nuxt dev only (no WASM watch)
bun run build            # Production build
bun run generate         # Static site generation
bun run preview          # Preview production build
bun run release          # Bump version, create git tag, push (triggers CI firmware build)
```

### Rust Engine
```bash
# Build WASM packages
wasm-pack build --target web --out-dir ../../node_modules/rs-engine-core   # from rs-engine/core
wasm-pack build --target web --out-dir ../../node_modules/rs-engine-canvas # from rs-engine/canvas

# Build FFI static library (for ESP32)
cargo build --release -p rs-engine-ffi  # from rs-engine/
```

### ESP32 Firmware
```bash
pio run              # Build firmware (from pio/ directory)
pio run --target upload  # Build and upload
```

### AI Backend Service
```bash
bun run dev          # from aiBackendService/
```

### Testing
No test framework is currently configured. Natural choices would be **Vitest** for TypeScript/Vue and `cargo test` for Rust.

## Code Style

### General
- Always use **TypeScript** instead of JavaScript
- Always use **Bun** instead of Node whenever possible
- Write comments for all code you write
- Document new features in `architecture.md` and update it after integrating features
- Think about established software patterns before implementing
- Files with <200 lines should be split into multiple subfiles

### TypeScript / Vue
- **Imports**: double quotes, group by origin (framework → stores → local → UI → icons)
- **Type imports**: use `import type { ... }` for type-only imports
- **Path aliases**: `~/` for app root, `@/` for components/lib
- **Formatting**: 2-space indentation, semicolons, trailing commas
- **Quotes**: single quotes for strings in Vue/TS files; double quotes in aiBackendService
- **Naming**:
  - Files: kebab-case (`fixture-workspace.vue`, `use-history.ts`)
  - Components: PascalCase (`FixtureWorkspace`)
  - Composables: `useXxx` pattern (`useHistory`, `usePresets`)
  - Pinia stores: `useXxxStore` pattern
  - Variables/functions: camelCase
  - Types/interfaces: PascalCase
  - Constants: UPPER_SNAKE_CASE
  - Commands: `XxxCommand` pattern implementing `Command` interface
- **Vue**: `<script setup lang="ts">` exclusively (Composition API)
- **Reactivity**: use `storeToRefs()` for Pinia store access, `shallowRef` for large objects, `markRaw` for non-reactive class instances
- **Error handling**: try/catch with `console.error`/`console.warn`, guard clauses with early returns

### Rust
- **Edition**: 2024 (core, canvas), 2021 (ffi)
- **Formatting**: 4-space indentation
- **Naming**: `snake_case` for variables/functions/modules, `PascalCase` for structs/enums/traits, `SCREAMING_SNAKE_CASE` for constants
- **Serde**: use `#[serde(rename = "camelCase")]` for JSON-compatible field names
- **Structs/enums**: derive `Debug, Clone, Serialize, Deserialize`
- **Error handling**: `Option<T>` with pattern matching, early returns with `None`/`-1`
- **FFI**: `#[no_mangle] pub extern "C"`, null checks before unsafe pointer operations
- **Comments**: section headers using `// ── Section ────────────────────────────` pattern

### C++ (ESP32)
- `#define` for constants, `static` for module-level globals
- `Serial.printf` for logging with `[tag]` prefix
- State machine pattern with `enum RxState`

## Key Architectural Patterns

1. **Command Pattern**: All mutable operations go through `Command` interface with `execute()`/`undo()` for history
2. **Composable Pattern**: Vue logic extracted into `useXxx.ts` composables
3. **Pinia Store Pattern**: `defineStore('name', () => {...})` with `storeToRefs()` for reactive access
4. **Binary Protocol**: Framed binary packets `[0xAA, 0x55, type, len_lo, len_hi, ...payload]` for ESP32 communication
5. **WASM Integration**: `rs-engine-core` and `rs-engine-canvas` compiled via `wasm-pack`, imported as local npm packages
6. **Revision-based Caching**: Layout/channels/effects packets cached and only re-dispatched when revision counters change

## Relevant Files

- `architecture.md` — Main architecture overview
- `arcitecture.md` — Software patterns and guidelines
- `architecture/` — Detailed sub-documents (binary-protocol, connectors, core-concepts, engine, state, ui-history)
- `aiBackendService/CLAUDE.md` — AI backend instructions
- `nuxt.config.ts` — Nuxt configuration
- `components.json` — shadcn-vue configuration (New York style)
- `rs-engine/Cargo.toml` — Rust workspace definition

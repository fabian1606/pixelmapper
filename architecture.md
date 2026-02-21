# Pixelmapper Architecture

## Core Tech Stack
- **Framework:** Nuxt 4 + Vue 3
- **UI Components:** Shadcn-vue, Tailwind CSS
- **Runtime:** Bun
- **Language:** TypeScript (Strict Mode)

## Effect Engine Structure
The Effect Engine is responsible for rendering value states (0-255) for pixelmapping channels. Initially written in TypeScript, it is structured cleanly to allow a potential migration to Rust (WASM) later.

### Architecture Features
1. **Object-Oriented Design**: Effects are classes implementing a common `Effect` interface.
2. **Determinism**: Effects rely strictly on `time` and `offset` (fixture index), avoiding random variables to ensure repeatable frames.
3. **Layering**: The engine supports multiple active effects running concurrently.

### Directory Layout
- **`app/utils/engine/types.ts`**: Core type definitions for the engine.
- **`app/utils/engine/effects/`**: Discrete effect implementations.
- **`app/utils/engine/engine.ts`**: The main controller that loops through fixtures and aggregates effect outputs.

## Coding Guidelines
- **Modules**: ESM focus.
- **Types**: Shared types in `types/` or co-located for specific features. Prefer interfaces for objects, types for unions. Avoid `any`.
- **Functions**: Keep under 50 lines. Prefer pure functions. Extract reusable logic. Avoid deep nesting (>3 levels).
- **Naming**: `kebab-case` for files, `camelCase` for vars/funcs, `PascalCase` for types/classes, `UPPER_SNAKE_CASE` for constants.
- **Documentation**: All new major features should be added to this file.

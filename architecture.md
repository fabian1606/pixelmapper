# Pixelmapper Architecture

## Overview

Pixelmapper is a DMX lighting controller with a Vue 3/TypeScript frontend and a Rust engine that runs on two target platforms:

1. **Browser** — Rust compiled to WebAssembly (WASM), runs directly in the browser tab
2. **ESP32-P4** — Rust compiled to a static C library (`no_std`), runs natively on the microcontroller

The key design principle: **both targets use the exact same Rust engine and the same binary protocol.** The browser tab and the ESP32 receive identical byte sequences and produce identical DMX output.

## File Structure

```
pixelmapper/
├── aiBackendService/              # Express backend with LangGraph for AI tasks
│   ├── src/
│   │   ├── nodes/                 # LangGraph nodes (e.g., extractGeneralInfo)
│   │   ├── graph.ts               # LangGraph StateGraph pipeline
│   │   ├── server.ts              # Express API
│   │   └── state.ts               # Graph state schema
│   ├── index.ts                   # Entry point for backend
├── app/                           # Nuxt 4 / Vue 3 frontend
│   ├── stores/
│   │   ├── engine-store.ts        # Render loop, packet cache, revision tracking
│   │   └── connections-store.ts   # Connector registry
│   └── utils/
│       ├── engine/
│       │   └── engine.ts          # Thin WASM wrapper (EffectEngine)
│       └── connectors/
│           ├── binary-encoder.ts  # Single source of truth for all packet encoding
│           ├── base-connector.ts  # Abstract connector base class
│           └── serial-connector.ts # USB Serial → ESP32
├── rs-engine/
│   ├── core/                      # Platform-agnostic Rust engine
│   │   ├── src/
│   │   │   ├── engine.rs          # EffectEngine, render loop, DMX buffer
│   │   │   ├── bin_protocol.rs    # Binary packet parsers (layout, channels, effects)
│   │   │   ├── effects.rs         # Effect implementations (Sine, etc.)
│   │   │   ├── types.rs           # Shared data types
│   │   │   └── wasm_bindings.rs   # wasm-bindgen bindings for the browser
│   │   └── pkg/                   # Compiled WASM package (generated, do not edit)
│   └── ffi/                       # C FFI layer for ESP32
│       ├── src/lib.rs             # extern "C" functions, delegates to core
│       └── include/engine_ffi.h   # C header for PlatformIO
└── pio/
    └── src/main.cpp               # ESP32 Arduino sketch
```

Detailed documentation per subsystem:

- [Engine & Render Loop](architecture/engine.md)
- [Binary Protocol](architecture/binary-protocol.md)
- [Core Concepts: Fixtures, Channels, Beams](architecture/core-concepts.md)
- [State Management & Reactivity](architecture/state.md)
- [Connectors & Hardware](architecture/connectors.md)
- [UI & History](architecture/ui-history.md)

## Custom Fixtures (SVG Based)

To support custom, highly visual, or non-standard fixtures, the architecture provides a Custom Fixture Editor.
- **Concept:** Users define a fixture visually by importing an SVG graphic.
- **Mapping:** SVG elements and their attributes (like colors, opacities) will be mapped to DMX channels, allowing a rich visual representation of complex lights directly linked to the engine's DMX values.
- **Integration:** The `CustomFixtureEditorDialog` provides a workspace where SVGs can be imported visually, parsed, and configured to generate standard `Fixture` objects (augmented with SVG definition data) before being injected into the main `FixtureWorkspace`.

## AI Backend Service (aiBackendService)

To aid in the creation of fixtures, an Express-based AI backend service powered by LangGraph uses LLMs to parse fixture manuals and automatically extract physical dimensions, features, and DMX mappings.
- **Concept:** Provide a manual text (later OCR'd PDF) to an endpoint `/extract-fixture`.
- **Pipeline:** A LangGraph pipeline directs the text through specific extraction nodes (currently just General Info), utilizing `withStructuredOutput` to enforce correct schemas.
- **Goal:** Feed the extracted data straight into the Custom Fixture Editor to dramatically speed up fixture authoring.

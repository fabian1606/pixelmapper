# Pixelmapper Architecture

## Overview

Pixelmapper is a DMX lighting controller with a Vue 3/TypeScript frontend and a Rust engine that runs on two target platforms:

1. **Browser** — Rust compiled to WebAssembly (WASM), runs directly in the browser tab
2. **ESP32-P4** — Rust compiled to a static C library (`no_std`), runs natively on the microcontroller

The key design principle: **both targets use the exact same Rust engine and the same binary protocol.** The browser tab and the ESP32 receive identical byte sequences and produce identical DMX output.

## File Structure

```
pixelmapper/
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

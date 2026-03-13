# Pixelmapper Architecture

## Übersicht
Das Pixelmapper Projekt kombiniert ein modernes UI gebaut in Vue 3 (Typescript) mit einer High-Performance Rendering & Effekt-Engine geschrieben in Rust (mittels WebAssembly). 

## Prinzipien
- **UI ist JS/TS**: Alles, was DOM-Updates, state management (Pinia/Vue), und pure Web-Interfaces angeht, passiert in Vue/JS.
- **Schwere Berechnungen & Rendering in Rust**: Die gesamte Logik, die in Echtzeit iteriert (z.B. 60fps), wird in Rust ausgelagert, um von Wasm-Geschwindigkeit und Speicher-Sicherheit zu profitieren.

---

## Kern-Architektur

Um die Engine sowohl im Browser (Wasm) als auch nativ (C++) nutzen zu können, wird sie strikt in zwei Layer getrennt:

### 1. Core Engine (`rs-engine-core`)
Das Herzstück der Licht-Berechnung. Es ist **platform-agnostisch**, nutzt keine Web-APIs und kann via C-Bindings/FFI nach C++ kompiliert sowie als reine WebAssembly-Bibliothek genutzt werden.
- **EffectEngine (`engine.rs`)**: Kalkuliert bei jedem Frame den finalen DMX-Buffer (512 Channel / Universum). Sie iteriert über Targets (Scheinwerfer), Chasers und Effekte (Waves, etc.).
- **Memory Access**: Bietet schnellen, direkten Zugriff auf den DMX Buffer an (`extern "C"` für C++, oder `js_sys::Uint8Array::view` Wrappers in Wasm).

### 2. Canvas Rendering Engine (`rs-engine-canvas`)
Das 2D Rendering der Scheinwerfer und der Arbeitsfläche für den Pixelmapper/Browser. Dies baut auf der Core Engine auf, wird aber *nur* für WebAssembly kompiliert.
- **Wasm Bindings**: Hier befindet sich das Brücken-Interface zu JavaScript.
- **femtovg**: Dient als Hardware-beschleunigter 2D Renderer (OpenGL/WebGL2). Das Frontend übergibt lediglich den WebGL-Context.
- **Räumliche Indexierung (`rstar`)**: Damit Mouse-Events (Hover/Marquee-Select) direkt in Wasm berechnet werden, anstatt Daten an JS zu senden.
- **Exaktes Hit-Testing (`usvg`)**: Vektor-basierte Hit-Polygon-Tests (PiP) um auch komplexe Fixture-Silhouetten zu erkennen.

## Skalierbarkeits-Pattern
- **Data Synchronization**: Das Statusmodell (Beams, Targets, Effects) ist in JS der "Master". Bei Änderungen wird der entsprechende Wasm-Status per Payload synchronisiert (`sync_targets()`, `sync_effects()`).
- **Separation of Concerns**: Die Wasm-Engine darf das DOM nicht kennen. Jegliche Interaktion geht über definierte Bindings (`wasm_bindings.rs`).
- **Verwendung moderner Standards**: Vite/Bun im Frontend für schnelles HMR, Rust Edition 2024 für moderne Sprachfeatures. 

*Letztes Update: Canvas Wasm Migration Plan*

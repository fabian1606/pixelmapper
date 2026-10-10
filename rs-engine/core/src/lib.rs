// ── rs-engine-core ───────────────────────────────
//
// Platform-agnostic DMX engine: layout, chasers, signature mapping, phase,
// beat clock, blending. Modifiers run behind `runtime::ModifierRuntime`.

pub mod types;
pub mod engine;
pub mod bin_protocol;
pub mod signatures;
pub mod phase;
pub mod distribution;
pub mod beat_clock;
pub mod runtime;

// Browser bindings (WasmEngine + JS plugin runtime).
#[cfg(target_arch = "wasm32")]
pub mod runtime_js;
#[cfg(target_arch = "wasm32")]
pub mod wasm_bindings;

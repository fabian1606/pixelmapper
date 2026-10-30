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
pub mod room;

// ── Host ABI ─────────────────────────────────────

/// Version of the interface between the host (app/utils/engine) and this
/// engine: the `WasmEngine` JS API and the packet formats the host sends.
/// The worker compares it with `ENGINE_ABI_VERSION` in
/// `app/utils/engine/engine-abi.ts` and refuses to run a mismatched build
/// (stale or foreign `pkg/`). Bump both on every incompatible change.
pub const ENGINE_ABI_VERSION: u32 = 1;

// Browser bindings (WasmEngine + JS plugin runtime).
#[cfg(target_arch = "wasm32")]
pub mod runtime_js;
#[cfg(target_arch = "wasm32")]
pub mod wasm_bindings;

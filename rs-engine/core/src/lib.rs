pub mod types;
pub mod effects;
pub mod engine;
pub mod bin_protocol;
pub mod signatures;

// Temporary golden generator for the AssemblyScript built-ins (plan P3.3).
#[cfg(test)]
mod legacy_goldens;

// We export the WasmEngine if compiled for the wasm32 target
#[cfg(target_arch = "wasm32")]
pub mod wasm_bindings;

// ── Modifier runtime ─────────────────────────────
//
// The core orchestrates rendering; modifiers run behind this trait (ADR D6,
// §6.8). Browser: `JsModifierRuntime` (runtime_js.rs) calls the worker's
// plugin bridge. Tauri (later): wasmtime with fuel. Tests: closures.

/// f32 slots of a frame context (ABI v1; v1.1 fills reserved slots 8–10, v1.2 slots 11–15).
pub const CTX_FIELDS: usize = 16;
/// f32 slots of a sample (ABI v1; v1.1 fills reserved slots 13–15).
pub const SAMPLE_FIELDS: usize = 16;

/// Frame-context field indices (ABI v1, amendment A13; v1.1, amendment A20).
pub mod ctx {
    pub const TIME_MS: usize = 0;
    pub const BEAT_TIME: usize = 1;
    pub const BPM: usize = 2;
    pub const PHASE_SPEED: usize = 3;
    pub const ARITY: usize = 4;
    pub const SEED_LO: usize = 5;
    pub const SEED_HI: usize = 6;
    pub const STRENGTH: usize = 7;
    /// v1.1: speed phase in cycles (unwrapped).
    pub const TIME_PHASE: usize = 8;
    /// v1.1: ranks of the instance (0 when the mode has none).
    pub const RANK_COUNT: usize = 9;
    /// v1.1: distribution groups (0 = no grouping).
    pub const DIST_GROUP_COUNT: usize = 10;
    /// v1.2: the spread (0 all the same, 1 spatial 2D, 2 fixture by fixture, 3 within each fixture).
    pub const SPREAD: usize = 11;
    /// v1.2: the Spatial 2D handle in normalized world coordinates (origin, end).
    pub const HANDLE_ORIGIN_X: usize = 12;
    pub const HANDLE_ORIGIN_Y: usize = 13;
    pub const HANDLE_END_X: usize = 14;
    pub const HANDLE_END_Y: usize = 15;
}

/// Sample field indices (ABI v1, amendment A13; v1.1, amendment A20).
pub mod sample {
    pub const X: usize = 0;
    pub const Y: usize = 1;
    pub const PHASE: usize = 2;
    pub const GROUP_INDEX: usize = 3;
    pub const GROUP_COUNT: usize = 4;
    pub const HEAD_INDEX: usize = 5;
    pub const HEAD_COUNT: usize = 6;
    pub const SEED: usize = 7;
    pub const BASE0: usize = 8;
    pub const CHANNEL_SEED_LO: usize = 11;
    pub const CHANNEL_SEED_HI: usize = 12;
    /// v1.1: position along the distribution (0 at origin / first rank).
    pub const SPATIAL: usize = 13;
    /// v1.1: rank of the sample (−1 if none).
    pub const RANK: usize = 14;
    /// v1.1: distribution group of the sample (−1 if none).
    pub const DIST_GROUP: usize = 15;
}

/// Per-render-call context (one instance, one frame).
#[derive(Debug, Clone, Copy, Default, PartialEq)]
#[repr(C)]
pub struct FrameCtx(pub [f32; CTX_FIELDS]);

/// One sample (a channel for scalar, a head for rgb/panTilt).
#[derive(Debug, Clone, Copy, Default, PartialEq)]
#[repr(C)]
pub struct Sample(pub [f32; SAMPLE_FIELDS]);

/// Why a runtime call failed. The engine disables the instance until its
/// plugin or params change.
#[derive(Debug, Clone, PartialEq)]
pub enum RuntimeError {
    /// The plugin is not loaded (yet).
    NotLoaded,
    /// The plugin trapped, aborted or exceeded its budget.
    Trap(String),
}

/// Index into the plugin table of the current modifiers packet.
pub type PluginRef = u32;

/// Executes modifier plugins.
pub trait ModifierRuntime {
    /// (Re)binds `instance` to `plugin` with `params` (on load and param change).
    fn prepare(&mut self, instance: u32, plugin: PluginRef, params: &[f32]) -> Result<(), RuntimeError>;
    /// Renders `samples` into `out` (samples.len() × arity values).
    fn render(&mut self, instance: u32, ctx: &FrameCtx, samples: &[Sample], arity: usize, out: &mut [f32]) -> Result<(), RuntimeError>;
    /// Frees an instance that is no longer used.
    fn release(&mut self, _instance: u32) {}
}

/// Views a context as plain f32s.
pub fn ctx_as_f32(ctx: &FrameCtx) -> &[f32] {
    &ctx.0
}

/// Views samples as one contiguous f32 slice (repr(C) arrays of f32).
pub fn samples_as_f32(samples: &[Sample]) -> &[f32] {
    // SAFETY: `Sample` is `#[repr(C)]` around `[f32; SAMPLE_FIELDS]`, so a
    // slice of samples is a contiguous, aligned sequence of f32.
    unsafe { std::slice::from_raw_parts(samples.as_ptr() as *const f32, samples.len() * SAMPLE_FIELDS) }
}

/// Runtime without plugins: every render fails with `NotLoaded`.
#[derive(Debug, Default)]
pub struct NullRuntime;

impl ModifierRuntime for NullRuntime {
    fn prepare(&mut self, _: u32, _: PluginRef, _: &[f32]) -> Result<(), RuntimeError> {
        Err(RuntimeError::NotLoaded)
    }
    fn render(&mut self, _: u32, _: &FrameCtx, _: &[Sample], _: usize, _: &mut [f32]) -> Result<(), RuntimeError> {
        Err(RuntimeError::NotLoaded)
    }
}

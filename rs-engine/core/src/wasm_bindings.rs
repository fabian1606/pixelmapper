// ── WASM bindings ────────────────────────────────

use wasm_bindgen::prelude::*;
use crate::engine::EffectEngine;
use crate::runtime_js::JsModifierRuntime;

/// Host ABI version of this build (see `crate::ENGINE_ABI_VERSION`).
#[wasm_bindgen]
pub fn engine_abi_version() -> u32 {
    crate::ENGINE_ABI_VERSION
}

/// The engine as used by the browser worker.
#[wasm_bindgen]
pub struct WasmEngine {
    engine: EffectEngine,
}

#[wasm_bindgen]
impl WasmEngine {
    /// Creates an engine whose modifiers run through the worker's plugin bridge.
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        #[cfg(feature = "console_error_panic_hook")]
        console_error_panic_hook::set_once();
        Self { engine: EffectEngine::with_runtime(Box::new(JsModifierRuntime)) }
    }

    /// Records a tempo change at `at_ms` (ms since the clock epoch).
    #[wasm_bindgen]
    pub fn set_bpm_at(&mut self, bpm: f32, at_ms: f32) {
        self.engine.set_bpm_at(bpm, at_ms);
    }

    /// Restarts the beat clock (new clock epoch).
    #[wasm_bindgen]
    pub fn reset_clock(&mut self, bpm: f32) {
        self.engine.reset_clock(bpm);
    }

    /// Nudges the beat grid onto a tap at `tap_ms` (ms since the epoch),
    /// starting at `now_ms` — tap tempo without a phase jump.
    #[wasm_bindgen]
    pub fn align_beat(&mut self, tap_ms: f32, now_ms: f32) {
        self.engine.align_beat(tap_ms, now_ms);
    }

    /// Effective beats (base beat × speed) at `time_ms` (ms since the epoch).
    #[wasm_bindgen]
    pub fn beat_time(&self, time_ms: f32) -> f32 {
        self.engine.beat_time(time_ms)
    }

    /// Base beats (the music) at `time_ms`.
    #[wasm_bindgen]
    pub fn base_beat_time(&self, time_ms: f32) -> f32 {
        self.engine.base_beat_time(time_ms)
    }

    /// Speed time (ms scaled by the multiplier) at `time_ms`.
    #[wasm_bindgen]
    pub fn speed_time(&self, time_ms: f32) -> f32 {
        self.engine.speed_time(time_ms)
    }

    /// Requests a global speed multiplier; it switches on the next common beat.
    #[wasm_bindgen]
    pub fn request_speed(&mut self, speed: f32, now_ms: f32) {
        self.engine.request_speed(speed, now_ms);
    }

    /// Active speed multiplier.
    #[wasm_bindgen]
    pub fn speed(&self) -> f32 {
        self.engine.speed()
    }

    /// Renders one frame at `time_ms` since the clock epoch.
    #[wasm_bindgen]
    pub fn render(&mut self, time_ms: f32, delta_time_ms: f32) {
        self.engine.render(time_ms, delta_time_ms);
    }

    /// Dispatches a binary packet payload (0x14 layout, 0x15 channels,
    /// 0x16 modifiers). Returns the item count, or -1 on error.
    #[wasm_bindgen]
    pub fn dispatch(&mut self, packet_type: u8, data: &[u8]) -> i32 {
        self.engine.dispatch_bin(packet_type, data)
    }

    /// Re-prepares disabled modifier instances (after plugins were loaded).
    #[wasm_bindgen]
    pub fn retry_disabled(&mut self) {
        self.engine.retry_disabled();
    }

    /// Normalized signature tuples for live values: `requests` are flat
    /// `(group index, signature id)` pairs; returns 3 f32 per request (NaN =
    /// unavailable).
    #[wasm_bindgen]
    pub fn read_signatures(&self, requests: &[u32]) -> Vec<f32> {
        let mut out = Vec::with_capacity(requests.len() / 2 * 3);
        self.engine.read_signatures(requests, &mut out);
        out
    }

    /// Per-head signature tuples (observation): `requests` are flat
    /// `(group index, head index, signature id, channel type id or 255)`
    /// quads; returns 3 f32 per request (NaN = unavailable).
    #[wasm_bindgen]
    pub fn read_head_signatures(&self, requests: &[u32]) -> Vec<f32> {
        let mut out = Vec::with_capacity(requests.len() / 4 * 3);
        self.engine.read_head_signatures(requests, &mut out);
        out
    }

    /// Zero-copy view of the DMX buffer (re-fetch after any dispatch).
    #[wasm_bindgen]
    pub fn get_dmx_view(&self) -> js_sys::Uint8Array {
        // SAFETY: valid until the buffer is resized by a later dispatch.
        unsafe { js_sys::Uint8Array::view(&self.engine.dmx_buffer) }
    }
}

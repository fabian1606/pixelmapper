// ── WASM bindings ────────────────────────────────

use wasm_bindgen::prelude::*;
use crate::engine::EffectEngine;
use crate::runtime_js::JsModifierRuntime;

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

    /// Zero-copy view of the DMX buffer (re-fetch after any dispatch).
    #[wasm_bindgen]
    pub fn get_dmx_view(&self) -> js_sys::Uint8Array {
        // SAFETY: valid until the buffer is resized by a later dispatch.
        unsafe { js_sys::Uint8Array::view(&self.engine.dmx_buffer) }
    }
}

use wasm_bindgen::prelude::*;
use crate::engine::EffectEngine;
use crate::types::{RenderTarget, EffectConfig};

#[wasm_bindgen]
pub struct WasmEngine {
    engine: EffectEngine,
}

#[wasm_bindgen]
impl WasmEngine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        #[cfg(feature = "console_error_panic_hook")]
        console_error_panic_hook::set_once();

        Self {
            engine: EffectEngine::new(),
        }
    }

    #[wasm_bindgen]
    pub fn set_bpm(&mut self, bpm: f32) {
        self.engine.set_bpm(bpm);
    }

    #[wasm_bindgen]
    pub fn sync_targets(&mut self, serialized_targets: &str) -> Result<(), JsValue> {
        let targets: Vec<RenderTarget> = serde_json::from_str(serialized_targets)
            .map_err(|e| JsValue::from_str(&format!("Failed to parse targets: {}", e)))?;
        
        self.engine.sync_targets(targets);
        Ok(())
    }

    #[wasm_bindgen]
    pub fn sync_effects(&mut self, serialized_effects: &str) -> Result<(), JsValue> {
        let effects: Vec<EffectConfig> = serde_json::from_str(serialized_effects)
            .map_err(|e| JsValue::from_str(&format!("Failed to parse effects: {}", e)))?;
        
        self.engine.sync_effects(effects);
        Ok(())
    }

    #[wasm_bindgen]
    pub fn render(&mut self, time_ms: f32, delta_time_ms: f32) {
        self.engine.render(time_ms, delta_time_ms);
    }

    /// Dispatch a binary packet directly to the engine.
    /// packet_type: 0x10=BPM(f32LE), 0x14=layout, 0x15=channels, 0x16=effects
    /// Returns count of parsed items, or -1 on error.
    #[wasm_bindgen]
    pub fn dispatch(&mut self, packet_type: u8, data: &[u8]) -> i32 {
        self.engine.dispatch_bin(packet_type, data)
    }

    /// Returns a direct memory view into the DMX buffer without copying.
    /// This is an incredibly fast way for JS to read the Wasm memory.
    #[wasm_bindgen]
    pub fn get_dmx_view(&self) -> js_sys::Uint8Array {
        // Safe as long as the size/location of `dmx_buffer` doesn't change
        // while JS is using the view.
        unsafe { js_sys::Uint8Array::view(&self.engine.dmx_buffer) }
    }
}

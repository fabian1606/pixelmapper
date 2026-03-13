use rs_engine_core::engine::EffectEngine;
use rs_engine_core::types::{EffectConfig, RenderTarget};
use std::ffi::CStr;
use std::os::raw::c_char;

#[no_mangle]
pub extern "C" fn engine_new() -> *mut EffectEngine {
    Box::into_raw(Box::new(EffectEngine::new()))
}

#[no_mangle]
pub unsafe extern "C" fn engine_free(ptr: *mut EffectEngine) {
    if !ptr.is_null() {
        drop(Box::from_raw(ptr));
    }
}

#[no_mangle]
pub unsafe extern "C" fn engine_set_bpm(ptr: *mut EffectEngine, bpm: f32) {
    (*ptr).set_bpm(bpm);
}

#[no_mangle]
pub unsafe extern "C" fn engine_render(ptr: *mut EffectEngine, time_ms: f32, delta_ms: f32) {
    (*ptr).render(time_ms, delta_ms);
}

/// Returns a pointer to the 512-byte DMX buffer. Valid until the next engine call.
#[no_mangle]
pub unsafe extern "C" fn engine_get_dmx_buffer(ptr: *const EffectEngine) -> *const u8 {
    (*ptr).dmx_buffer.as_ptr()
}

/// Sync targets from a null-terminated JSON string: Vec<RenderTarget>
#[no_mangle]
pub unsafe extern "C" fn engine_sync_targets_json(ptr: *mut EffectEngine, json: *const c_char) {
    if ptr.is_null() || json.is_null() {
        return;
    }
    if let Ok(s) = CStr::from_ptr(json).to_str() {
        if let Ok(targets) = serde_json::from_str::<Vec<RenderTarget>>(s) {
            (*ptr).sync_targets(targets);
        }
    }
}

/// Sync effects from a null-terminated JSON string: Vec<EffectConfig>
#[no_mangle]
pub unsafe extern "C" fn engine_sync_effects_json(ptr: *mut EffectEngine, json: *const c_char) {
    if ptr.is_null() || json.is_null() {
        return;
    }
    if let Ok(s) = CStr::from_ptr(json).to_str() {
        if let Ok(configs) = serde_json::from_str::<Vec<EffectConfig>>(s) {
            (*ptr).sync_effects(configs);
        }
    }
}

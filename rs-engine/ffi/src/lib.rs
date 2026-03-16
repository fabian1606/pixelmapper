use rs_engine_core::engine::EffectEngine;
use rs_engine_core::types::{RenderTarget, EffectConfig};
use std::ffi::CStr;
use std::os::raw::c_char;

// ── Core lifecycle ────────────────────────────────────────────────────────────

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

// ── Unified binary dispatch ───────────────────────────────────────────────────

/// Single entry point for all binary packet types.
/// packet_type: 0x10=BPM, 0x14=layout, 0x15=channels, 0x16=effects
/// Returns count of parsed items, or -1 on error.
#[no_mangle]
pub unsafe extern "C" fn engine_dispatch(
    ptr: *mut EffectEngine,
    packet_type: u8,
    data: *const u8,
    len: u32,
) -> i32 {
    if ptr.is_null() || data.is_null() { return -1; }
    let slice = core::slice::from_raw_parts(data, len as usize);
    (*ptr).dispatch_bin(packet_type, slice)
}

// ── Legacy JSON FFI (kept for reference, not used by main.cpp) ────────────────

/// Sync targets from a null-terminated JSON string: Vec<RenderTarget>
#[no_mangle]
pub unsafe extern "C" fn engine_sync_targets_json(ptr: *mut EffectEngine, json: *const c_char) -> i32 {
    if ptr.is_null() || json.is_null() { return -1; }
    match CStr::from_ptr(json).to_str() {
        Ok(s) => match serde_json::from_str::<Vec<RenderTarget>>(s) {
            Ok(targets) => { let n = targets.len() as i32; (*ptr).sync_targets(targets); n }
            Err(_) => -2,
        },
        Err(_) => -3,
    }
}

/// Sync effects from a null-terminated JSON string: Vec<EffectConfig>
#[no_mangle]
pub unsafe extern "C" fn engine_sync_effects_json(ptr: *mut EffectEngine, json: *const c_char) -> i32 {
    if ptr.is_null() || json.is_null() { return -1; }
    match CStr::from_ptr(json).to_str() {
        Ok(s) => match serde_json::from_str::<Vec<EffectConfig>>(s) {
            Ok(configs) => { let n = configs.len() as i32; (*ptr).sync_effects(configs); n }
            Err(_) => -2,
        },
        Err(_) => -3,
    }
}

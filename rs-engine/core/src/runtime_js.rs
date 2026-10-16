// ── JS modifier runtime (browser) ────────────────
//
// Calls the plugin bridge of the engine worker
// (`app/utils/plugins/worker-bridge.ts`) through a tiny JS snippet that
// forwards to `globalThis.__pmPluginBridge`. Slices are passed as views into
// this module's memory; the bridge copies them into the plugin's memory.

use wasm_bindgen::prelude::*;
use crate::runtime::{ctx_as_f32, samples_as_f32, FrameCtx, ModifierRuntime, PluginRef, RuntimeError, Sample};

#[wasm_bindgen(module = "/js/plugin-bridge.js")]
extern "C" {
    fn pm_bridge_prepare(instance: u32, plugin: u32, params: &[f32]) -> bool;
    fn pm_bridge_render(instance: u32, ctx: &[f32], samples: &[f32], count: u32, out: &mut [f32]) -> bool;
    fn pm_bridge_release(instance: u32);
}

/// Browser runtime backed by the worker's plugin bridge.
#[derive(Debug, Default)]
pub struct JsModifierRuntime;

impl ModifierRuntime for JsModifierRuntime {
    fn prepare(&mut self, instance: u32, plugin: PluginRef, params: &[f32]) -> Result<(), RuntimeError> {
        if pm_bridge_prepare(instance, plugin, params) { Ok(()) } else { Err(RuntimeError::Trap("prepare failed".into())) }
    }

    fn render(&mut self, instance: u32, ctx: &FrameCtx, samples: &[Sample], _arity: usize, out: &mut [f32]) -> Result<(), RuntimeError> {
        if pm_bridge_render(instance, ctx_as_f32(ctx), samples_as_f32(samples), samples.len() as u32, out) {
            Ok(())
        } else {
            Err(RuntimeError::Trap("render failed".into()))
        }
    }

    fn release(&mut self, instance: u32) {
        pm_bridge_release(instance);
    }
}

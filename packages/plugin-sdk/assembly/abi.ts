/**
 * ABI exports (v1.3) (ADR §6.6). The toolchain's synthetic entry re-exports
 * these from the package root (one module identity with the plugin's import),
 * so plugin authors never write these functions.
 */
import { Frame, Out, SAMPLE_FIELDS, Sample, registered } from "./core";

/** Reused views (no allocation per sample). */
const FRAME = new Frame();
const SAMPLE = new Sample();
const OUT = new Out();

/**
 * ABI version implemented by this SDK: major × 100 + minor (103 = 1.3). The
 * host only loads modules with exactly its version (buffer strides changed
 * in 1.3, so older binaries must be rebuilt).
 */
export function pm_abi_version(): i32 {
  return 103;
}

/** Allocates `bytes` of unmanaged memory for host buffers. */
export function pm_alloc(bytes: i32): usize {
  return heap.alloc(<usize>bytes);
}

/**
 * Hands the params block to the modifier. The host keeps the buffer alive,
 * so `Modifier.params` stays valid for `render`.
 */
export function pm_prepare(params: usize, paramCount: i32): void {
  const m = registered();
  m.params.ptr = params;
  m.params.count = paramCount;
  m.prepare(m.params);
}

/** Renders `count` samples into `out` (count × arity f32). */
export function pm_render(ctx: usize, samples: usize, count: i32, out: usize): void {
  const m = registered();
  FRAME.ptr = ctx;
  const arity = FRAME.arity;
  const sampleStride = <usize>SAMPLE_FIELDS << 2;
  const outStride = <usize>arity << 2;
  for (let i = 0; i < count; i++) {
    SAMPLE.ptr = samples + <usize>i * sampleStride;
    OUT.ptr = out + <usize>i * outStride;
    m.render(FRAME, SAMPLE, OUT);
  }
}

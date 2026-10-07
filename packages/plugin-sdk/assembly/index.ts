/**
 * @pixelmapper/plugin-sdk — AssemblyScript SDK for content plugins (ADR §6.6).
 *
 * A modifier is a pure function of (frame context, sample, params). Extend
 * `Modifier`, implement `render`, and register one instance at top level:
 *
 * ```ts
 * import { Modifier, Frame, Sample, Out, register, TAU } from "@pixelmapper/plugin-sdk";
 *
 * class Pulse extends Modifier {
 *   render(ctx: Frame, s: Sample, out: Out): void {
 *     out.set(0, Mathf.sin(s.phase * TAU));
 *   }
 * }
 * register(new Pulse());
 * ```
 *
 * The SDK hides the ABI (`pm_abi_version`, `pm_alloc`, `pm_prepare`,
 * `pm_render`), which the toolchain exports from `abi.ts`. Frame, Sample and
 * Out objects are reused views into host buffers: never keep references to
 * them across calls.
 */

export * from "./core";
export * from "./math";
export * from "./curves";
export * from "./color";
export * from "./abi";

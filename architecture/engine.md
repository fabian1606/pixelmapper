# EffectEngine & Rendering

## The Engine (`rs-engine`)
The pure mathematical heart of the application is written in **Rust** and compiled to WebAssembly (Wasm). It runs 60 times a second, oscillating channels based on effects and computing raw DMX bytes. 

The `EffectEngine` in TS is now a thin wrapper that syncs `RenderTarget` (flattened channels) and `EffectConfig` objects to the Rust backend using JSON.

### Why Rust & WebAssembly?
1. **Performance & Memory**: The Rust engine bypassed JS garbage collection entirely. By exposing a direct `Uint8Array` memory view to the JS side, we read the final DMX values seamlessly at 60fps with zero-copy overhead. 
2. **ESP32-P4 Compatibility**: The exact same `rs-engine` crate can be compiled natively using `#[no_std]` (or `alloc`) for the ESP32-P4. The frontend simply sends the exact same JSON configuration over UDP to the ESP32 instead of the local Wasm module.
3. **1:1 Hardware Mapping**: By rendering directly into a `[u8; 512]`, the Engine's memory structure perfectly mirrors the physical hardware output required by Art-Net or sACN nodes.

### Render Loop
`EffectEngine.render(fixtures, timeMs, deltaTimeMs)` runs once per animation frame:

1. **Update phase** — calls `effect.update(deltaTime)` on every effect to accumulate internal state (e.g. phase position).
2. **Compute Base/Chaser Values** — computes interpolated sub-frame channel bases via the `chaserConfig`. These float precision values are written into `baseBuffer`.
3. **Apply effects** — for each fixture, each effect renders a normalized wave shape `[-1, 1]`. The engine maps this shape to a safe DMX range relative to `baseBuffer`, then additively applies offsets directly to the `dmxBuffer`.
4. **Buffer Write Phase** — final floating values inside `dmxBuffer` are clamped strictly to `[0, 255]` and rounded to integers.

This architecture isolates Vue's reactivity limits from high-speed DMX modulation, allowing the system to handle complex light shows smoothly.

---

## Effects: BaseOscillatorEffect

All time-based oscillator effects extend `BaseOscillatorEffect`. Subclasses only need to implement `getShape(phase: number): number`.

### Parameters
| Property | Description |
|---|---|
| `speed` | Rate of phase accumulation (phase/ms). |
| `strength` | Amplitude in DMX units (0–255). |
| `fanning` | Per-fixture phase offset multiplier. |
| `direction` | How phase offset is calculated across fixtures. |
| `targetChannels` | Array of channel types to apply the effect to. |
| `targetFixtureIds` | Optional array of fixture IDs to restrict the effect to. Used heavily by the Modifiers UI. |

### Direction Modes
| Mode | Behavior |
|---|---|
| `FORWARD` | Phase offset increases from fixture 0 → N |
| `BACKWARD` | Phase offset increases from fixture N → 0 |
| `CENTER_OUT` | Phase offset radiates outward from the center index |
| `OUTSIDE_IN` | Phase offset converges inward from both edges |
| `SPATIAL_X` | Phase offset driven by fixture's world X position |
| `SPATIAL_Y` | Phase offset driven by fixture's world Y position |
| `SPATIAL_RADIAL` | Phase offset driven by distance from center (0.5, 0.5) |

### Built-in Effects
- **`SineEffect`** — Smooth sinusoidal wave. `getShape = Math.sin(phase)`.

### Adding New Effects
```ts
// Example: SawEffect
export class SawEffect extends BaseOscillatorEffect {
  getShape(phase: number): number {
    return ((phase / (2 * Math.PI)) % 1) * 2 - 1; // sawtooth -1 to 1
  }
}
```

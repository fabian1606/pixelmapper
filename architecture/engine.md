# EffectEngine & Rendering

## The Engine (`engine.ts`)
The pure mathematical heart of the application. It runs 60 times a second, oscillating channels based on effects and computing raw DMX bytes. It knows *nothing* about Vue components or the UI.

`EffectEngine` provides a global `Uint8Array(512)` named `dmxBuffer` array representing the final output integer values.
It also utilizes an internal `Float32Array(512)` named `baseBuffer` to store intermediate math (like chaser interpolations) precisely before effect modulation.

### Why Typed Arrays (Data-Oriented Design)?
1. **Performance & Memory**: In the first version of Pixelmapper, Vue's deep reactivity system monitored every individual channel's value. When running effects on 40+ fixtures (resulting in hundreds of channel changes per frame at 60fps), Vue's reactivity overhead crippled framerates. Moving `value` and `currentBaseValue` out of objects and into native typed arrays bypasses Vue's proxy watchers entirely, offering blazing-fast C-level memory access.
2. **1:1 Hardware Mapping**: DMX-512 protocol dictates that a single DMX universe is precisely 512 bytes (values 0-255). By rendering directly into a `Uint8Array(512)`, the Engine's memory structure perfectly mirrors the physical hardware output required by Art-Net or sACN nodes.

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

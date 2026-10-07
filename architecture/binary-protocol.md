# Binary Protocol

## Overview

All configuration from the engine-store to the render engine uses one compact binary format. The TypeScript encoder (`app/utils/connectors/binary-encoder.ts`) is the single source of truth; the parsers live in `rs-engine/core/src/bin_protocol.rs`.

> **Plugin-system change (plan P3):** `TYPE_FX_BIN` was replaced by `TYPE_MODIFIERS_BIN` (same id 0x16) and the layout packet moved to v2. The ESP32 firmware still parses the old formats, so on-device rendering is broken until plan P6.2 (the ESP becomes a pure output device per ADR 0001); DMX output streamed from the browser is unaffected.

## Frame Format

Every packet is wrapped in a 5-byte header:

```
[0xAA][0x55][type: u8][len_lo: u8][len_hi: u8][payload × len]
```

- `0xAA 0x55` — magic bytes for synchronization
- `type` — packet type constant
- `len` — payload length as little-endian u16
- `payload` — type-specific binary data

The ESP32 strips the header via a state-machine parser (`processByte` in `main.cpp`), then passes only the raw payload to `engine_dispatch`. The WASM path calls `dispatch_bin` directly with `packet.subarray(5)` to skip the header.

## Packet Types

| Constant | Value | Description |
|----------|-------|-------------|
| `TYPE_BPM` | `0x10` | Global BPM (f32 LE) |
| `TYPE_TIMESYNC` | `0x13` | Clock alignment for ESP32 (f32 LE, elapsed ms) |
| `TYPE_LAYOUT_BIN` | `0x14` | Fixtures, channels, heads (v2) |
| `TYPE_CHAN_BIN` | `0x15` | Chaser configurations per DMX channel |
| `TYPE_MODIFIERS_BIN` | `0x16` | Modifier instances (content plugins) |

Removed: `TYPE_FX_BIN` (0x16, legacy effects). The worker additionally receives plugin modules (`plugin-load`) and, next to each modifiers packet, the plugin table (index → content hash); these are worker messages, not framed packets.

## Send Policy

Packets are sent **only on change**, tracked via revision counters in `engine-store.ts`:

- On first connect: all packets sent immediately
- Subsequent frames: only the packet whose revision changed is sent
- Timesync (ESP32 only): every 120 frames (~2 s at 60 fps)

This makes steady-state bandwidth negligible — typically just 9 bytes every 2 seconds.

## Payload Formats

### TYPE_BPM (0x10)
```
[bpm: f32 LE]
```
Total: 4 bytes payload.

### TYPE_TIMESYNC (0x13)
```
[elapsed_ms: f32 LE]
```
ESP32-only. Used for clock alignment via exponential smoothing: `offset = offset * 0.85 + newOffset * 0.15`.

### TYPE_LAYOUT_BIN (0x14, v2)
```
[fixture_count: u16 LE]
for each fixture:
  [group_index: u16 LE]     // position in the flat fixture list
  [id_hash: u32 LE]         // FNV-1a of the fixture id (stable seeds)
  [channel_count: u16 LE]
  for each channel:
    [dmx_index: u16 LE]     // 0-based absolute DMX address
    [channel_type_id: u8]   // see channel type table below
    [world_x: f32 LE]       // normalized 0–1 world position
    [world_y: f32 LE]
    [resolution: u8]        // 0 = fine byte of another channel, 1 = 8 bit, 2 = 16 bit
    [fine0: u16 LE]         // dmx index of the fine byte (0xFFFF = none)
    [fine1: u16 LE]         // reserved (24 bit), 0xFFFF
    [range_min: u8]         // output remap range
    [range_max: u8]
    [head_index: u16 LE]    // beam index within the fixture (rgb / panTilt heads)
```

`world_x/world_y` are computed in `buildLayoutBin` with the beam rotation transform (strips: the LED group's center on the sampled curve). The engine groups channels with equal `(group_index, head_index)` into heads and detects their color system (RGB, RGBW, RGBA, CMY) and pan/tilt pairs.

Per fixture 8 bytes, per channel 19 bytes. Example: 20 fixtures × 4 channels = `5 + 2 + 20×8 + 80×19` = **1,687 bytes**.

### TYPE_CHAN_BIN (0x15)
```
[entry_count: u16 LE]
for each entry:
  [dmx_index_count: u16 LE]
  [dmx_index: u16 LE] × dmx_index_count
  [chaser_config: ChaserConfig]
```

**ChaserConfig encoding:**
```
[steps_count: u8]
[active_edit_step: u8]
[is_playing: u8]           // 0 or 1
[step_duration: SpeedConfig]
[fade_duration: SpeedConfig]
[step_values: f32 LE] × steps_count
```

**SpeedConfig encoding:**
```
[mode: u8]                 // 0=Time, 1=Beat, 2=Infinite
[time_ms: f32 LE]
[beat_value: f32 LE]
[beat_offset: f32 LE]
```

Channels with identical `chaserConfig` objects are grouped into a single entry by `buildChannelsBin`. This is critical for packet size: if all 80 channels have the same value (common case), the packet contains just **1 entry** regardless of fixture count.

### TYPE_MODIFIERS_BIN (0x16)
```
[version: u8]              // 1
[count: u16 LE]
for each instance:
  [key: u32 LE]            // FNV-1a of the instance id (runtime instance id, seeds)
  [plugin_index: u16 LE]   // index into the plugin table sent with the packet
  [signature: u8]          // 0 = scalar, 1 = rgb, 2 = panTilt
  [output: u8]             // 0 = bipolar, 1 = absolute (from the manifest)
  [blend: u8]              // 0 add, 1 override, 2 multiply, 3 max, 4 min
  [strength: f32 LE]       // 0–1
  [speed: SpeedConfig]
  [direction: u8]          // 0 None, 1 Linear, 2 Radial, 3 Symmetrical, 4 Angular
  [origin_x: f32 LE]
  [origin_y: f32 LE]
  [angle: f32 LE]          // radians
  [fanning: f32 LE]
  [reverse: u8]
  [type_count: u8]
  [channel_type_id: u8] × type_count     // scalar targets (empty = all; rgb/panTilt: none)
  [mask_bytes: u16 LE]                   // 0 = all fixtures
  [mask: u8] × mask_bytes                // bit i → fixture with group_index i
  [param_count: u16 LE]
  [param: f32 LE] × param_count          // manifest params, encoded in schema order
```

Instances whose plugin manifest is unknown to the client are skipped until the plugin resolves. Params are encoded by `encodeParams` (`@pixelmapper/plugin-toolchain/params`): number/int/bool/enum(index)/angle 1 slot, point 2, color 3, curve 128 (LUT). Fixed size per instance: 49 bytes + types + mask + 4 × params.

Example: 10 waveform instances (7 param slots, 1 type, all fixtures) = `5 + 3 + 10 × (49 + 1 + 28)` = **788 bytes**.

## Channel Type IDs

```
RED=0  GREEN=1  BLUE=2  WHITE=3  WARM_WHITE=4  COOL_WHITE=5
AMBER=6  UV=7  CYAN=8  MAGENTA=9  YELLOW=10  LIME=11
INDIGO=12  DIMMER=13  PAN=14  TILT=15  PANTILT_SPEED=16
STROBE=17  STROBE_SPEED=18  STROBE_DURATION=19  ZOOM=20
FOCUS=21  IRIS=22  FROST=23  BEAM_ANGLE=24  BEAM_POSITION=25
PRISM=26  PRISM_ROTATION=27  BLADE=28  COLOR_WHEEL=29
COLOR_PRESET=30  COLOR_TEMPERATURE=31  GOBO_WHEEL=32
GOBO_SPIN=33  EFFECT=34  EFFECT_SPEED=35  EFFECT_DURATION=36
SOUND_SENSITIVITY=37  ROTATION=38  SPEED=39  TIME=40
FOG=41  MAINTENANCE=42  GENERIC=43  CUSTOM=44
```

These IDs are defined in both `CHANNEL_TYPE_ID` (TypeScript, `binary-encoder.ts`) and `channel_type_name()` (Rust, `engine.rs`). They must stay in sync; the per-channel-type seed (`Sample.channelSeed`) is the FNV-1a of the name.

## Bandwidth Analysis

At 921,600 baud = **115,200 bytes/sec**:

| Scenario | Packet sizes | Initial sync |
|----------|-------------|--------------|
| 20 fixtures, 4ch, 1 step, 5 modifiers | layout ~1,687B + channels ~230B + modifiers ~400B | ~20 ms |
| 40 fixtures, 4ch, 8 steps (grouped) | layout ~3,367B + channels ~300B + modifiers ~800B | ~39 ms |
| 40 fixtures, 4ch, 8 steps (all unique) | layout ~3,367B + channels ~9,600B + modifiers ~800B | ~120 ms |

After the initial sync, only changed packets are sent. Moving a single fixture → only `TYPE_LAYOUT_BIN` + `TYPE_CHAN_BIN` resent. Changing a modifier → only `TYPE_MODIFIERS_BIN` resent.

# Binary Protocol

## Overview

All communication between the browser engine-store and its targets (WASM engine, ESP32) uses a single compact binary format. The TypeScript encoder (`binary-encoder.ts`) is the single source of truth — it produces packets that are consumed identically by both the WASM `dispatch_bin` and the ESP32 `engine_dispatch`.

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
| `TYPE_LAYOUT_BIN` | `0x14` | Fixture positions + channel metadata |
| `TYPE_CHAN_BIN` | `0x15` | Chaser configurations per DMX channel |
| `TYPE_FX_BIN` | `0x16` | Effect parameters |

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

### TYPE_LAYOUT_BIN (0x14)
```
[fixture_count: u16 LE]
for each fixture:
  [group_index: u16 LE]
  [channel_count: u8]
  for each channel:
    [dmx_index: u16 LE]     // 0-based absolute DMX address
    [channel_type_id: u8]   // see channel type table below
    [world_x: f32 LE]       // normalized 0–1 world position
    [world_y: f32 LE]
```

`world_x/world_y` are computed in `buildLayoutBin` with the full beam rotation transform (mirrors the old `syncTargets` logic): for channels with a `beamId`, the beam's local offset is rotated by the fixture's rotation angle and added to the fixture's world position.

Per-fixture overhead: 3 bytes. Per-channel overhead: 11 bytes.
Example: 20 fixtures × 4 channels = `5 + 2 + 20×3 + 80×11` = **947 bytes**.

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

### TYPE_FX_BIN (0x16)
```
[effect_count: u8]
for each effect:
  [ch_type_count: u8]
  [channel_type_id: u8] × ch_type_count   // 0 = all channel types
  [bitmask: u8] × ceil(fixture_count / 8) // fixture targeting (see below)
  [direction: u8]        // 0=None, 1=Linear, 2=Radial, 3=Symmetrical
  [origin_x: f32 LE]
  [origin_y: f32 LE]
  [angle: f32 LE]
  [strength: f32 LE]
  [reverse: u8]          // 0 or 1
  [fanning: f32 LE]
  [effect_type: u8]      // 0=Sine
  [speed: SpeedConfig]
```

**Fixture bitmask**: bit `i` set → fixture with `group_index = i` is targeted. The bitmask length is `ceil(fixture_count / 8)` — both encoder and parser derive this from the fixture count known after the last layout sync. No explicit length field is needed.

If all bits are set (or the bitmask is all zero before layout sync), the parser sets `target_group_indices = None`, which the engine treats as "all fixtures".

Example sizes at 40 fixtures (bitmask = 5 bytes):
- 20 effects, all targeting all fixtures → `5 + 1 + 20 × (1+0 + 5 + 1+4+4+4+4+1+4+1+13)` = **~820 bytes**
- 20 effects, "all except fixture 5" → same 5-byte bitmask, single bit cleared → **same size**

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

These IDs are defined in both `CHANNEL_TYPE_ID` (TypeScript, `binary-encoder.ts`) and `channel_type_name()` (Rust, `engine.rs`). They must stay in sync.

## Bandwidth Analysis

At 921,600 baud = **115,200 bytes/sec**:

| Scenario | Packet sizes | Initial sync |
|----------|-------------|--------------|
| 20 fixtures, 4ch, 1 step, 5 effects | layout ~947B + channels ~230B + effects ~220B | ~15 ms |
| 40 fixtures, 4ch, 8 steps (grouped) | layout ~1,887B + channels ~300B + effects ~450B | ~23 ms |
| 40 fixtures, 4ch, 8 steps (all unique) | layout ~1,887B + channels ~9,600B + effects ~450B | ~103 ms |

After the initial sync, only changed packets are sent. Moving a single fixture → only `TYPE_LAYOUT_BIN` + `TYPE_CHAN_BIN` resent. Changing an effect → only `TYPE_FX_BIN` resent.

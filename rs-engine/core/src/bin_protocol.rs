// ── Binary protocol ──────────────────────────────
//
// Payload parsers (the 5-byte framing header is stripped by the caller).
// See architecture/binary-protocol.md.
//   0x14 TYPE_LAYOUT_BIN     fixtures, channels, heads (v2)
//   0x15 TYPE_CHAN_BIN       chaser configs
//   0x16 TYPE_MODIFIERS_BIN  modifier instances (replaces TYPE_FX_BIN)

use crate::engine::{ChannelEntry, EffectEngine, LayoutChannelEntry, LayoutEntry, ModifierInstance};
use crate::phase::Spatial;
use crate::signatures::Signature;
use crate::types::{BlendMode, ChaserConfig, EffectDirection, OutputMode, SpeedConfig, SpeedMode};

/// Version byte of the modifiers packet.
pub const MODIFIERS_BIN_VERSION: u8 = 1;

// ── Cursor ───────────────────────────────────────

/// Little-endian byte reader.
struct Cursor<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> Cursor<'a> {
    fn new(data: &'a [u8]) -> Self { Self { data, pos: 0 } }

    fn take<const N: usize>(&mut self) -> Option<[u8; N]> {
        let bytes: [u8; N] = self.data.get(self.pos..self.pos + N)?.try_into().ok()?;
        self.pos += N;
        Some(bytes)
    }

    fn u8(&mut self) -> Option<u8> { self.take::<1>().map(|b| b[0]) }
    fn u16(&mut self) -> Option<u16> { self.take::<2>().map(u16::from_le_bytes) }
    fn u32(&mut self) -> Option<u32> { self.take::<4>().map(u32::from_le_bytes) }
    fn f32(&mut self) -> Option<f32> { self.take::<4>().map(f32::from_le_bytes) }

    fn speed(&mut self) -> Option<SpeedConfig> {
        let mode = match self.u8()? {
            0 => SpeedMode::Time,
            1 => SpeedMode::Beat,
            _ => SpeedMode::Infinite,
        };
        Some(SpeedConfig { mode, time_ms: self.f32()?, beat_value: self.f32()?, beat_offset: self.f32()? })
    }

    fn chaser(&mut self) -> Option<ChaserConfig> {
        let steps_count = self.u8()? as usize;
        let active_edit_step = self.u8()? as usize;
        let is_playing = self.u8()? != 0;
        let step_duration = self.speed()?;
        let fade_duration = self.speed()?;
        let mut step_values = Vec::with_capacity(steps_count);
        for _ in 0..steps_count {
            step_values.push(self.f32()?);
        }
        Some(ChaserConfig { step_values, steps_count, active_edit_step, is_playing, step_duration, fade_duration })
    }
}

// ── Layout (0x14, v2) ────────────────────────────

/// Parses fixtures → channels:
/// `u16 count; { u16 group; u32 idHash; u16 channels; { u16 dmx; u8 type;
/// f32 x; f32 y; u8 resolution; u16 fine0; u16 fine1; u8 rangeMin;
/// u8 rangeMax; u16 head } }`.
pub fn parse_layout_bin(engine: &mut EffectEngine, data: &[u8]) -> i32 {
    fn parse(c: &mut Cursor) -> Option<Vec<LayoutEntry>> {
        let count = c.u16()? as usize;
        let mut entries = Vec::with_capacity(count);
        for _ in 0..count {
            let group_index = c.u16()? as usize;
            let id_hash = c.u32()?;
            let n = c.u16()? as usize;
            let mut channels = Vec::with_capacity(n);
            for _ in 0..n {
                channels.push(LayoutChannelEntry {
                    dmx_index: c.u16()? as usize,
                    channel_type_id: c.u8()?,
                    world_x: c.f32()?,
                    world_y: c.f32()?,
                    resolution: c.u8()?,
                    fine_offsets: [c.u16()? as usize, c.u16()? as usize],
                    range_min: c.u8()?,
                    range_max: c.u8()?,
                    head_index: c.u16()?,
                });
            }
            entries.push(LayoutEntry { group_index, id_hash, channels });
        }
        Some(entries)
    }
    match parse(&mut Cursor::new(data)) {
        Some(entries) => {
            let n = entries.len() as i32;
            engine.sync_layout(entries);
            n
        }
        None => -1,
    }
}

// ── Channels (0x15) ──────────────────────────────

/// Parses chaser configs shared by several DMX indices.
pub fn parse_channels_bin(engine: &mut EffectEngine, data: &[u8]) -> i32 {
    fn parse(c: &mut Cursor) -> Option<Vec<ChannelEntry>> {
        let count = c.u16()? as usize;
        let mut entries = Vec::with_capacity(count);
        for _ in 0..count {
            let n = c.u16()? as usize;
            let mut dmx_indices = Vec::with_capacity(n);
            for _ in 0..n {
                dmx_indices.push(c.u16()? as usize);
            }
            entries.push(ChannelEntry { dmx_indices, chaser: c.chaser()? });
        }
        Some(entries)
    }
    match parse(&mut Cursor::new(data)) {
        Some(entries) => {
            let n = entries.len() as i32;
            engine.sync_channels(entries);
            n
        }
        None => -1,
    }
}

// ── Modifiers (0x16) ─────────────────────────────

/// Parses modifier instances:
/// `u8 version(1); u16 count; { u32 key; u16 plugin; u8 signature;
/// u8 output; u8 blend; f32 strength; speed; u8 direction; f32 originX;
/// f32 originY; f32 angle; f32 fanning; u8 reverse; u8 nTypes; u8[] types;
/// u16 maskBytes (0 = all); u8[] mask; u16 nParams; f32[] params }`.
pub fn parse_modifiers_bin(engine: &mut EffectEngine, data: &[u8]) -> i32 {
    fn parse(c: &mut Cursor) -> Option<Vec<ModifierInstance>> {
        if c.u8()? != MODIFIERS_BIN_VERSION {
            return None;
        }
        let count = c.u16()? as usize;
        let mut out = Vec::with_capacity(count);
        for _ in 0..count {
            let key = c.u32()?;
            let plugin = c.u16()? as u32;
            let signature = Signature::from_id(c.u8()?)?;
            let output = if c.u8()? == 1 { OutputMode::Absolute } else { OutputMode::Bipolar };
            let blend = BlendMode::from_id(c.u8()?);
            let strength = c.f32()?.clamp(0.0, 1.0);
            let speed = c.speed()?;
            let spatial = Spatial {
                direction: EffectDirection::from_id(c.u8()?),
                origin_x: c.f32()?,
                origin_y: c.f32()?,
                angle: c.f32()?,
                fanning: c.f32()?,
                reverse: c.u8()? != 0,
            };
            let n_types = c.u8()? as usize;
            let mut channel_types = Vec::with_capacity(n_types);
            for _ in 0..n_types {
                channel_types.push(c.u8()?);
            }
            let mask_bytes = c.u16()? as usize;
            let fixture_mask = if mask_bytes == 0 {
                None
            } else {
                let mut mask = Vec::with_capacity(mask_bytes * 8);
                for _ in 0..mask_bytes {
                    let b = c.u8()?;
                    for bit in 0..8 {
                        mask.push(b & (1 << bit) != 0);
                    }
                }
                Some(mask)
            };
            let n_params = c.u16()? as usize;
            let mut params = Vec::with_capacity(n_params);
            for _ in 0..n_params {
                params.push(c.f32()?);
            }
            out.push(ModifierInstance {
                key, plugin, signature, output, blend, strength, speed, spatial, channel_types, fixture_mask, params,
                disabled: false,
            });
        }
        Some(out)
    }
    match parse(&mut Cursor::new(data)) {
        Some(instances) => {
            let n = instances.len() as i32;
            engine.sync_modifiers(instances);
            n
        }
        None => -1,
    }
}

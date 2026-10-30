// ── Binary protocol ──────────────────────────────
//
// Payload parsers (the 5-byte framing header is stripped by the caller).
// See architecture/binary-protocol.md.
//   0x14 TYPE_LAYOUT_BIN     fixtures, channels, heads (v2)
//   0x15 TYPE_CHAN_BIN       chaser configs
//   0x16 TYPE_MODIFIERS_BIN  modifier instances (replaces TYPE_FX_BIN)

use crate::distribution::{Distribution, Grouping, Mode, Scope};
use crate::engine::{ChannelEntry, EffectEngine, LayoutChannelEntry, LayoutEntry, ModifierInstance};
use crate::signatures::Signature;
use crate::types::{BlendMode, ChaserConfig, EffectDirection, OutputMode, SpeedConfig, SpeedMode};

/// Current version byte of the modifiers packet (distribution block, ADR A20).
pub const MODIFIERS_BIN_VERSION: u8 = 2;
/// Legacy version byte (direction block); still parsed and mapped.
pub const MODIFIERS_BIN_VERSION_V1: u8 = 1;

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

    /// v1 direction block, mapped onto a distribution:
    /// `u8 direction; f32 originX, originY, angle, fanning; u8 reverse`.
    fn legacy_direction(&mut self) -> Option<Distribution> {
        let direction = EffectDirection::from_id(self.u8()?);
        let origin = (self.f32()?, self.f32()?);
        let angle = self.f32()?;
        let fanning = self.f32()?;
        let reverse = self.u8()? != 0;
        // The handle length is the former fanning (one cycle per `fanning`).
        let len = if direction == EffectDirection::Angular { 0.1 } else { fanning };
        let end = (origin.0 + angle.cos() * len, origin.1 + angle.sin() * len);
        let mode = match direction {
            _ if fanning == 0.0 => Mode::None,
            EffectDirection::Linear => Mode::Linear,
            EffectDirection::Radial => Mode::Radial,
            EffectDirection::Symmetrical => Mode::Mirror,
            EffectDirection::Angular => Mode::Conical,
            EffectDirection::None => Mode::None,
        };
        Some(Distribution { mode, origin, end, reverse, ..Default::default() })
    }

    /// v2 distribution block (see `parse_modifiers_bin`); ranks by layout index.
    fn distribution(&mut self) -> Option<Distribution> {
        let scope = if self.u8()? == 1 { Scope::Within } else { Scope::Across };
        let mode = Mode::from_id(self.u8()?);
        let origin = (self.f32()?, self.f32()?);
        let end = (self.f32()?, self.f32()?);
        let reverse = self.u8()? != 0;
        let grouping = Grouping::from_id(self.u8()?);
        let grouping_n = (self.u8()? as u32).max(1);
        let grouping_seed = self.u32()?;
        let within_order = self.u8()? == 1;
        let entries = self.u16()? as usize;
        let mut ranks: Vec<i32> = Vec::new();
        let mut rank_count = 0u32;
        for _ in 0..entries {
            let index = self.u16()? as usize;
            let rank = self.u16()? as i32;
            if ranks.len() <= index {
                ranks.resize(index + 1, -1);
            }
            ranks[index] = rank;
            rank_count = rank_count.max(rank as u32 + 1);
        }
        Some(Distribution { scope, mode, origin, end, reverse, grouping, grouping_n, grouping_seed, within_order, ranks, rank_count })
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

// ── Layout (0x14, v3) ────────────────────────────

/// Parses fixtures → channels:
/// `f32 metersPerUnit; u16 count; { u16 group; u32 idHash; u16 channels;
/// { u16 dmx; u8 type; f32 x; f32 y; f32 z; u8 resolution; u16 fine0;
/// u16 fine1; u8 rangeMin; u8 rangeMax; u16 head } }` (v3 adds
/// `metersPerUnit` and `z`, ABI v1.3).
pub fn parse_layout_bin(engine: &mut EffectEngine, data: &[u8]) -> i32 {
    fn parse(c: &mut Cursor) -> Option<(f32, Vec<LayoutEntry>)> {
        let meters_per_unit = c.f32()?;
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
                    world_z: c.f32()?,
                    resolution: c.u8()?,
                    fine_offsets: [c.u16()? as usize, c.u16()? as usize],
                    range_min: c.u8()?,
                    range_max: c.u8()?,
                    head_index: c.u16()?,
                });
            }
            entries.push(LayoutEntry { group_index, id_hash, channels });
        }
        Some((meters_per_unit, entries))
    }
    match parse(&mut Cursor::new(data)) {
        Some((meters_per_unit, entries)) => {
            let n = entries.len() as i32;
            engine.meters_per_unit = meters_per_unit;
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
/// `u8 version(2); u16 count; { u32 key; u16 plugin; u8 signature;
/// u8 output; u8 blend; f32 strength; speed; distribution; u8 nTypes;
/// u8[] types; u16 maskBytes (0 = all); u8[] mask; u16 nParams; f32[] params }`
/// with `distribution = u8 scope; u8 mode; f32 originX, originY, endX, endY;
/// u8 reverse; u8 groupingKind; u8 groupingN; u32 groupingSeed;
/// u8 withinOffset; u16 rankEntries; { u16 fixtureIndex; u16 rank }`.
/// Version 1 (direction block instead of distribution) is mapped.
pub fn parse_modifiers_bin(engine: &mut EffectEngine, data: &[u8]) -> i32 {
    fn parse(c: &mut Cursor) -> Option<Vec<ModifierInstance>> {
        let version = c.u8()?;
        if version != MODIFIERS_BIN_VERSION && version != MODIFIERS_BIN_VERSION_V1 {
            return None;
        }
        let count = c.u16()? as usize;
        let mut out = Vec::with_capacity(count);
        for _ in 0..count {
            let key = c.u32()?;
            let plugin = c.u16()? as u32;
            let signature = Signature::from_id(c.u8()?)?;
            let output = OutputMode::from_id(c.u8()?);
            let blend = BlendMode::from_id(c.u8()?);
            let strength = c.f32()?.clamp(0.0, 1.0);
            let speed = c.speed()?;
            let distribution = if version == MODIFIERS_BIN_VERSION_V1 { c.legacy_direction()? } else { c.distribution()? };
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
                key, plugin, signature, output, blend, strength, speed, distribution, channel_types, fixture_mask, params,
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

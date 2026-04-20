use crate::engine::{ChannelEntry, EffectEngine, LayoutChannelEntry, LayoutEntry, channel_type_name};
use crate::types::{BlendMode, ChannelMode, ChaserConfig, EffectConfig, EffectDirection, NoiseParams, NoiseType, SequencerParams, SequencerPatternType, SpeedConfig, SpeedMode, WaveformShape, WaveformShapeParams};

// ── Cursor-based byte reader ──────────────────────────────────────────────────

struct Cursor<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> Cursor<'a> {
    fn new(data: &'a [u8]) -> Self { Self { data, pos: 0 } }
    fn remaining(&self) -> usize { self.data.len().saturating_sub(self.pos) }

    fn read_u8(&mut self) -> Option<u8> {
        if self.remaining() < 1 { return None; }
        let v = self.data[self.pos];
        self.pos += 1;
        Some(v)
    }

    fn read_u16_le(&mut self) -> Option<u16> {
        if self.remaining() < 2 { return None; }
        let v = u16::from_le_bytes([self.data[self.pos], self.data[self.pos + 1]]);
        self.pos += 2;
        Some(v)
    }

    fn read_f32_le(&mut self) -> Option<f32> {
        if self.remaining() < 4 { return None; }
        let bytes = [
            self.data[self.pos],
            self.data[self.pos + 1],
            self.data[self.pos + 2],
            self.data[self.pos + 3],
        ];
        self.pos += 4;
        Some(f32::from_le_bytes(bytes))
    }

    fn read_speed_config(&mut self) -> Option<SpeedConfig> {
        let mode_byte   = self.read_u8()?;
        let time_ms     = self.read_f32_le()?;
        let beat_value  = self.read_f32_le()?;
        let beat_offset = self.read_f32_le()?;
        let mode = match mode_byte {
            0 => SpeedMode::Time,
            1 => SpeedMode::Beat,
            _ => SpeedMode::Infinite,
        };
        Some(SpeedConfig { mode, time_ms, beat_value, beat_offset })
    }

    fn read_chaser_config(&mut self) -> Option<ChaserConfig> {
        let steps_count   = self.read_u8()? as usize;
        let active_step   = self.read_u8()? as usize;
        let is_playing    = self.read_u8()? != 0;
        let step_duration = self.read_speed_config()?;
        let fade_duration = self.read_speed_config()?;
        let mut step_values = Vec::with_capacity(steps_count);
        for _ in 0..steps_count {
            step_values.push(self.read_f32_le()?);
        }
        Some(ChaserConfig {
            step_values,
            steps_count,
            active_edit_step: active_step,
            is_playing,
            step_duration,
            fade_duration,
        })
    }
}

// ── Public parsers ────────────────────────────────────────────────────────────

/// TYPE_LAYOUT_BIN (0x14): fixture positions + channel metadata
pub fn parse_layout_bin(engine: &mut EffectEngine, data: &[u8]) -> i32 {
    let mut c = Cursor::new(data);
    let fixture_count = match c.read_u16_le() { Some(v) => v as usize, None => return -1 };
    let mut entries = Vec::with_capacity(fixture_count);

    for _ in 0..fixture_count {
        let group_index   = match c.read_u16_le() { Some(v) => v as usize, None => return -1 };
        let channel_count = match c.read_u8()     { Some(v) => v as usize, None => return -1 };

        let mut channels = Vec::with_capacity(channel_count);
        for _ in 0..channel_count {
            let dmx_index       = match c.read_u16_le() { Some(v) => v as usize, None => return -1 };
            let channel_type_id = match c.read_u8()     { Some(v) => v,          None => return -1 };
            let world_x         = match c.read_f32_le() { Some(v) => v,          None => return -1 };
            let world_y         = match c.read_f32_le() { Some(v) => v,          None => return -1 };
            let resolution      = match c.read_u8()     { Some(v) => v,          None => return -1 };
            let fine_offset_0   = match c.read_u16_le() { Some(v) => v as usize, None => return -1 };
            let fine_offset_1   = match c.read_u16_le() { Some(v) => v as usize, None => return -1 };

            // We do NOT continue early for resolution==0. Fine channels need to be instantiated
            // as targets so their chaser_config updates the base_buffer.
            
            channels.push(LayoutChannelEntry { 
                dmx_index, 
                channel_type_id, 
                world_x, 
                world_y,
                resolution,
                fine_offsets: [fine_offset_0, fine_offset_1] 
            });
        }
        entries.push(LayoutEntry { group_index, channels });
    }

    let count = entries.len() as i32;
    engine.sync_layout(entries);
    count
}

/// TYPE_CHANNELS_BIN (0x15): chaser values, channels grouped by identical config
pub fn parse_channels_bin(engine: &mut EffectEngine, data: &[u8]) -> i32 {
    let mut c = Cursor::new(data);
    let entry_count = match c.read_u16_le() { Some(v) => v as usize, None => return -1 };
    let mut entries = Vec::with_capacity(entry_count);

    for _ in 0..entry_count {
        let dmx_count = match c.read_u16_le() { Some(v) => v as usize, None => return -1 };
        let mut dmx_indices = Vec::with_capacity(dmx_count);
        for _ in 0..dmx_count {
            match c.read_u16_le() {
                Some(v) => dmx_indices.push(v as usize),
                None    => return -1,
            }
        }
        let chaser = match c.read_chaser_config() { Some(v) => v, None => return -1 };
        entries.push(ChannelEntry { dmx_indices, chaser });
    }

    let count = entries.len() as i32;
    engine.sync_channels(entries);
    count
}

/// TYPE_EFFECTS_BIN (0x16): effect parameters
pub fn parse_effects_bin(engine: &mut EffectEngine, data: &[u8]) -> i32 {
    let mut c = Cursor::new(data);
    let blend_byte = match c.read_u8() { Some(v) => v, None => return -1 };
    engine.stack_blend_mode = match blend_byte {
        1 => BlendMode::Override,
        2 => BlendMode::Multiply,
        3 => BlendMode::Max,
        4 => BlendMode::Min,
        _ => BlendMode::Add,
    };
    let effect_count = match c.read_u8() { Some(v) => v as usize, None => return -1 };
    let mut configs = Vec::with_capacity(effect_count);

    for _ in 0..effect_count {
        // Channel types: count=0 means all channel types
        let ch_type_count = match c.read_u8() { Some(v) => v as usize, None => return -1 };
        let mut target_channels = Vec::with_capacity(ch_type_count);
        for _ in 0..ch_type_count {
            match c.read_u8() {
                Some(id) => target_channels.push(channel_type_name(id).to_string()),
                None     => return -1,
            }
        }

        // Fixture bitmask — size derived from layout (same formula as encoder).
        // Bit i set → fixture with group_index i is targeted.
        let layout_fixture_count = engine.targets.iter().map(|t| t.group_index).max()
            .map(|m| m + 1).unwrap_or(0);
        let bitmask_bytes = (layout_fixture_count + 7) / 8;
        let mut targeted = Vec::new();
        for byte_idx in 0..bitmask_bytes {
            let byte = match c.read_u8() { Some(v) => v, None => return -1 };
            for bit in 0..8u8 {
                if byte & (1 << bit) != 0 {
                    let group_idx = byte_idx * 8 + bit as usize;
                    if group_idx < layout_fixture_count {
                        targeted.push(group_idx);
                    }
                }
            }
        }
        let target_group_indices = if targeted.len() == layout_fixture_count || targeted.is_empty() {
            None  // All fixtures targeted (or no layout yet) → no filter
        } else {
            Some(targeted)
        };

        let direction_byte = match c.read_u8() { Some(v) => v, None => return -1 };
        let direction = match direction_byte {
            1 => EffectDirection::Linear,
            2 => EffectDirection::Radial,
            3 => EffectDirection::Symmetrical,
            _ => EffectDirection::None,
        };

        let origin_x         = match c.read_f32_le() { Some(v) => v,      None => return -1 };
        let origin_y         = match c.read_f32_le() { Some(v) => v,      None => return -1 };
        let angle            = match c.read_f32_le() { Some(v) => v,      None => return -1 };
        let strength         = match c.read_f32_le() { Some(v) => v,      None => return -1 };
        let reverse          = match c.read_u8()     { Some(v) => v != 0, None => return -1 };
        let fanning          = match c.read_f32_le() { Some(v) => v,      None => return -1 };
        let shape_byte        = match c.read_u8()     { Some(v) => v, None => return -1 };
        let shape_param       = match c.read_f32_le() { Some(v) => v, None => return -1 };
        let shape_start       = match c.read_f32_le() { Some(v) => v, None => return -1 };
        let shape_end         = match c.read_f32_le() { Some(v) => v, None => return -1 };
        let shape_start_level = match c.read_f32_le() { Some(v) => v, None => return -1 };
        let shape_end_level   = match c.read_f32_le() { Some(v) => v, None => return -1 };
        let waveform_shape = match shape_byte {
            0 => WaveformShape::Sine,
            1 => WaveformShape::Square,
            2 => WaveformShape::Triangle,
            3 => WaveformShape::Sawtooth,
            4 => WaveformShape::Bounce,
            5 => WaveformShape::Ramp,
            6 => WaveformShape::Smooth,
            _ => WaveformShape::Sine,
        };
        let speed = match c.read_speed_config() { Some(v) => v, None => return -1 };

        let effect_type_byte    = match c.read_u8()     { Some(v) => v, None => return -1 };
        let noise_type_byte     = match c.read_u8()     { Some(v) => v, None => return -1 };
        let noise_scale         = match c.read_f32_le() { Some(v) => v, None => return -1 };
        let channel_mode_byte   = match c.read_u8()     { Some(v) => v, None => return -1 };
        let color_variation     = match c.read_f32_le() { Some(v) => v, None => return -1 };
        let fade                = match c.read_f32_le() { Some(v) => v, None => return -1 };
        let threshold           = match c.read_f32_le() { Some(v) => v, None => return -1 };

        let (effect_type, noise_params) = if effect_type_byte == 1 {
            let np = NoiseParams {
                noise_type: match noise_type_byte {
                    0 => NoiseType::White,
                    1 => NoiseType::Perlin,
                    _ => NoiseType::Step,
                },
                scale: noise_scale,
                channel_mode: if channel_mode_byte == 1 { ChannelMode::Independent } else { ChannelMode::Linked },
                color_variation,
                fade,
                threshold,
            };
            ("NoiseEffect".to_string(), Some(np))
        } else {
            (String::new(), None)
        };

        // Sequencer fields
        let is_sequencer_byte = match c.read_u8() { Some(v) => v, None => return -1 };
        let sequencer_params = if is_sequencer_byte == 1 {
            let pattern_byte   = match c.read_u8()     { Some(v) => v,      None => return -1 };
            let seq_origin_x   = match c.read_f32_le() { Some(v) => v,      None => return -1 };
            let seq_origin_y   = match c.read_f32_le() { Some(v) => v,      None => return -1 };
            let seq_angle      = match c.read_f32_le() { Some(v) => v,      None => return -1 };
            let seq_scale      = match c.read_f32_le() { Some(v) => v,      None => return -1 };
            let seq_count             = match c.read_u8()     { Some(v) => v,      None => return -1 };
            let seq_density           = match c.read_f32_le() { Some(v) => v,      None => return -1 };
            let seq_density_variation = match c.read_f32_le() { Some(v) => v,      None => return -1 };
            let seq_invert            = match c.read_u8()     { Some(v) => v != 0, None => return -1 };
            Some(SequencerParams {
                pattern_type: match pattern_byte {
                    1 => SequencerPatternType::Checkerboard,
                    2 => SequencerPatternType::Sections,
                    3 => SequencerPatternType::Scatter,
                    4 => SequencerPatternType::Flow,
                    _ => SequencerPatternType::Split,
                },
                origin_x: seq_origin_x,
                origin_y: seq_origin_y,
                angle: seq_angle,
                scale: seq_scale,
                count: seq_count,
                density: seq_density,
                density_variation: seq_density_variation,
                invert: seq_invert,
            })
        } else {
            None
        };

        let effect_type = if sequencer_params.is_some() {
            "SequencerEffect".to_string()
        } else {
            effect_type
        };

        configs.push(EffectConfig {
            target_channels,
            target_group_indices,
            direction,
            origin_x,
            origin_y,
            angle,
            strength,
            reverse,
            fanning,
            speed,
            waveform_shape,
            waveform_params: WaveformShapeParams { param: shape_param, start: shape_start, end: shape_end, start_level: shape_start_level, end_level: shape_end_level },
            noise_params,
            sequencer_params,
            effect_type,
        });
    }

    let count = configs.len() as i32;
    engine.sync_effects(configs);
    count
}

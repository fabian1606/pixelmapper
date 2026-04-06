use crate::types::{ChaserConfig, RenderTarget, SpeedMode, SpeedConfig};
use crate::effects::{create_effect, Effect};

// ── Internal structs for binary-decoded layout/channel data ──────────────────

pub struct LayoutChannelEntry {
    pub dmx_index: usize,
    pub channel_type_id: u8,
    pub world_x: f32,
    pub world_y: f32,
    pub resolution: u8,
    pub fine_offsets: [usize; 2],
}

pub struct LayoutEntry {
    pub group_index: usize,
    pub channels: Vec<LayoutChannelEntry>,
}

pub struct ChannelEntry {
    pub dmx_indices: Vec<usize>,
    pub chaser: ChaserConfig,
}

// ── Engine ────────────────────────────────────────────────────────────────────

pub struct EffectEngine {
    pub dmx_buffer: Vec<u8>,
    pub base_buffer: Vec<f32>,
    pub render_buffer: Vec<f32>,
    pub global_bpm: f32,
    pub targets: Vec<RenderTarget>,
    pub effects: Vec<Box<dyn Effect>>,
}

impl Default for EffectEngine {
    fn default() -> Self {
        Self::new()
    }
}

/// Maps the binary channel type ID (u8) to its string name used in the engine.
pub fn channel_type_name(id: u8) -> &'static str {
    match id {
        0  => "RED",               1  => "GREEN",            2  => "BLUE",
        3  => "WHITE",             4  => "WARM_WHITE",        5  => "COOL_WHITE",
        6  => "AMBER",             7  => "UV",                8  => "CYAN",
        9  => "MAGENTA",           10 => "YELLOW",            11 => "LIME",
        12 => "INDIGO",            13 => "DIMMER",            14 => "PAN",
        15 => "TILT",              16 => "PANTILT_SPEED",     17 => "STROBE",
        18 => "STROBE_SPEED",      19 => "STROBE_DURATION",   20 => "ZOOM",
        21 => "FOCUS",             22 => "IRIS",              23 => "FROST",
        24 => "BEAM_ANGLE",        25 => "BEAM_POSITION",     26 => "PRISM",
        27 => "PRISM_ROTATION",    28 => "BLADE",             29 => "COLOR_WHEEL",
        30 => "COLOR_PRESET",      31 => "COLOR_TEMPERATURE", 32 => "GOBO_WHEEL",
        33 => "GOBO_SPIN",         34 => "EFFECT",            35 => "EFFECT_SPEED",
        36 => "EFFECT_DURATION",   37 => "SOUND_SENSITIVITY", 38 => "ROTATION",
        39 => "SPEED",             40 => "TIME",              41 => "FOG",
        42 => "MAINTENANCE",       43 => "GENERIC",           44 => "CUSTOM",
        _  => "OTHER",
    }
}

impl EffectEngine {
    pub fn new() -> Self {
        Self {
            dmx_buffer: vec![0; 512],
            base_buffer: vec![0.0; 512],
            render_buffer: vec![0.0; 512],
            global_bpm: 120.0,
            targets: Vec::new(),
            effects: Vec::new(),
        }
    }

    pub fn set_bpm(&mut self, bpm: f32) {
        self.global_bpm = bpm;
    }

    // ── JSON path (unchanged, used by WASM/browser) ───────────────────────────

    pub fn sync_targets(&mut self, targets: Vec<RenderTarget>) {
        self.targets = targets;
    }

    pub fn sync_effects(&mut self, configs: Vec<crate::types::EffectConfig>) {
        self.effects = configs.into_iter().map(create_effect).collect();
    }

    // ── Unified binary dispatch ───────────────────────────────────────────────

    /// Single entry point for all binary packet types. Used by both WASM and ESP32 FFI.
    pub fn dispatch_bin(&mut self, packet_type: u8, data: &[u8]) -> i32 {
        match packet_type {
            0x10 => {
                // TYPE_BPM: f32 LE
                if data.len() < 4 { return -1; }
                let bpm = f32::from_le_bytes([data[0], data[1], data[2], data[3]]);
                self.set_bpm(bpm);
                0
            }
            0x14 => crate::bin_protocol::parse_layout_bin(self, data),
            0x15 => crate::bin_protocol::parse_channels_bin(self, data),
            0x16 => crate::bin_protocol::parse_effects_bin(self, data),
            _    => -1,
        }
    }

    // ── Binary path (used by ESP32 FFI) ──────────────────────────────────────

    /// Rebuild the targets list from layout data (fixture positions + channel metadata).
    /// Called when fixtures are added/moved. Chaser configs start as None until
    /// sync_channels is called.
    pub fn sync_layout(&mut self, entries: Vec<LayoutEntry>) {
        // Build a map of existing chaser configs by dmx_index so we can preserve
        // them across layout rebuilds (avoids DMX glitch to 0 between layout and
        // channels dispatch).
        let mut old_configs: Vec<(usize, ChaserConfig)> = Vec::new();
        for t in &self.targets {
            if let Some(cfg) = &t.chaser_config {
                old_configs.push((t.dmx_index, cfg.clone()));
            }
        }

        // Calculate maximum required DMX index for dynamic buffer sizing
        let mut max_dmx_index = 0;
        self.targets.clear();
        for fixture in &entries {
            for ch in &fixture.channels {
                if ch.dmx_index > max_dmx_index {
                    max_dmx_index = ch.dmx_index;
                }
                
                let preserved = old_configs.iter()
                    .find(|(idx, _)| *idx == ch.dmx_index)
                    .map(|(_, cfg)| cfg.clone());
                self.targets.push(RenderTarget {
                    dmx_index: ch.dmx_index,
                    channel_type: channel_type_name(ch.channel_type_id).to_string(),
                    group_index: fixture.group_index,
                    world_x: ch.world_x,
                    world_y: ch.world_y,
                    chaser_config: preserved,
                    resolution: ch.resolution,
                    fine_offsets: ch.fine_offsets,
                });
            }
        }

        // Resize the buffer if we need more than we currently have, or pad up to nearest 512
        let required_size = max_dmx_index + 1;
        let padded_size = ((required_size + 511) / 512) * 512;
        let new_size = padded_size.max(512);

        if self.dmx_buffer.len() != new_size {
            self.dmx_buffer.resize(new_size, 0);
            self.base_buffer.resize(new_size, 0.0);
            self.render_buffer.resize(new_size, 0.0);
        }
    }

    /// Update chaser configs for specific DMX channels. Multiple channels can share
    /// the same chaser config (one ChannelEntry covers several dmxIndices).
    pub fn sync_channels(&mut self, entries: Vec<ChannelEntry>) {
        for entry in entries {
            for dmx_index in &entry.dmx_indices {
                if let Some(target) = self.targets.iter_mut().find(|t| t.dmx_index == *dmx_index) {
                    target.chaser_config = Some(entry.chaser.clone());
                }
            }
        }
    }

    // ── Render ────────────────────────────────────────────────────────────────

    fn resolve_speed_to_ms(speed: &SpeedConfig, global_bpm: f32) -> f32 {
        match speed.mode {
            SpeedMode::Infinite => f32::INFINITY,
            SpeedMode::Time => speed.time_ms,
            SpeedMode::Beat => (60000.0 / global_bpm) * speed.beat_value,
        }
    }

    pub fn render(&mut self, time_ms: f32, delta_time_ms: f32) {
        // 0. Clear buffers so unpatched channels return to 0
        self.dmx_buffer.fill(0);
        self.base_buffer.fill(0.0);
        self.render_buffer.fill(0.0);

        // 1. Update effects
        let global_bpm = self.global_bpm;
        for effect in &mut self.effects {
            effect.update(delta_time_ms, global_bpm);
        }

        // 2. Compute base values (Chasers or Defaults)
        for target in &self.targets {
            let dmx_index = target.dmx_index;
            if dmx_index >= self.dmx_buffer.len() {
                continue;
            }

            let mut calculated_base = 0.0;

            if let Some(chaser) = &target.chaser_config {
                if !chaser.is_playing || chaser.steps_count <= 1 {
                    let active_step = chaser.active_edit_step.min(chaser.step_values.len().saturating_sub(1));
                    calculated_base = *chaser.step_values.get(active_step).unwrap_or(&0.0);
                } else {
                    let step_ms = Self::resolve_speed_to_ms(&chaser.step_duration, global_bpm);
                    let fade_ms = Self::resolve_speed_to_ms(&chaser.fade_duration, global_bpm);

                    if step_ms.is_infinite() {
                        let active_step = chaser.active_edit_step.min(chaser.step_values.len().saturating_sub(1));
                        calculated_base = *chaser.step_values.get(active_step).unwrap_or(&0.0);
                    } else {
                        let beat_dur_ms = 60000.0 / global_bpm;
                        let offset_ms = if chaser.step_duration.mode == SpeedMode::Beat {
                            chaser.step_duration.beat_offset * beat_dur_ms
                        } else {
                            0.0
                        };

                        let cycle_time = step_ms * (chaser.steps_count as f32);
                        let shifted_time = (time_ms + offset_ms).max(0.0);
                        let time_in_cycle = shifted_time % cycle_time;
                        let current_index = (time_in_cycle / step_ms).floor() as usize;
                        let next_index = (current_index + 1) % chaser.steps_count;
                        let time_in_step = time_in_cycle % step_ms;

                        let factor = if time_in_step < fade_ms && fade_ms > 0.0 {
                            time_in_step / fade_ms
                        } else if fade_ms == 0.0 {
                            1.0 // Snaps immediately
                        } else {
                            1.0 // Holding phase
                        };

                        let v1 = *chaser.step_values.get(current_index).unwrap_or(&0.0);
                        let v2 = *chaser.step_values.get(next_index).unwrap_or(&0.0);

                        calculated_base = v1 + (v2 - v1) * factor;
                    }
                }
            }

            // Both buffers are clamped to 0-255. base_buffer is used by effects for
            // computing target_min/max — storing raw out-of-range values (e.g. 32768
            // from old 16-bit OFL defaults) would make the effect math produce extreme
            // negative offsets that clamp everything to 0.
            self.base_buffer[dmx_index] = calculated_base.clamp(0.0, 255.0);
            self.render_buffer[dmx_index] = calculated_base.clamp(0.0, 255.0);
        }

        // 3. Apply effects
        // Fine channels (resolution == 0) are skipped — they have no independent effect layer.
        // Effects target the coarse channel only and use its 0-255 render_buffer slot.
        for target in &self.targets {
            let dmx_index = target.dmx_index;
            if dmx_index >= self.dmx_buffer.len() || target.resolution == 0 {
                continue;
            }

            for effect in &self.effects {
                let config = effect.get_config();

                // Empty target_channels means "all channel types"
                if !config.target_channels.is_empty() && !config.target_channels.contains(&target.channel_type) {
                    continue;
                }

                if let Some(groups) = &config.target_group_indices {
                    if !groups.contains(&target.group_index) {
                        continue;
                    }
                }

                let wave_value = effect.render(target.world_x, target.world_y);
                let base_value = self.base_buffer[dmx_index];

                let target_max = (base_value + config.strength).min(255.0);
                let target_min = (base_value - config.strength).max(0.0);

                let mapped_value = target_min + ((wave_value + 1.0) / 2.0) * (target_max - target_min);
                let offset = mapped_value - base_value;

                // Additively blend the effect on top of what was already in renderBuffer
                let current_dmx = self.render_buffer[dmx_index];
                self.render_buffer[dmx_index] = (current_dmx + offset).clamp(0.0, 255.0);
            }
        }

        // 4. Write render_buffer floats to dmx_buffer bytes.
        //    Each byte slot is written from its OWN render_buffer slot — no cross-slot derivation.
        //    Coarse (resolution 1-3): writes MSB from render_buffer[coarse_idx]
        //    Fine  (resolution 0)   : writes its own render_buffer slot directly
        //    This gives full independent control: Coarse slider → MSB, Fine slider → LSB.
        for target in &self.targets {
            let dmx_index = target.dmx_index;
            if dmx_index >= self.dmx_buffer.len() {
                continue;
            }
            // All channels (coarse AND fine) simply map their 0-255 float to a byte.
            self.dmx_buffer[dmx_index] = self.render_buffer[dmx_index].clamp(0.0, 255.0) as u8;
        }
    }
}

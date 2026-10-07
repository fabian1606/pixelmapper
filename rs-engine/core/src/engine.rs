use crate::types::{BlendMode, ChaserConfig, RenderTarget, SpeedMode, SpeedConfig};
use crate::effects::{create_effect, Effect};

pub(crate) fn rgb_to_hsl(r: f32, g: f32, b: f32) -> (f32, f32, f32) {
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let l = (max + min) / 2.0;
    if (max - min).abs() < 1e-6 {
        return (0.0, 0.0, l);
    }
    let d = max - min;
    let s = if l > 0.5 { d / (2.0 - max - min) } else { d / (max + min) };
    let h = if max == r {
        ((g - b) / d + if g < b { 6.0 } else { 0.0 }) / 6.0
    } else if max == g {
        ((b - r) / d + 2.0) / 6.0
    } else {
        ((r - g) / d + 4.0) / 6.0
    };
    (h, s, l)
}

fn hue_to_rgb(p: f32, q: f32, mut t: f32) -> f32 {
    if t < 0.0 { t += 1.0; }
    if t > 1.0 { t -= 1.0; }
    if t < 1.0 / 6.0 { return p + (q - p) * 6.0 * t; }
    if t < 1.0 / 2.0 { return q; }
    if t < 2.0 / 3.0 { return p + (q - p) * (2.0 / 3.0 - t) * 6.0; }
    p
}

pub(crate) fn hsl_to_rgb(h: f32, s: f32, l: f32) -> (f32, f32, f32) {
    if s < 1e-6 {
        return (l, l, l);
    }
    let q = if l < 0.5 { l * (1.0 + s) } else { l + s - l * s };
    let p = 2.0 * l - q;
    (hue_to_rgb(p, q, h + 1.0 / 3.0), hue_to_rgb(p, q, h), hue_to_rgb(p, q, h - 1.0 / 3.0))
}

// ── Internal structs for binary-decoded layout/channel data ──────────────────

pub struct LayoutChannelEntry {
    pub dmx_index: usize,
    pub channel_type_id: u8,
    pub world_x: f32,
    pub world_y: f32,
    pub resolution: u8,
    pub fine_offsets: [usize; 2],
    pub range_min: u8,
    pub range_max: u8,
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
    pub stack_blend_mode: BlendMode,
    /// Accumulated warped time for speed-curve effects (tracked across frames).
    pub warped_time_ms: f32,
    // Pre-allocated work buffers — avoid per-frame heap allocation on ESP32.
    displacement_offsets: Vec<(f32, f32)>,
    effects_generation: u32,
    // SpeedCurve LUT cache — only rebuilt when effects or BPM change.
    speed_curve_lut_combined: Vec<f32>,
    speed_curve_lut_integral: Vec<f32>,
    speed_curve_cached_bpm: f32,
    speed_curve_cached_cycle_dur: f32,
    speed_curve_cached_generation: u32,
    // ColorEffect per-group work buffers.
    color_reds: Vec<(usize, f32, f32)>,
    color_greens: Vec<usize>,
    color_blues: Vec<usize>,
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
            stack_blend_mode: BlendMode::Add,
            warped_time_ms: 0.0,
            displacement_offsets: Vec::new(),
            effects_generation: 0,
            speed_curve_lut_combined: vec![1.0f32; 257],
            speed_curve_lut_integral: vec![0.0f32; 257],
            speed_curve_cached_bpm: -1.0,
            speed_curve_cached_cycle_dur: 0.0,
            speed_curve_cached_generation: u32::MAX,
            color_reds: Vec::new(),
            color_greens: Vec::new(),
            color_blues: Vec::new(),
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
        // Preserve time_phase across re-syncs so that effect cycles (e.g. ColorEffect
        // hue/sat oscillation) keep advancing instead of resetting to 0 on every
        // FX_BIN dispatch. Match by position — the binary protocol carries effects
        // in the same order from JS, so index i in old and new corresponds to the
        // same effect for normal edit flows (mutating params, not reordering).
        let old_phases: Vec<f32> = self.effects.iter().map(|e| e.get_time_phase()).collect();
        let mut new_effects: Vec<Box<dyn Effect>> =
            configs.into_iter().map(create_effect).collect();
        for (i, effect) in new_effects.iter_mut().enumerate() {
            if let Some(&phase) = old_phases.get(i) {
                effect.set_time_phase(phase);
            }
        }
        self.effects = new_effects;
        self.effects_generation = self.effects_generation.wrapping_add(1);
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
                    channel_type: std::borrow::Cow::Borrowed(channel_type_name(ch.channel_type_id)),
                    group_index: fixture.group_index,
                    world_x: ch.world_x,
                    world_y: ch.world_y,
                    chaser_config: preserved,
                    resolution: ch.resolution,
                    fine_offsets: ch.fine_offsets,
                    range_min: ch.range_min,
                    range_max: ch.range_max,
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

        // 1. Speed-curve pre-pass: warp time_ms using all active SpeedCurveEffects.
        // SpeedCurveEffects get unwarped time for their own internal state;
        // all other effects receive the combined warped time.
        let global_bpm = self.global_bpm;

        // Downcast helper: check if an effect is a SpeedCurveEffect by config field.
        let has_speed_curve = self.effects.iter()
            .any(|e| e.get_config().speed_curve_params.is_some());

        let (effective_time_ms, effective_delta_ms) = if has_speed_curve {
            use crate::effects::{sample_curve, warp_phase};
            const SAMPLES: usize = 256;

            // Rebuild the combined LUT only when effects or BPM changed.
            let need_rebuild = self.speed_curve_cached_generation != self.effects_generation
                || (self.speed_curve_cached_bpm - global_bpm).abs() > 0.01;

            if need_rebuild {
                for v in self.speed_curve_lut_combined.iter_mut() { *v = 1.0; }
                for effect in &self.effects {
                    let config = effect.get_config();
                    if let Some(scp) = &config.speed_curve_params {
                        let beat_dur = 60000.0 / global_bpm.max(1.0);
                        let cycle_dur = beat_dur * scp.cycle_beats as f32;
                        if cycle_dur > 0.0 {
                            for i in 0..=SAMPLES {
                                let t = i as f32 / SAMPLES as f32;
                                self.speed_curve_lut_combined[i] *= sample_curve(&scp.points, t);
                            }
                        }
                    }
                }
                // Determine cycle duration from first SpeedCurveEffect.
                let cycle_dur = {
                    let mut dur = 1000.0f32;
                    for effect in &self.effects {
                        let config = effect.get_config();
                        if let Some(scp) = &config.speed_curve_params {
                            let beat_dur = 60000.0 / global_bpm.max(1.0);
                            dur = beat_dur * scp.cycle_beats as f32;
                            break;
                        }
                    }
                    dur
                };
                self.speed_curve_lut_integral[0] = 0.0;
                let mut sum = 0.0f32;
                let mut prev = self.speed_curve_lut_combined[0];
                for i in 1..=SAMPLES {
                    let curr = self.speed_curve_lut_combined[i];
                    sum += (prev + curr) * 0.5 / SAMPLES as f32;
                    self.speed_curve_lut_integral[i] = sum;
                    prev = curr;
                }
                self.speed_curve_cached_bpm = global_bpm;
                self.speed_curve_cached_cycle_dur = cycle_dur;
                self.speed_curve_cached_generation = self.effects_generation;
            }

            let cycle_dur = self.speed_curve_cached_cycle_dur;
            let cycles = (time_ms / cycle_dur).floor();
            let phase = ((time_ms % cycle_dur) / cycle_dur).clamp(0.0, 1.0);
            let warped_phase = warp_phase(&self.speed_curve_lut_integral, phase);
            let new_warped = cycles * cycle_dur + warped_phase * cycle_dur;
            let warped_delta = (new_warped - self.warped_time_ms).max(0.0);
            self.warped_time_ms = new_warped;
            (new_warped, warped_delta)
        } else {
            self.warped_time_ms = time_ms;
            (time_ms, delta_time_ms)
        };

        // 2. Update effects — meta-effects (SpeedCurve, Displacement) use raw time;
        //    all other effects use the warped time.
        for effect in &mut self.effects {
            let config = effect.get_config();
            let is_meta = config.speed_curve_params.is_some() || config.displacement_params.is_some();
            if is_meta {
                effect.update(delta_time_ms, time_ms, global_bpm);
            } else {
                effect.update(effective_delta_ms, effective_time_ms, global_bpm);
            }
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

        // 3.0 Displacement pre-pass: compute per-target (dx, dy) from all active DisplacementEffects.
        // These offsets perturb the world position seen by all subsequent effects.
        // Reuse the pre-allocated Vec to avoid heap allocation every frame.
        self.displacement_offsets.resize(self.targets.len(), (0.0, 0.0));
        for target_idx in 0..self.targets.len() {
            let mut dx = 0.0f32;
            let mut dy = 0.0f32;
            {
                let target = &self.targets[target_idx];
                for effect in &self.effects {
                    let config = effect.get_config();
                    if config.displacement_params.is_none() { continue; }
                    if let Some(groups) = &config.target_group_indices {
                        if !groups.contains(&target.group_index) { continue; }
                    }
                    if !config.target_channels.is_empty() && !config.target_channels.iter().any(|c| c.as_str() == target.channel_type.as_ref()) {
                        continue;
                    }
                    if let Some((ex, ey)) = effect.sample_displacement(target.world_x, target.world_y) {
                        dx += ex;
                        dy += ey;
                    }
                }
            }
            self.displacement_offsets[target_idx] = (dx, dy);
        }

        for (target_idx, target) in self.targets.iter().enumerate() {
            let dmx_index = target.dmx_index;
            if dmx_index >= self.dmx_buffer.len() || target.resolution == 0 {
                continue;
            }
            let (disp_x, disp_y) = self.displacement_offsets[target_idx];
            let eff_world_x = target.world_x + disp_x;
            let eff_world_y = target.world_y + disp_y;

            for effect in &self.effects {
                let config = effect.get_config();

                // ColorEffects are pure post-process (Step 3.5) — skip per-channel contribution.
                if config.color_params.is_some() {
                    continue;
                }

                // DisplacementEffects and SpeedCurveEffects have no DMX contribution — skip.
                if config.displacement_params.is_some() || config.speed_curve_params.is_some() {
                    continue;
                }

                // Empty target_channels means "all channel types"
                if !config.target_channels.is_empty() && !config.target_channels.iter().any(|c| c.as_str() == target.channel_type.as_ref()) {
                    continue;
                }

                if let Some(groups) = &config.target_group_indices {
                    if !groups.contains(&target.group_index) {
                        continue;
                    }
                }

                // Per-channel seed: FNV-1a of the channel type string so each
                // channel kind (RED, GREEN, BLUE, DIMMER, ...) decorrelates.
                let channel_seed: u32 = {
                    let mut h: u32 = 0x811c9dc5;
                    for b in target.channel_type.as_bytes() {
                        h = (h ^ (*b as u32)).wrapping_mul(0x01000193);
                    }
                    h
                };
                let group_count = match &config.target_group_indices {
                    Some(indices) => indices.len() as u32,
                    None => self.targets.iter().map(|t| t.group_index).max().map(|m| m + 1).unwrap_or(0) as u32,
                };
                let wave_value = effect.render(eff_world_x, eff_world_y, channel_seed, target.group_index as u32, group_count);
                let base_value = self.base_buffer[dmx_index];

                let mapped_value = if wave_value.is_nan() {
                    // Inactive-zone floor override: explicit fraction of base,
                    // decoupled from strength. floor=0 → black, floor=1 → full color.
                    (base_value * config.waveform_params.floor.clamp(0.0, 1.0)).clamp(0.0, 255.0)
                } else if config.sequencer_params.is_some() {
                    // Sequencer blend: ON (wave=0) keeps base, OFF (wave=-1) scales toward black.
                    // strength 0–255 controls how dark the OFF segments go.
                    let strength_frac = config.strength / 255.0;
                    if wave_value >= 0.0 {
                        base_value
                    } else {
                        base_value * (1.0 + wave_value * strength_frac)
                    }
                } else {
                    // Peak (wave=+1) always lands at the base color — never above it,
                    // so an RGB fixture with base=(255,0,0) pulses red↔black, not red↔white.
                    // Strength controls how deep the trough drops below the base.
                    let target_max = base_value;
                    let target_min = (base_value - config.strength).max(0.0);
                    target_min + ((wave_value + 1.0) / 2.0) * (target_max - target_min)
                };
                let prev = self.render_buffer[dmx_index];
                self.render_buffer[dmx_index] = match self.stack_blend_mode {
                    BlendMode::Add      => (prev + (mapped_value - base_value)).clamp(0.0, 255.0),
                    BlendMode::Override => mapped_value.clamp(0.0, 255.0),
                    BlendMode::Multiply => (prev * (mapped_value / 255.0)).clamp(0.0, 255.0),
                    BlendMode::Max      => prev.max(mapped_value),
                    BlendMode::Min      => prev.min(mapped_value),
                };
            }
        }

        // 3.5 Apply color (hue/saturation) post-processing per fixture
        for effect in &self.effects {
            let config = effect.get_config();
            let cp = match &config.color_params {
                Some(p) => *p,
                None => continue,
            };

            let max_group = self.targets.iter().map(|t| t.group_index).max().unwrap_or(0);
            let groups: Vec<usize> = match &config.target_group_indices {
                Some(g) => g.clone(),
                None => (0..=max_group).collect(),
            };

            for group_idx in groups {
                // Multi-pixel fixtures (LED strips, matrices) have many R/G/B
                // triples per group — pair them by position so EACH pixel gets
                // its own hue rotation with its own world coords for spatial cycle.
                // Reuse pre-allocated Vecs to avoid heap allocation every frame.
                self.color_reds.clear();
                self.color_greens.clear();
                self.color_blues.clear();
                for i in 0..self.targets.len() {
                    if self.targets[i].group_index != group_idx { continue; }
                    let dmx = self.targets[i].dmx_index;
                    let wx  = self.targets[i].world_x;
                    let wy  = self.targets[i].world_y;
                    let is_red   = self.targets[i].channel_type == "RED";
                    let is_green = !is_red && self.targets[i].channel_type == "GREEN";
                    let is_blue  = !is_red && !is_green && self.targets[i].channel_type == "BLUE";
                    if is_red   { self.color_reds.push((dmx, wx, wy)); }
                    else if is_green { self.color_greens.push(dmx); }
                    else if is_blue  { self.color_blues.push(dmx); }
                }

                let pixel_count = self.color_reds.len().min(self.color_greens.len()).min(self.color_blues.len());
                for p in 0..pixel_count {
                    let (ri, wx, wy) = self.color_reds[p];
                    let gi = self.color_greens[p];
                    let bi = self.color_blues[p];

                    let r = self.render_buffer[ri] / 255.0;
                    let g = self.render_buffer[gi] / 255.0;
                    let b = self.render_buffer[bi] / 255.0;

                    let cycle = effect.eval_cycle_at(wx, wy);
                    let eff_hue = cp.hue_shift + cycle * cp.hue_range;
                    let eff_sat = (cp.saturation + cycle * cp.sat_range).clamp(0.0, 2.0);

                    let (h, s, l) = rgb_to_hsl(r, g, b);
                    // Skip hue shift on near-black — hue is meaningless at L≈0.
                    let new_h = if l < 1e-3 { h } else { (h + eff_hue / 360.0).rem_euclid(1.0) };
                    let new_s = (s * eff_sat).clamp(0.0, 1.0);
                    let (nr, ng, nb) = hsl_to_rgb(new_h, new_s, l);

                    self.render_buffer[ri] = (nr * 255.0).clamp(0.0, 255.0);
                    self.render_buffer[gi] = (ng * 255.0).clamp(0.0, 255.0);
                    self.render_buffer[bi] = (nb * 255.0).clamp(0.0, 255.0);
                }
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
            // A per-channel range remaps the rendered value into [range_min, range_max]
            // (affine, not clipped) so effects/movement are rescaled into the limit.
            let v = self.render_buffer[dmx_index].clamp(0.0, 255.0);
            let (lo, hi) = (target.range_min as f32, target.range_max as f32);
            let out = if lo == 0.0 && hi == 255.0 { v } else { lo + (v / 255.0) * (hi - lo) };
            self.dmx_buffer[dmx_index] = out.clamp(0.0, 255.0) as u8;
        }
    }
}

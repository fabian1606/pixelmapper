use crate::types::{EffectConfig, EffectDirection, NoiseType, SequencerPatternType, SpeedConfig, SpeedMode, WaveformShape};

pub trait Effect {
    fn update(&mut self, delta_time_ms: f32, abs_time_ms: f32, global_bpm: f32);
    fn render(&self, world_x: f32, world_y: f32, channel_seed: u32, group_index: u32, group_count: u32) -> f32;
    fn get_config(&self) -> &EffectConfig;
}

pub struct BaseOscillator {
    config: EffectConfig,
    time_phase: f32,
    offset_phase: f32,
    shape_fn: fn(&EffectConfig, f32) -> f32,
}

impl BaseOscillator {
    pub fn new(config: EffectConfig, shape_fn: fn(&EffectConfig, f32) -> f32) -> Self {
        Self {
            config,
            time_phase: 0.0,
            offset_phase: 0.0,
            shape_fn,
        }
    }

    fn resolve_speed_to_ms(speed: &SpeedConfig, global_bpm: f32) -> f32 {
        match speed.mode {
            SpeedMode::Infinite => f32::INFINITY,
            SpeedMode::Time => speed.time_ms,
            SpeedMode::Beat => (60000.0 / global_bpm) * speed.beat_value,
        }
    }

    fn get_directional_offset(&self, x: f32, y: f32) -> f32 {
        let dx = x - self.config.origin_x;
        let dy = y - self.config.origin_y;
        let angle = self.config.angle;

        match self.config.direction {
            EffectDirection::Linear => dx * angle.cos() + dy * angle.sin(),
            EffectDirection::Radial => (dx * dx + dy * dy).sqrt(),
            EffectDirection::Symmetrical => (dx * angle.cos() + dy * angle.sin()).abs(),
            EffectDirection::None => 0.0,
        }
    }
}

impl Effect for BaseOscillator {
    fn update(&mut self, delta_time_ms: f32, _abs_time_ms: f32, global_bpm: f32) {
        let duration_ms = Self::resolve_speed_to_ms(&self.config.speed, global_bpm);

        if duration_ms.is_infinite() || duration_ms == 0.0 {
            return;
        }

        if self.config.speed.mode == SpeedMode::Beat && self.config.speed.beat_offset != 0.0 {
            let beat_dur_ms = 60000.0 / global_bpm;
            let offset_ms = self.config.speed.beat_offset * beat_dur_ms;
            self.offset_phase = (offset_ms / duration_ms) * core::f32::consts::TAU;
        } else {
            self.offset_phase = 0.0;
        }

        let phase_advance = (delta_time_ms / duration_ms) * core::f32::consts::TAU;
        self.time_phase += phase_advance;
    }

    fn render(&self, world_x: f32, world_y: f32, _channel_seed: u32, _group_index: u32, _group_count: u32) -> f32 {
        if self.config.fanning == 0.0 || self.config.direction == EffectDirection::None {
            return (self.shape_fn)(&self.config, self.time_phase);
        }

        let dist = self.get_directional_offset(world_x, world_y);
        let fanning = self.config.fanning.max(0.0001);
        let mut phase_offset = (dist / fanning) * core::f32::consts::TAU;

        if self.config.reverse {
            phase_offset = -phase_offset;
        }

        (self.shape_fn)(&self.config, self.time_phase - phase_offset + self.offset_phase)
    }

    fn get_config(&self) -> &EffectConfig {
        &self.config
    }
}

/// Evaluate a single waveform shape at normalized cycle position t ∈ [0, 1).
fn evaluate_shape(shape: WaveformShape, t: f32, param: f32) -> f32 {
    match shape {
        WaveformShape::Sine => (t * core::f32::consts::TAU).sin(),
        WaveformShape::Square => {
            let duty = 0.05 + param * 0.9;
            if t < duty { 1.0 } else { -1.0 }
        }
        WaveformShape::Triangle => {
            let peak = 0.05 + param * 0.9;
            if t < peak {
                2.0 * t / peak - 1.0
            } else {
                1.0 - 2.0 * (t - peak) / (1.0 - peak)
            }
        }
        WaveformShape::Sawtooth => {
            if param < 0.5 { 1.0 - 2.0 * t } else { 2.0 * t - 1.0 }
        }
        WaveformShape::Bounce => {
            let count = (1.0 + param * 4.0).round();
            (count * core::f32::consts::PI * t).sin().abs()
        }
        WaveformShape::Ramp => {
            let softness = 0.1 + param * 9.9;
            let denom = (softness * 3.0).tanh();
            if denom.abs() < 1e-6 {
                if t < 0.5 { -1.0 } else { 1.0 }
            } else {
                (softness * (t - 0.5) * 6.0).tanh() / denom
            }
        }
        WaveformShape::Smooth => {
            let peak = 0.05 + param * 0.9;
            if t <= peak {
                -(core::f32::consts::PI * t / peak).cos()
            } else {
                (core::f32::consts::PI * (t - peak) / (1.0 - peak)).cos()
            }
        }
    }
}

/// Evaluate phase (radians) against a shape with start/end windowing. Returns [-1, 1].
fn evaluate_phase(config: &EffectConfig, phase: f32) -> f32 {
    let tau = core::f32::consts::TAU;
    let cycle_t = ((phase / tau) % 1.0 + 1.0) % 1.0;

    let start = config.waveform_params.start;
    let end = config.waveform_params.end;

    if start >= end {
        return evaluate_shape(config.waveform_shape, cycle_t, config.waveform_params.param);
    }

    // sentinel >2.0 means "use the shape's natural boundary value"
    let sl = if config.waveform_params.start_level > 2.0 {
        evaluate_shape(config.waveform_shape, 0.0, config.waveform_params.param)
    } else {
        config.waveform_params.start_level
    };
    let el = if config.waveform_params.end_level > 2.0 {
        evaluate_shape(config.waveform_shape, 1.0, config.waveform_params.param)
    } else {
        config.waveform_params.end_level
    };

    if cycle_t < start { return sl; }
    if cycle_t > end   { return el; }

    let local_t = (cycle_t - start) / (end - start);
    evaluate_shape(config.waveform_shape, local_t, config.waveform_params.param)
}

// ─── Noise Effect ─────────────────────────────────────────────────────────────

/// Fast hash-based stateless pseudo-random. Returns [0, 1].
fn seeded_random(seed: u32) -> f32 {
    let mut s = seed ^ 0xdeadbeef;
    s = s.wrapping_mul(0x45d9f3b).wrapping_add(s >> 16);
    s = s.wrapping_mul(0x45d9f3b).wrapping_add(s >> 16);
    s ^= s >> 16;
    (s as f32) / (u32::MAX as f32)
}

/// Classic improved Perlin noise 2D. Returns [-1, 1].
fn perlin2d(x: f32, y: f32) -> f32 {
    // Permutation table (compile-time constant derived from first 256 primes mod 256)
    static PERM: [u8; 512] = {
        const P: [u8; 256] = [
            151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,
            140,36,103,30,69,142,8,99,37,240,21,10,23,190,6,148,
            247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,32,
            57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,
            74,165,71,134,139,48,27,166,77,146,158,231,83,111,229,122,
            60,211,133,230,220,105,92,41,55,46,245,40,244,102,143,54,
            65,25,63,161,1,216,80,73,209,76,132,187,208,89,18,169,
            200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,
            52,217,226,250,124,123,5,202,38,147,118,126,255,82,85,212,
            207,206,59,227,47,16,58,17,182,189,28,42,223,183,170,213,
            119,248,152,2,44,154,163,70,221,153,101,155,167,43,172,9,
            129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,
            218,246,97,228,251,34,242,193,238,210,144,12,191,179,162,241,
            81,51,145,235,249,14,239,107,49,192,214,31,181,199,106,157,
            184,84,204,176,115,121,50,45,127,4,150,254,138,236,205,93,
            222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180,
        ];
        let mut out = [0u8; 512];
        let mut i = 0;
        while i < 512 { out[i] = P[i & 255]; i += 1; }
        out
    };

    fn fade(t: f32) -> f32 { t * t * t * (t * (t * 6.0 - 15.0) + 10.0) }
    fn lerp(a: f32, b: f32, t: f32) -> f32 { a + t * (b - a) }
    fn grad(hash: u8, x: f32, y: f32) -> f32 {
        let h = hash & 15;
        let gx: [f32; 16] = [1.0,-1.0,1.0,-1.0,1.0,-1.0,1.0,-1.0,0.0,0.0,0.0,0.0,1.0,0.0,-1.0,0.0];
        let gy: [f32; 16] = [1.0,1.0,-1.0,-1.0,0.0,0.0,0.0,0.0,1.0,-1.0,1.0,-1.0,0.0,1.0,0.0,-1.0];
        gx[h as usize] * x + gy[h as usize] * y
    }

    let xi = x.floor() as i32 & 255;
    let yi = y.floor() as i32 & 255;
    let xf = x - x.floor();
    let yf = y - y.floor();
    let u = fade(xf);
    let v = fade(yf);

    let aa = PERM[(PERM[xi as usize] as usize + yi as usize) & 511];
    let ab = PERM[(PERM[xi as usize] as usize + yi as usize + 1) & 511];
    let ba = PERM[(PERM[(xi + 1) as usize & 255] as usize + yi as usize) & 511];
    let bb = PERM[(PERM[(xi + 1) as usize & 255] as usize + yi as usize + 1) & 511];

    lerp(
        lerp(grad(aa, xf, yf), grad(ba, xf - 1.0, yf), u),
        lerp(grad(ab, xf, yf - 1.0), grad(bb, xf - 1.0, yf - 1.0), u),
        v,
    )
}

pub struct NoiseEffect {
    config: EffectConfig,
    time_ms: f32,
    cached_bpm: f32,
}

impl NoiseEffect {
    pub fn new(config: EffectConfig) -> Self {
        Self { config, time_ms: 0.0, cached_bpm: 120.0 }
    }

    fn resolve_speed_ms(&self, global_bpm: f32) -> f32 {
        match self.config.speed.mode {
            SpeedMode::Infinite => f32::INFINITY,
            SpeedMode::Time => self.config.speed.time_ms,
            SpeedMode::Beat => (60000.0 / global_bpm) * self.config.speed.beat_value,
        }
    }

    fn render_at_pos(&self, world_x: f32, world_y: f32, channel_seed: u32, global_bpm: f32) -> f32 {
        let np = self.config.noise_params.unwrap_or_default();
        // FNV-1a hash of quantized position → stable per-fixture seed without overflow.
        let pos_seed = {
            let xi = ((world_x * 10000.0).round() as i32) as u32;
            let yi = ((world_y * 10000.0).round() as i32) as u32;
            let mut h: u32 = 0x811c9dc5;
            h = (h ^ xi).wrapping_mul(0x01000193);
            h = (h ^ yi).wrapping_mul(0x01000193);
            h
        };

        let cv = np.color_variation.clamp(0.0, 1.0);
        // Per-channel seed: XOR pos_seed with a simple hash of channel_seed.
        let ch_seed = pos_seed ^ channel_seed.wrapping_mul(0x9e3779b9);

        match np.noise_type {
            NoiseType::White => {
                let base_dur = self.resolve_speed_ms(global_bpm).max(1.0);
                // Sample the same noise twice (linked=pos_seed, channel=ch_seed) then lerp by cv.
                let sample = |seed: u32| -> f32 {
                    if base_dur.is_infinite() { return seeded_random(seed) * 2.0 - 1.0; }
                    let rate_jitter  = seeded_random(seed.wrapping_add(0xA1)) * 0.8 + 0.6;
                    let phase_offset = seeded_random(seed.wrapping_add(0xB2)) * base_dur;
                    let dur = base_dur * rate_jitter;
                    let local_t = self.time_ms + phase_offset;
                    let tick = (local_t / dur) as u32;
                    let elapsed = local_t - (tick as f32) * dur;
                    let curr = seeded_random(seed.wrapping_add(tick.wrapping_mul(997))) * 2.0 - 1.0;
                    let prev = seeded_random(seed.wrapping_add(tick.wrapping_sub(1).wrapping_mul(997))) * 2.0 - 1.0;
                    crossfade(prev, curr, elapsed, dur, np.fade)
                };
                let v0 = sample(pos_seed);
                let v1 = sample(ch_seed);
                v0 + (v1 - v0) * cv
            }
            NoiseType::Perlin => {
                let time_sec = self.time_ms / 1000.0;
                let dur = self.resolve_speed_ms(global_bpm).max(1.0);
                let speed_factor = 1000.0 / dur;
                let cs = (channel_seed as f32) * 0.00001;
                let (ox, oy) = (cv * (cs * 17.3 + 13.7), cv * (cs * 31.7 + 27.1));
                perlin2d(world_x * np.scale * 4.0 + time_sec * speed_factor + ox, world_y * np.scale * 4.0 + oy)
            }
            NoiseType::Step => {
                let dur = self.resolve_speed_ms(global_bpm).max(1.0);
                let sample = |seed: u32| -> f32 {
                    if dur.is_infinite() { return seeded_random(seed) * 2.0 - 1.0; }
                    let tick = (self.time_ms / dur) as u32;
                    let elapsed = self.time_ms - (tick as f32) * dur;
                    let curr = seeded_random(seed.wrapping_add(tick.wrapping_mul(1013))) * 2.0 - 1.0;
                    let prev = seeded_random(seed.wrapping_add(tick.wrapping_sub(1).wrapping_mul(1013))) * 2.0 - 1.0;
                    crossfade(prev, curr, elapsed, dur, np.fade)
                };
                let v0 = sample(pos_seed);
                let v1 = sample(ch_seed);
                v0 + (v1 - v0) * cv
            }
        }
    }
}

/// Smoothly blends from `prev` → `curr` over the first `fade*dur` ms of the step.
/// fade=0 → hard snap; fade=1 → continuous ease.
fn crossfade(prev: f32, curr: f32, elapsed_ms: f32, dur_ms: f32, fade: f32) -> f32 {
    let f = fade.clamp(0.0, 1.0);
    if f <= 0.0 { return curr; }
    let fade_ms = dur_ms * f;
    if elapsed_ms >= fade_ms { return curr; }
    let t = (elapsed_ms / fade_ms).clamp(0.0, 1.0);
    // Smoothstep for a softer transition feel.
    let s = t * t * (3.0 - 2.0 * t);
    prev + (curr - prev) * s
}

impl Effect for NoiseEffect {
    fn update(&mut self, _delta_time_ms: f32, abs_time_ms: f32, global_bpm: f32) {
        self.time_ms = abs_time_ms;
        self.cached_bpm = global_bpm;
    }

    fn render(&self, world_x: f32, world_y: f32, channel_seed: u32, _group_index: u32, _group_count: u32) -> f32 {
        let raw = self.render_at_pos(world_x, world_y, channel_seed, self.cached_bpm);
        let np = self.config.noise_params.unwrap_or_default();
        let t = np.threshold.clamp(0.0, 1.0);
        if t <= 0.0 { return raw; }
        // Map raw [-1,1] to [0,1], gate, rescale back to [-1,1].
        let norm = (raw + 1.0) * 0.5;
        if norm < t {
            -1.0
        } else if t >= 1.0 {
            1.0
        } else {
            (norm - t) / (1.0 - t) * 2.0 - 1.0
        }
    }

    fn get_config(&self) -> &EffectConfig {
        &self.config
    }
}

// ─── Sequencer Effect ─────────────────────────────────────────────────────────

/// FNV-1a hash of quantized world coordinates → stable per-fixture seed.
fn fnv1a_pos(world_x: f32, world_y: f32) -> u32 {
    // Scale 0–1 normalized coords to 0–10000 integers for per-fixture uniqueness
    let xi = (world_x * 10000.0).round() as i32 as u32;
    let yi = (world_y * 10000.0).round() as i32 as u32;
    let mut h: u32 = 0x811c9dc5;
    h = (h ^ (xi & 0xff)).wrapping_mul(0x01000193);
    h = (h ^ ((xi >> 8) & 0xff)).wrapping_mul(0x01000193);
    h = (h ^ (yi & 0xff)).wrapping_mul(0x01000193);
    h = (h ^ ((yi >> 8) & 0xff)).wrapping_mul(0x01000193);
    h
}

pub struct SequencerEffect {
    config: EffectConfig,
    time_phase: f32,
    scatter_cycle: u32,
    flow_time: f32,
}

impl SequencerEffect {
    pub fn new(config: EffectConfig) -> Self {
        Self { config, time_phase: 0.0, scatter_cycle: 0, flow_time: 0.0 }
    }

    fn resolve_duration_ms(speed: &SpeedConfig, global_bpm: f32) -> f32 {
        match speed.mode {
            SpeedMode::Infinite => f32::INFINITY,
            SpeedMode::Time => speed.time_ms,
            SpeedMode::Beat => (60000.0 / global_bpm) * speed.beat_value,
        }
    }
}

impl Effect for SequencerEffect {
    fn update(&mut self, delta_time_ms: f32, abs_time_ms: f32, global_bpm: f32) {
        let duration_ms = Self::resolve_duration_ms(&self.config.speed, global_bpm);
        if duration_ms.is_infinite() || duration_ms == 0.0 { return; }
        self.time_phase += (delta_time_ms / duration_ms) * core::f32::consts::TAU;
        // Scatter cycle and flow time derived from absolute time → same on all engine instances
        self.scatter_cycle = (abs_time_ms / duration_ms).floor() as u32;
        self.flow_time = abs_time_ms / 1000.0;
    }

    fn render(&self, world_x: f32, world_y: f32, _channel_seed: u32, group_index: u32, group_count: u32) -> f32 {
        // world_x/world_y are normalized 0–1 (same as fanning, originX/Y, scale)
        let sp = self.config.sequencer_params.unwrap_or_default();
        let ox = sp.origin_x;
        let oy = sp.origin_y;
        let (s, c) = sp.angle.sin_cos();
        let dx = world_x - ox;
        let dy = world_y - oy;
        let u = dx * c + dy * s;
        let v = -dx * s + dy * c;
        let cell = sp.scale;

        let on = match sp.pattern_type {
            SequencerPatternType::Split => v > 0.0,
            SequencerPatternType::Checkerboard => {
                let gu = if cell > 0.0 { (u / cell).floor() as i32 } else { 0 };
                let gv = if cell > 0.0 { (v / cell).floor() as i32 } else { 0 };
                (gu + gv).rem_euclid(2) == 0
            }
            SequencerPatternType::Sections => {
                if cell > 0.0 { (u / cell).floor().abs() as i32 % 2 == 0 } else { true }
            }
            SequencerPatternType::Scatter => {
                // Apply density variation: shift density randomly per cycle
                let effective_density = if sp.density_variation > 0.0 {
                    let var_seed = self.scatter_cycle.wrapping_mul(1664525).wrapping_add(1013904223);
                    let var = seeded_random(var_seed) * 2.0 - 1.0;
                    (sp.density + var * sp.density_variation).clamp(0.0, 1.0)
                } else {
                    sp.density
                };

                let cycle_seed = self.scatter_cycle.wrapping_mul(2654435761);
                let n = if let Some(indices) = &self.config.target_group_indices {
                    indices.len().max(1)
                } else {
                    group_count.max(1) as usize
                };
                let target_count = (effective_density * n as f32).round() as usize;
                let my_val = seeded_random(group_index.wrapping_add(cycle_seed));
                let my_rank = if let Some(indices) = &self.config.target_group_indices {
                    indices.iter()
                        .filter(|&&idx| seeded_random((idx as u32).wrapping_add(cycle_seed)) < my_val)
                        .count()
                } else {
                    (0..group_count)
                        .filter(|&i| seeded_random(i.wrapping_add(cycle_seed)) < my_val)
                        .count()
                };
                let result = my_rank < target_count;
                let result = if sp.invert { !result } else { result };
                return if result { 0.0 } else { -1.0 };
            }
            SequencerPatternType::Flow => {
                // Perlin noise evolving over time — organic flowing boundary
                let duration_ms = Self::resolve_duration_ms(&self.config.speed, 120.0);
                let speed = if duration_ms.is_infinite() { 0.0 } else { 1.0 / (duration_ms / 1000.0) };
                let nx = world_x / sp.scale.max(0.01);
                let ny = world_y / sp.scale.max(0.01);
                let t = self.flow_time * speed;
                let noise = perlin2d(nx + t, ny + t * 0.7);
                // noise is in roughly -1..1; threshold at density mapped to -1..1
                let threshold = sp.density * 2.0 - 1.0;
                let result = noise > threshold;
                let result = if sp.invert { !result } else { result };
                return if result { 0.0 } else { -1.0 };
            }
        };

        // Flip ON/OFF each half-cycle so the geometric pattern alternates with beat/time
        let tau = core::f32::consts::TAU;
        let cycle_t = ((self.time_phase / tau) % 1.0 + 1.0) % 1.0;
        let toggled = if cycle_t >= 0.5 { !on } else { on };
        let toggled = if sp.invert { !toggled } else { toggled };

        if toggled { 0.0 } else { -1.0 }
    }

    fn get_config(&self) -> &EffectConfig {
        &self.config
    }
}

pub fn create_effect(config: EffectConfig) -> Box<dyn Effect> {
    if config.effect_type == "SequencerEffect" || config.sequencer_params.is_some() {
        Box::new(SequencerEffect::new(config))
    } else if config.effect_type == "NoiseEffect" || config.noise_params.is_some() {
        Box::new(NoiseEffect::new(config))
    } else {
        Box::new(BaseOscillator::new(config, evaluate_phase))
    }
}

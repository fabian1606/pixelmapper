use crate::types::{EffectConfig, EffectDirection, SpeedConfig, SpeedMode, WaveformShape};

pub trait Effect {
    fn update(&mut self, delta_time_ms: f32, global_bpm: f32);
    fn render(&self, world_x: f32, world_y: f32) -> f32;
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
    fn update(&mut self, delta_time_ms: f32, global_bpm: f32) {
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

    fn render(&self, world_x: f32, world_y: f32) -> f32 {
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

pub fn create_effect(config: EffectConfig) -> Box<dyn Effect> {
    Box::new(BaseOscillator::new(config, evaluate_phase))
}

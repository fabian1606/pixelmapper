use crate::types::{EffectConfig, EffectDirection, SpeedConfig, SpeedMode};

pub trait Effect {
    fn update(&mut self, delta_time_ms: f32, global_bpm: f32);
    fn render(&self, world_x: f32, world_y: f32) -> f32;
    fn get_config(&self) -> &EffectConfig;
}

pub struct BaseOscillator {
    config: EffectConfig,
    time_phase: f32,
    offset_phase: f32,
    shape_fn: fn(f32) -> f32,
}

impl BaseOscillator {
    pub fn new(config: EffectConfig, shape_fn: fn(f32) -> f32) -> Self {
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
            return (self.shape_fn)(self.time_phase);
        }

        let dist = self.get_directional_offset(world_x, world_y);
        let fanning = self.config.fanning.max(0.0001);
        let mut phase_offset = (dist / fanning) * core::f32::consts::TAU;

        if self.config.reverse {
            phase_offset = -phase_offset;
        }

        (self.shape_fn)(self.time_phase - phase_offset + self.offset_phase)
    }

    fn get_config(&self) -> &EffectConfig {
        &self.config
    }
}

pub fn create_effect(config: EffectConfig) -> Box<dyn Effect> {
    match config.effect_type.as_str() {
        "Sine" => Box::new(BaseOscillator::new(config, |p| p.sin())),
        // Add other shapes as needed, e.g., "Saw", "Square"
        _ => Box::new(BaseOscillator::new(config, |p| p.sin())),
    }
}

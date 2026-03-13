use crate::types::{RenderTarget, SpeedMode, SpeedConfig};
use crate::effects::{create_effect, Effect};

pub struct EffectEngine {
    pub dmx_buffer: [u8; 512],
    pub base_buffer: [f32; 512],
    pub global_bpm: f32,
    pub targets: Vec<RenderTarget>,
    pub effects: Vec<Box<dyn Effect>>,
}

impl Default for EffectEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl EffectEngine {
    pub fn new() -> Self {
        Self {
            dmx_buffer: [0; 512],
            base_buffer: [0.0; 512],
            global_bpm: 120.0,
            targets: Vec::new(),
            effects: Vec::new(),
        }
    }

    pub fn set_bpm(&mut self, bpm: f32) {
        self.global_bpm = bpm;
    }

    pub fn sync_targets(&mut self, targets: Vec<RenderTarget>) {
        self.targets = targets;
    }

    pub fn sync_effects(&mut self, configs: Vec<crate::types::EffectConfig>) {
        self.effects = configs.into_iter().map(create_effect).collect();
    }

    fn resolve_speed_to_ms(speed: &SpeedConfig, global_bpm: f32) -> f32 {
        match speed.mode {
            SpeedMode::Infinite => f32::INFINITY,
            SpeedMode::Time => speed.time_ms,
            SpeedMode::Beat => (60000.0 / global_bpm) * speed.beat_value,
        }
    }

    pub fn render(&mut self, time_ms: f32, delta_time_ms: f32) {
        // 1. Update effects
        let global_bpm = self.global_bpm;
        for effect in &mut self.effects {
            effect.update(delta_time_ms, global_bpm);
        }

        // 2. Compute base values (Chasers or Defaults)
        for target in &self.targets {
            let dmx_index = target.dmx_index;
            if dmx_index >= 512 {
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
            
            self.base_buffer[dmx_index] = calculated_base;
            self.dmx_buffer[dmx_index] = calculated_base.clamp(0.0, 255.0) as u8;
        }

        // 3. Apply effects
        for target in &self.targets {
            let dmx_index = target.dmx_index;
            if dmx_index >= 512 {
                continue;
            }

            for effect in &self.effects {
                let config = effect.get_config();

                if !config.target_channels.contains(&target.channel_type) {
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

                // Additively blend the effect on top of what was already in dmxBuffer
                let current_dmx = self.dmx_buffer[dmx_index] as f32;
                self.dmx_buffer[dmx_index] = (current_dmx + offset).clamp(0.0, 255.0) as u8;
            }
        }
    }
}

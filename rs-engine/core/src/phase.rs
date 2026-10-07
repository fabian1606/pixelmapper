// ── Modifier phase ───────────────────────────────
//
// Phase accumulation moved out of every effect into the core (ADR D5, §6.5).
// Phase is measured in cycles (1.0 = one full cycle) and derived from the
// shared clock, so it is identical on every client:
//   phase = speed phase(time, beat time) − spatial offset(position).

use crate::types::{EffectDirection, SpeedConfig, SpeedMode};

/// Temporal phase in cycles.
/// - time: `t / timeMs`
/// - beat: `(beatTime + beatOffset) / beatValue`
/// - infinite: frozen at 0.
pub fn speed_phase(speed: &SpeedConfig, time_ms: f32, beat_time: f32) -> f32 {
    match speed.mode {
        SpeedMode::Time if speed.time_ms > 0.0 => time_ms / speed.time_ms,
        SpeedMode::Beat if speed.beat_value > 0.0 => (beat_time + speed.beat_offset) / speed.beat_value,
        _ => 0.0,
    }
}

/// Cycles per second of a speed setting (0 = frozen).
pub fn phase_speed(speed: &SpeedConfig, bpm: f32) -> f32 {
    match speed.mode {
        SpeedMode::Time if speed.time_ms > 0.0 => 1000.0 / speed.time_ms,
        SpeedMode::Beat if speed.beat_value > 0.0 => bpm / 60.0 / speed.beat_value,
        _ => 0.0,
    }
}

/// Spatial phase distribution of an instance.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Spatial {
    pub direction: EffectDirection,
    pub origin_x: f32,
    pub origin_y: f32,
    pub angle: f32,
    /// World units per full cycle; 0 disables spatial offsets.
    pub fanning: f32,
    pub reverse: bool,
}

/// Distance along the direction (same geometry as the former effects).
fn directional_distance(sp: &Spatial, x: f32, y: f32) -> f32 {
    let dx = x - sp.origin_x;
    let dy = y - sp.origin_y;
    match sp.direction {
        EffectDirection::Linear => dx * sp.angle.cos() + dy * sp.angle.sin(),
        EffectDirection::Radial => (dx * dx + dy * dy).sqrt(),
        EffectDirection::Symmetrical => (dx * sp.angle.cos() + dy * sp.angle.sin()).abs(),
        EffectDirection::Angular => {
            let mut delta = dy.atan2(dx) - sp.angle;
            if delta > core::f32::consts::PI { delta -= core::f32::consts::TAU; }
            if delta < -core::f32::consts::PI { delta += core::f32::consts::TAU; }
            delta / core::f32::consts::TAU
        }
        EffectDirection::None => 0.0,
    }
}

/// Spatial phase offset in cycles (subtracted from the speed phase).
pub fn spatial_offset(sp: &Spatial, x: f32, y: f32) -> f32 {
    if sp.fanning == 0.0 || sp.direction == EffectDirection::None {
        return 0.0;
    }
    let offset = directional_distance(sp, x, y) / sp.fanning.max(0.0001);
    if sp.reverse { -offset } else { offset }
}

/// Final per-sample phase in cycles.
pub fn sample_phase(speed_phase: f32, sp: &Spatial, x: f32, y: f32) -> f32 {
    speed_phase - spatial_offset(sp, x, y)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn speed(mode: SpeedMode) -> SpeedConfig {
        SpeedConfig { mode, time_ms: 500.0, beat_value: 2.0, beat_offset: 0.5 }
    }

    #[test]
    fn speed_modes() {
        assert!((speed_phase(&speed(SpeedMode::Time), 1250.0, 0.0) - 2.5).abs() < 1e-6);
        assert!((speed_phase(&speed(SpeedMode::Beat), 0.0, 3.5) - 2.0).abs() < 1e-6);
        assert_eq!(speed_phase(&speed(SpeedMode::Infinite), 9999.0, 99.0), 0.0);
        assert!((phase_speed(&speed(SpeedMode::Time), 120.0) - 2.0).abs() < 1e-6);
        assert!((phase_speed(&speed(SpeedMode::Beat), 120.0) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn spatial_linear_and_reverse() {
        let mut sp = Spatial { direction: EffectDirection::Linear, origin_x: 0.0, origin_y: 0.0, angle: 0.0, fanning: 0.5, reverse: false };
        assert!((spatial_offset(&sp, 0.25, 0.9) - 0.5).abs() < 1e-6);
        sp.reverse = true;
        assert!((spatial_offset(&sp, 0.25, 0.9) + 0.5).abs() < 1e-6);
        assert!((sample_phase(1.0, &sp, 0.25, 0.0) - 1.5).abs() < 1e-6);
    }

    #[test]
    fn no_fanning_or_direction_means_no_offset() {
        let sp = Spatial { direction: EffectDirection::Radial, origin_x: 0.5, origin_y: 0.5, angle: 0.0, fanning: 0.0, reverse: false };
        assert_eq!(spatial_offset(&sp, 1.0, 1.0), 0.0);
        let sp = Spatial { direction: EffectDirection::None, fanning: 1.0, ..sp };
        assert_eq!(spatial_offset(&sp, 1.0, 1.0), 0.0);
    }

    #[test]
    fn radial_distance() {
        let sp = Spatial { direction: EffectDirection::Radial, origin_x: 0.5, origin_y: 0.5, angle: 0.0, fanning: 1.0, reverse: false };
        assert!((spatial_offset(&sp, 0.8, 0.9) - 0.5).abs() < 1e-6);
    }
}
